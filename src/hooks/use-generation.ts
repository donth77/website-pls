import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ChatMessage, GenerationStatus } from "@/lib/types";
import { errorCodeToMessage } from "@/lib/types";
import { MAX_USER_PROMPT_CHARS } from "@/lib/ai/promptSafety";
import type { ReferenceDocumentInfo } from "@/components/generator/project-reference-material";

export const SESSION_KEY = "websitepls:generation";

export interface PersistedState {
  phase: "landing" | "builder";
  projectId: string | null;
  projectName: string | null;
  versionId: string | null;
  status: GenerationStatus;
  versionNumber: number;
  originalPrompt: string;
  messages: ChatMessage[];
  generationStartTime: number | null;
  /** Cached so remounts don't flash the empty paperclip before the fetch resolves. */
  currentReferenceDocument: ReferenceDocumentInfo | null;
}

function loadSession(): PersistedState | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

function saveSession(state: PersistedState) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage full or unavailable — ignore
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function useGeneration() {
  const tMsg = useTranslations("Message");

  /* ── Restore from sessionStorage on mount ── */
  const restored = useRef(loadSession());
  const init = restored.current;

  /* ── UI phase ── */
  const [phase, setPhase] = useState<"landing" | "builder">(
    init?.phase ?? "landing",
  );
  const [mobileView, setMobileView] = useState<"chat" | "preview">("chat");

  /* ── Chat ── */
  const [messages, setMessages] = useState<ChatMessage[]>(init?.messages ?? []);
  const [inputValue, setInputValue] = useState("");

  /* ── Generation ── */
  const [originalPrompt, setOriginalPrompt] = useState(
    init?.originalPrompt ?? "",
  );
  const [projectId, setProjectId] = useState<string | null>(
    init?.projectId ?? null,
  );
  const [projectName, setProjectName] = useState<string | null>(
    init?.projectName ?? null,
  );
  const [versionId, setVersionId] = useState<string | null>(
    init?.versionId ?? null,
  );
  const [status, setStatus] = useState<GenerationStatus>(
    init?.status ?? "DRAFT",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [versionNumber, setVersionNumber] = useState(init?.versionNumber ?? 0);

  /* ── Timer ── */
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(
    init?.generationStartTime ?? null,
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  /* ── Preview ── */
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  const previewWrapRef = useRef<HTMLDivElement>(null);

  /* ── Turnstile ── */
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileResetRef = useRef<(() => void) | null>(null);

  /* ── Reference material (Phase 1 RAG) ── */
  // `selectedFile` is the client-staged file that ships with the next
  // POST /api/generate (as multipart form-data). Cleared on submit.
  // `currentReferenceDocument` mirrors the server-side ReferenceDocument
  // row for the active project; hydrated from GET /api/projects/[id] and
  // cleared on new project / remove.
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [currentReferenceDocument, setCurrentReferenceDocument] =
    useState<ReferenceDocumentInfo | null>(
      init?.currentReferenceDocument ?? null,
    );

  /* ── Misc UI ── */
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isMac, setIsMac] = useState(true);

  /* ── Refs ── */
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // On restore, reconnect to the last GENERATING assistant message so polling can update it.
  const currentAssistantMsgId = useRef<string | null>(
    init?.messages?.findLast(
      (m) =>
        m.role === "assistant" &&
        (m.status === "GENERATING" || m.status === "READY"),
    )?.id ?? null,
  );
  const sidebarInputRef = useRef<HTMLTextAreaElement>(null);
  const landingInputRef = useRef<HTMLTextAreaElement>(null);
  const lastRequestRef = useRef<{
    prompt: string;
    projectId?: string;
    refinementPrompt?: string;
  } | null>(null);

  /* ── Derived ── */
  const turnstileRequired = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const canSubmit = useMemo(() => {
    const trimmed = inputValue.trim();
    return (
      trimmed.length >= 3 &&
      inputValue.length <= MAX_USER_PROMPT_CHARS &&
      !isSubmitting &&
      status !== "GENERATING" &&
      (!turnstileRequired || !!turnstileToken)
    );
  }, [inputValue, isSubmitting, status, turnstileRequired, turnstileToken]);

  /* ── Persist state to sessionStorage ── */
  useEffect(() => {
    if (phase === "landing" && !projectId) return;
    saveSession({
      phase,
      projectId,
      projectName,
      versionId,
      status,
      versionNumber,
      originalPrompt,
      messages,
      generationStartTime,
      currentReferenceDocument,
    });
  }, [
    phase,
    projectId,
    projectName,
    versionId,
    status,
    versionNumber,
    originalPrompt,
    messages,
    generationStartTime,
    currentReferenceDocument,
  ]);

  /* ── Update assistant message ── */
  const updateAssistantMessage = useCallback(
    (updates: Partial<ChatMessage>) => {
      const id = currentAssistantMsgId.current;
      if (!id) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...updates } : m)),
      );
    },
    [],
  );

  /* ═══════════════════════ Effects ═══════════════════════ */

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // On restore, detect stale GENERATING sessions (server restarted mid-job).
  // If still GENERATING after 10s, assume the job is dead and reset.
  useEffect(() => {
    if (!init?.versionId || init.status !== "GENERATING") return;
    const timeout = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/versions/${init.versionId}`, {
          headers: { accept: "application/json" },
        });
        if (!res.ok) {
          setStatus("ERROR");
          updateAssistantMessage({
            content: tMsg("interrupted"),
            status: "ERROR",
          });
          return;
        }
        const json = await res.json();
        if (json.projectStatus === "ERROR" || json.projectStatus === "DRAFT") {
          setStatus(json.projectStatus as GenerationStatus);
          updateAssistantMessage({
            content: tMsg("interrupted"),
            status: "ERROR",
          });
        }
        // If still GENERATING, the poller will pick it up normally.
      } catch {
        // Network error — let poller handle it
      }
    }, 10_000);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect macOS for keyboard hint
  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().includes("MAC"));
  }, []);

  // Track native fullscreen changes
  useEffect(() => {
    const handler = () => setIsPreviewFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Elapsed-time ticker during generation
  useEffect(() => {
    if (status !== "GENERATING" || !generationStartTime) return;
    const tick = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - generationStartTime) / 1000));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [status, generationStartTime]);

  // Escape closes info modal
  useEffect(() => {
    if (!isInfoOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsInfoOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isInfoOpen]);

  // Poll version status
  useEffect(() => {
    if (!versionId) return;
    if (status === "READY" || status === "ERROR") return;

    let cancelled = false;
    const interval = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/versions/${versionId}`, {
          method: "GET",
          headers: { accept: "application/json" },
        });
        if (!res.ok || cancelled) return;

        const json = await res.json();
        if (cancelled) return;

        const nextStatus = json.projectStatus as GenerationStatus;
        const step = (json.step as string) ?? undefined;
        const percent =
          typeof json.percent === "number"
            ? (json.percent as number)
            : undefined;

        setStatus(nextStatus);

        if (
          typeof json.projectName === "string" &&
          json.projectName &&
          json.projectName !== originalPrompt
        ) {
          setProjectName(json.projectName);
        }

        if (nextStatus === "READY") {
          const commentaryText =
            typeof json.commentary === "string" && json.commentary
              ? json.commentary
              : tMsg("websiteReady");
          updateAssistantMessage({
            content: commentaryText,
            status: "READY",
            progressStep: "complete",
            progressPercent: 100,
            timestamp: Date.now(),
          });
          setMobileView("preview");
        } else if (nextStatus === "ERROR") {
          updateAssistantMessage({
            content: errorCodeToMessage(json.errorCode ?? null),
            status: "ERROR",
            error: json.error,
            errorCode: json.errorCode,
          });
        } else {
          updateAssistantMessage({
            progressStep: step,
            progressPercent: percent,
          });
        }

        if (nextStatus === "READY" || nextStatus === "ERROR") {
          window.clearInterval(interval);
        }
      } catch {
        // best-effort polling
      }
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [versionId, status, updateAssistantMessage, tMsg]);

  /* ═══════════════════════ Handlers ═══════════════════════ */

  async function executeGeneration(params: {
    prompt: string;
    projectId?: string;
    refinementPrompt?: string;
  }) {
    lastRequestRef.current = params;
    setIsSubmitting(true);
    setGenerationStartTime(Date.now());
    setElapsedSeconds(0);
    // Clear versionId before GENERATING so the polling effect doesn't
    // re-activate with the old (READY) versionId while we wait for the API.
    setVersionId(null);
    setStatus("GENERATING");

    // Capture selectedFile locally so clearing it after the fetch doesn't
    // race with React state updates.
    const fileForThisRequest = selectedFile;

    try {
      let res: Response;
      if (fileForThisRequest) {
        // Multipart path — used when the user staged a reference document.
        const form = new FormData();
        form.append("prompt", params.prompt);
        if (params.projectId) form.append("projectId", params.projectId);
        if (params.refinementPrompt)
          form.append("refinementPrompt", params.refinementPrompt);
        if (turnstileToken) form.append("turnstileToken", turnstileToken);
        form.append("file", fileForThisRequest);
        // Do NOT set content-type; browser sets multipart/form-data with boundary.
        res = await fetch("/api/generate", {
          method: "POST",
          body: form,
        });
      } else {
        res = await fetch("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...params, turnstileToken }),
        });
      }

      const json = await res.json();
      if (!res.ok) {
        setStatus("ERROR");
        updateAssistantMessage({
          content: json?.error ?? errorCodeToMessage(json?.code),
          status: "ERROR",
          error: json?.error,
          errorCode: typeof json?.code === "string" ? json.code : undefined,
        });
        return;
      }

      setProjectId(json.projectId);
      setProjectName(json.projectName ?? null);
      setVersionId(json.versionId);
      setVersionNumber(json.versionNumber ?? 1);
      setStatus(json.status as GenerationStatus);

      // Clear the staged file only on successful enqueue — if the request
      // failed, keep the file so the user can retry without re-picking.
      setSelectedFile(null);
    } catch {
      setStatus("ERROR");
      updateAssistantMessage({
        content: tMsg("networkError"),
        status: "ERROR",
        error: "Network error",
      });
    } finally {
      setIsSubmitting(false);
      // Clear token so the widget issues a fresh one for the next request.
      setTurnstileToken(null);
      turnstileResetRef.current?.();
    }
  }

  const removeReferenceDocument = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/references/current`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (res.ok) {
        setCurrentReferenceDocument(null);
      }
    } catch {
      // best-effort — leave the UI state as-is and let the user retry
    }
  }, [projectId]);

  async function handleSubmit() {
    const text = inputValue.trim();
    if (!canSubmit) return;

    const isFirstPrompt = phase === "landing";
    const isRefinement = projectId !== null;

    if (!isRefinement) {
      setOriginalPrompt(text);
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: isRefinement ? tMsg("applyingChanges") : tMsg("buildingWebsite"),
      timestamp: Date.now(),
      status: "GENERATING",
      progressStep: "starting",
      progressPercent: 0,
    };

    currentAssistantMsgId.current = assistantMsg.id;
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInputValue("");

    // Optimistically show a pending chip so the builder UI reflects the
    // attached file immediately. The server-side ReferenceDocument row is
    // created by the worker's ingestDocument step, so a bare projectId
    // fetch right after enqueue would otherwise return null and leave the
    // chip empty. Real server state replaces this once ingestion lands.
    if (selectedFile) {
      setCurrentReferenceDocument({
        id: `optimistic-${crypto.randomUUID()}`,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        status: "pending",
      });
    }

    if (isFirstPrompt) {
      setPhase("builder");
      setTimeout(() => sidebarInputRef.current?.focus(), 400);
    }

    const params = isRefinement
      ? {
          prompt: originalPrompt,
          projectId: projectId!,
          refinementPrompt: text,
        }
      : { prompt: text };

    await executeGeneration(params);
  }

  async function handleRetry() {
    const last = lastRequestRef.current;
    if (!last || isSubmitting || status === "GENERATING") return;

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: tMsg("retrying"),
      timestamp: Date.now(),
      status: "GENERATING",
      progressStep: "starting",
      progressPercent: 0,
    };

    currentAssistantMsgId.current = assistantMsg.id;
    setMessages((prev) => [...prev, assistantMsg]);

    await executeGeneration(last);
  }

  function handleNewProject() {
    clearSession();
    setPhase("landing");
    setMessages([]);
    setInputValue("");
    setOriginalPrompt("");
    setProjectId(null);
    setProjectName(null);
    setVersionId(null);
    setStatus("DRAFT");
    setIsSubmitting(false);
    setVersionNumber(0);
    setMobileView("chat");
    currentAssistantMsgId.current = null;
    lastRequestRef.current = null;
    setGenerationStartTime(null);
    setElapsedSeconds(0);
    setTurnstileToken(null);
    turnstileResetRef.current?.();
    // Reference material is per-project, so a new project starts fresh.
    setSelectedFile(null);
    setCurrentReferenceDocument(null);
    // Focus the landing textarea after the phase transition animation starts
    setTimeout(() => landingInputRef.current?.focus(), 400);
  }

  async function togglePreviewFullscreen() {
    const el = previewWrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    try {
      await el.requestFullscreen();
    } catch {
      /* unsupported */
    }
  }

  function openPreviewInNewTab() {
    if (!versionId) return;
    window.open(`/preview/${versionId}`, "_blank", "noopener,noreferrer");
  }

  function downloadPreviewHtml() {
    if (!versionId) return;
    // The server sets Content-Disposition with a sanitized filename based on
    // the project name — no client-side blob or filename handling needed.
    // A plain anchor navigation lets the browser honor the attachment header
    // natively.
    const a = document.createElement("a");
    a.href = `/api/versions/${versionId}/export`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return {
    // Phase
    phase,
    mobileView,
    setMobileView,
    // Chat
    messages,
    inputValue,
    setInputValue,
    canSubmit,
    // Generation
    status,
    isSubmitting,
    projectId,
    projectName,
    versionId,
    versionNumber,
    elapsedSeconds,
    // Preview
    isPreviewFullscreen,
    previewWrapRef,
    // Handlers
    handleSubmit,
    handleRetry,
    handleNewProject,
    togglePreviewFullscreen,
    openPreviewInNewTab,
    downloadPreviewHtml,
    // Turnstile
    setTurnstileToken,
    turnstileResetRef,
    // Reference material (Phase 1 RAG)
    selectedFile,
    setSelectedFile,
    currentReferenceDocument,
    setCurrentReferenceDocument,
    removeReferenceDocument,
    // UI
    isInfoOpen,
    setIsInfoOpen,
    isMac,
    // Refs
    messagesEndRef,
    sidebarInputRef,
    landingInputRef,
  };
}
