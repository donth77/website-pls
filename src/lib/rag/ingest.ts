import { prisma } from "@/lib/db/prisma";
import { downloadFile } from "@/lib/storage/r2";
import { createLogger } from "@/lib/logger";
import { recordEvent } from "@/lib/admin/metrics";
import { extractText } from "./extract";
import { chunkText } from "./chunk";
import {
  embedPassagesWithCascade,
  AllEmbeddingProvidersFailedError,
  TARGET_DIMS,
} from "./embed";

const log = createLogger("rag.ingest");

export interface IngestDocumentInput {
  projectId: string;
  storageKey: string;
  meta: {
    fileName: string;
    contentType: string;
    fileSize: number;
  };
  requestId?: string;
}

export interface IngestDocumentResult {
  referenceDocumentId: string;
  chunkCount: number;
  provider: string;
  truncated: boolean;
}

export class ReferenceFileNotFoundError extends Error {
  constructor(storageKey: string) {
    super(`Reference file not found in R2: ${storageKey}`);
    this.name = "ReferenceFileNotFoundError";
  }
}

/**
 * Ingest a reference document end-to-end.
 *
 *   R2 download → extract → chunk → embed (cascade) → DB transaction
 *
 * The DB write is atomic: delete any pre-existing ReferenceDocument for
 * the project (cascading its chunks), then insert the new document row
 * and all chunk rows in one transaction. On any failure the document is
 * marked `status = "failed"` with an errorMessage; the caller should
 * proceed with generation anyway (fail-open — users get a site, they
 * just don't get the RAG lift).
 *
 * The pinned provider is recorded on the ReferenceDocument row because
 * embedding spaces are not comparable across providers. Retrieval later
 * MUST use the same provider.
 */
export async function ingestDocument(
  input: IngestDocumentInput,
): Promise<IngestDocumentResult> {
  const { projectId, storageKey, meta, requestId } = input;
  const childLog = log.child({ projectId, storageKey, requestId });

  childLog.info("rag.ingest.started", { fileName: meta.fileName });

  // Always create a row first so failures are visible in the DB.
  const placeholder = await prisma.referenceDocument.create({
    data: {
      projectId,
      fileName: meta.fileName,
      contentType: meta.contentType,
      fileSize: meta.fileSize,
      storageKey,
      status: "pending",
    },
  });

  try {
    const buffer = await downloadFile(storageKey);
    if (!buffer) {
      throw new ReferenceFileNotFoundError(storageKey);
    }

    const extracted = await extractText(buffer, meta.contentType);
    if (extracted.truncated) {
      childLog.warn("rag.ingest.truncated", {
        tokenCount: extracted.tokenCount,
      });
    }

    const chunks = chunkText(extracted.text);
    if (chunks.length === 0) {
      throw new Error("No content extracted from document");
    }

    childLog.info("rag.ingest.chunked", {
      chunkCount: chunks.length,
      totalTokens: extracted.tokenCount,
    });

    const cascade = await embedPassagesWithCascade(chunks.map((c) => c.text));

    childLog.info("rag.embed.provider_used", {
      provider: cascade.provider,
      attempts: cascade.attemptsTried.length,
      chunkCount: chunks.length,
    });
    recordEvent("rag.embed.provider_used", {
      provider: cascade.provider,
      attempts: cascade.attemptsTried.length,
      chunkCount: chunks.length,
      projectId,
      requestId,
    }).catch(() => {});

    if (cascade.attemptsTried.length > 1) {
      recordEvent("rag.embed.cascade_fallback", {
        finalProvider: cascade.provider,
        attemptsTried: cascade.attemptsTried,
        projectId,
        requestId,
      }).catch(() => {});
    }

    if (cascade.embeddings.length !== chunks.length) {
      throw new Error(
        `Embedding count mismatch: ${cascade.embeddings.length} vs ${chunks.length}`,
      );
    }
    for (const [i, vec] of cascade.embeddings.entries()) {
      if (vec.length !== TARGET_DIMS) {
        throw new Error(
          `Embedding ${i} has wrong dimensions: ${vec.length} vs ${TARGET_DIMS}`,
        );
      }
    }

    // Commit atomically. Delete any prior document for the project (cascades
    // its chunks), then update the placeholder and insert the chunk rows.
    const finalDocumentId = await prisma.$transaction(async (tx) => {
      await tx.referenceDocument.deleteMany({
        where: {
          projectId,
          id: { not: placeholder.id },
        },
      });

      const updated = await tx.referenceDocument.update({
        where: { id: placeholder.id },
        data: {
          status: "ready",
          tokenCount: extracted.tokenCount,
          embeddingProvider: cascade.provider,
          errorMessage: null,
        },
      });

      for (const [i, chunk] of chunks.entries()) {
        const vector = `[${cascade.embeddings[i].join(",")}]`;
        await tx.$executeRawUnsafe(
          `INSERT INTO reference_chunks (id, reference_document_id, chunk_index, content, embedding, token_count, created_at)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4::vector, $5, NOW())`,
          updated.id,
          chunk.chunkIndex,
          chunk.text,
          vector,
          chunk.tokenCount,
        );
      }

      return updated.id;
    });

    childLog.info("rag.ingest.succeeded", {
      referenceDocumentId: finalDocumentId,
      chunkCount: chunks.length,
      provider: cascade.provider,
    });
    recordEvent("rag.ingest.succeeded", {
      referenceDocumentId: finalDocumentId,
      chunkCount: chunks.length,
      provider: cascade.provider,
      projectId,
      requestId,
    }).catch(() => {});

    return {
      referenceDocumentId: finalDocumentId,
      chunkCount: chunks.length,
      provider: cascade.provider,
      truncated: extracted.truncated,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    childLog.error("rag.ingest.failed", { errorMessage });

    const isAllProvidersFailed =
      error instanceof AllEmbeddingProvidersFailedError;

    recordEvent(
      isAllProvidersFailed
        ? "rag.embed.all_providers_failed"
        : "rag.ingest.failed",
      {
        projectId,
        requestId,
        errorMessage,
      },
    ).catch(() => {});

    await prisma.referenceDocument
      .update({
        where: { id: placeholder.id },
        data: {
          status: "failed",
          errorMessage: errorMessage.slice(0, 1000),
        },
      })
      .catch((updateErr) => {
        childLog.error("rag.ingest.failure_status_write_failed", {
          updateError:
            updateErr instanceof Error ? updateErr.message : String(updateErr),
        });
      });

    throw error;
  }
}
