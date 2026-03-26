/**
 * Central place to assemble model context. MVP: static prompts + DB fields only (no RAG).
 * Post-MVP: merge retrieved chunks here without rewriting individual agents.
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
};

export async function buildContextForAgent(
  params: BuildContextParams,
): Promise<{ staticPromptSuffix: string }> {
  void params;
  return { staticPromptSuffix: "" };
}
