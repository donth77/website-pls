import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, GenerationStatus } from "@/lib/types";
import { errorCodeToMessage } from "@/lib/types";
import { MAX_USER_PROMPT_CHARS } from "@/lib/ai/promptSafety";

const SESSION_KEY = "websitepls:generation";

interface PersistedState {
  phase: "landing" | "builder";
  projectId: string | null;
  versionId: string | null;
  status: GenerationStatus;
  versionNumber: number;
  originalPrompt: string;
  messages: ChatMessage[];
  generationStartTime: number | null;
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
      versionId,
      status,
      versionNumber,
      originalPrompt,
      messages,
      generationStartTime,
    });
  }, [
    phase,
    projectId,
    versionId,
    status,
    versionNumber,
    originalPrompt,
    messages,
    generationStartTime,
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
            content: "Previous generation was interrupted. Please try again.",
            status: "ERROR",
          });
          return;
        }
        const json = await res.json();
        if (json.projectStatus === "ERROR" || json.projectStatus === "DRAFT") {
          setStatus(json.projectStatus as GenerationStatus);
          updateAssistantMessage({
            content: "Previous generation was interrupted. Please try again.",
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

        if (nextStatus === "READY") {
          updateAssistantMessage({
            content: "Your website is ready! Check out the preview.",
            status: "READY",
            progressStep: "Complete",
            progressPercent: 100,
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
  }, [versionId, status, updateAssistantMessage]);

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
    setStatus("GENERATING");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...params, turnstileToken }),
      });

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
      setVersionId(json.versionId);
      setVersionNumber(json.versionNumber ?? 1);
      setStatus(json.status as GenerationStatus);
    } catch {
      setStatus("ERROR");
      updateAssistantMessage({
        content: "Network error. Please check your connection and try again.",
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
      content: isRefinement
        ? "Applying your changes..."
        : "Building your website...",
      timestamp: Date.now(),
      status: "GENERATING",
      progressStep: "Starting\u2026",
      progressPercent: 0,
    };

    currentAssistantMsgId.current = assistantMsg.id;
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInputValue("");

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
      content: "Retrying\u2026",
      timestamp: Date.now(),
      status: "GENERATING",
      progressStep: "Starting\u2026",
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

  async function downloadPreviewHtml() {
    if (!versionId) return;
    try {
      const res = await fetch(`/preview/${versionId}`);
      if (!res.ok) return;
      const html = await res.text();
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "website.html";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      /* best-effort */
    }
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
    // UI
    isInfoOpen,
    setIsInfoOpen,
    isMac,
    // Refs
    messagesEndRef,
    sidebarInputRef,
  };
}
