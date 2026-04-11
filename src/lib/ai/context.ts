import { retrieveContext } from "@/lib/rag/retrieve";

/**
 * Central place to assemble model context. Retrieves per-project reference
 * material (Phase 1 RAG) and returns it as a delimited system-prompt suffix
 * that the orchestrator can inject as a cached system block.
 *
 * Fail-open: any retrieval failure returns an empty suffix, not an error.
 * Generation must still work when RAG is unavailable, misconfigured, or
 * when the project has no reference document attached.
 */

export type AgentPhase =
  | "intent"
  | "layout"
  | "content"
  | "code"
  | "validation";

export type BuildContextParams = {
  phase: AgentPhase;
  projectId: string | null;
  userPrompt: string;
  requestId?: string;
};

export async function buildContextForAgent(
  params: BuildContextParams,
): Promise<{ staticPromptSuffix: string }> {
  if (process.env.RAG_ENABLED === "false") {
    return { staticPromptSuffix: "" };
  }
  if (!params.projectId) {
    return { staticPromptSuffix: "" };
  }

  try {
    const suffix = await retrieveContext({
      projectId: params.projectId,
      query: params.userPrompt,
      requestId: params.requestId,
    });
    return { staticPromptSuffix: suffix ?? "" };
  } catch {
    return { staticPromptSuffix: "" };
  }
}
