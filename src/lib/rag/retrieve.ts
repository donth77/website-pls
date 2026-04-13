import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/logger";
import { recordEvent } from "@/lib/admin/metrics";
import {
  embedQueryWithPinnedProvider,
  isValidEmbeddingProvider,
  TARGET_DIMS,
  type EmbeddingProviderName,
} from "./embed";

const log = createLogger("rag.retrieve");

const DEFAULT_TOP_K = 5;

export const REFERENCE_DELIMITER_BEGIN = "WEBSITEPLS_REFERENCE_DOCUMENT_BEGIN";
export const REFERENCE_DELIMITER_END = "WEBSITEPLS_REFERENCE_DOCUMENT_END";

interface ChunkRow {
  id: string;
  content: string;
}

export interface RetrieveContextOptions {
  projectId: string;
  query: string;
  topK?: number;
  requestId?: string;
}

/**
 * Retrieve the top-k reference chunks for a user query and return them
 * wrapped in the `WEBSITEPLS_REFERENCE_DOCUMENT` delimiter block, ready
 * to be injected as a separate cached system prompt block by the
 * orchestrator.
 *
 * Returns `null` (no RAG context for this generation) when:
 *   - The project has no active ReferenceDocument
 *   - The active document's status is not "ready"
 *   - The stored `embeddingProvider` is missing or invalid
 *   - Query-time embedding fails (rate limit, network) — this is the
 *     most common fail-open path
 *   - The pgvector query returns zero rows
 *
 * Retrieval MUST use the same provider the document was ingested with.
 * Cross-provider vectors live in different semantic spaces; falling back
 * would silently return garbage matches. If the pinned provider is
 * unavailable, the user must remove + re-upload the document.
 */
export async function retrieveContext(
  options: RetrieveContextOptions,
): Promise<string | null> {
  const { projectId, query, topK = DEFAULT_TOP_K, requestId } = options;
  const childLog = log.child({ projectId, requestId });

  const doc = await prisma.referenceDocument.findFirst({
    where: { projectId, status: "ready" },
    orderBy: { createdAt: "desc" },
    select: { id: true, embeddingProvider: true },
  });

  if (!doc) {
    return null;
  }

  if (
    !doc.embeddingProvider ||
    !isValidEmbeddingProvider(doc.embeddingProvider)
  ) {
    childLog.warn("rag.retrieval.invalid_provider", {
      referenceDocumentId: doc.id,
      embeddingProvider: doc.embeddingProvider,
    });
    return null;
  }

  const provider: EmbeddingProviderName = doc.embeddingProvider;

  let queryVector: number[];
  try {
    queryVector = await embedQueryWithPinnedProvider(query, provider);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    childLog.warn("rag.retrieval.provider_unavailable", {
      provider,
      errorMessage,
    });
    recordEvent("rag.retrieval.provider_unavailable", {
      provider,
      errorMessage,
      projectId,
      requestId,
    }).catch(() => {});
    return null;
  }

  if (queryVector.length !== TARGET_DIMS) {
    childLog.error("rag.retrieval.wrong_dimensions", {
      got: queryVector.length,
      expected: TARGET_DIMS,
    });
    return null;
  }

  const vectorLiteral = `[${queryVector.join(",")}]`;
  const rows = await prisma.$queryRawUnsafe<ChunkRow[]>(
    `SELECT id, content
     FROM reference_chunks
     WHERE reference_document_id = $1
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    doc.id,
    vectorLiteral,
    topK,
  );

  if (rows.length === 0) {
    childLog.warn("rag.retrieval.empty_result", {
      referenceDocumentId: doc.id,
    });
    return null;
  }

  const body = rows.map((row) => row.content).join("\n---\n");

  childLog.info("rag.retrieval.succeeded", {
    referenceDocumentId: doc.id,
    provider,
    chunkCount: rows.length,
  });
  recordEvent("rag.retrieval.succeeded", {
    referenceDocumentId: doc.id,
    provider,
    chunkCount: rows.length,
    projectId,
    requestId,
  }).catch(() => {});

  return `${REFERENCE_DELIMITER_BEGIN}\n${body}\n${REFERENCE_DELIMITER_END}`;
}
