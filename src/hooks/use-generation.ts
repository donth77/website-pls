import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import type { ChatMessage, GenerationStatus } from "@/lib/types";
import { ErrorCode } from "@/lib/types";
import { MAX_USER_PROMPT_CHARS } from "@/lib/ai/promptSafety";
import type { ReferenceDocumentInfo } from "@/components/generator/project-reference-material";
import { useByok } from "@/lib/byok/context";
import {
  isAnthropicThinkingCapable,
  isOpenAIReasoningModel,
  resolveModelId,
} from "@/lib/byok/providers";
import {
  fire as fireDesktopNotification,
  getPermission as getNotificationPermission,
  isSupported as notificationsSupported,
  requestPermission as requestNotificationPermission,
} from "@/lib/notifications/desktop";
import {
  loadOptIn as loadNotifyOptIn,
  saveOptIn as saveNotifyOptIn,
} from "@/lib/notifications/preference";

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
  /** Owner identifier at save time. On restore, if this doesn't match the
   *  current session we discard the state — prevents one account's
   *  editor content from leaking into another account after a sign-out
   *  → sign-in switch. `null` means "saved while signed out / as guest". */
  ownerId: string | null;
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
  const tErr = useTranslations("ErrorCode");
  const tNotify = useTranslations("Notify");
  const { data: session, status: sessionStatus } = useSession();
  // Owner identifier used to tag persisted state, so we can detect a
  // restore that belongs to a different account after a sign-in switch.
  const currentOwnerId: string | null = session?.user?.id ?? null;
  // Tiny wrapper: localized errorCodeToMessage. Falls back to DEFAULT
  // for unknown codes so the UI never shows a raw key path.
  const localizedErrorMessage = useCallback(
    (code: string | null | undefined): string => {
      if (!code) return tErr("DEFAULT");
      try {
        return tErr(code);
      } catch {
        return tErr("DEFAULT");
      }
    },
    [tErr],
  );
  const byok = useByok();
  // Destructure the stable callbacks so effects can depend on them
  // without re-firing when other byok state toggles.
  const { setPromptReason } = byok;

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

  /* ── Desktop notifications ── */
  // Persisted opt-in (the user clicked "Notify me when done" or toggled it
  // in settings). Hydrated from localStorage after mount to avoid SSR/CSR
  // divergence. Browser-permission state is checked separately at fire time.
  const [notifyOptedIn, setNotifyOptedIn] = useState(false);
  // Per-generation: true if the user dismissed the 30s prompt for this run.
  // Reset on every new generation so each run gets one chance to opt in.
  const notifyDismissedRef = useRef(false);
  // True once the current run has fired its terminal notification — guards
  // against the polling effect re-firing on subsequent ticks.
  const notifiedThisRunRef = useRef(false);

  /* ── BYOK locked-key gate ── */
  // When the user submits while their BYOK key is encrypted-locked, we
  // stash the prompt text here, open the unlock modal, and bail. After
  // unlock succeeds, an effect picks the stash up and resumes the
  // submit. Cleared on cancel or key deletion.
  const pendingSubmitTextRef = useRef<string | null>(null);

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
  // 30s threshold matches Claude: short generations don't need a prompt.
  // The toast appears only when notifications are supported, the user
  // hasn't denied permission outright, hasn't already opted in, and
  // hasn't dismissed it for this run.
  const showNotifyPrompt =
    status === "GENERATING" &&
    elapsedSeconds >= 30 &&
    notificationsSupported() &&
    getNotificationPermission() !== "denied" &&
    !notifyOptedIn &&
    !notifyDismissedRef.current;

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
      ownerId: currentOwnerId,
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
    currentOwnerId,
  ]);

  /* ── Account-switch detection ──
     If the persisted state belongs to a different owner (sign-out then
     sign-in to a different account, or guest → user), discard it and
     reset to a fresh landing-page state. Skip while the session is
     still loading so we don't false-positive on initial hydration. */
  const accountSwitchHandledRef = useRef(false);
  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (accountSwitchHandledRef.current) return;
    if (!init) {
      accountSwitchHandledRef.current = true;
      return;
    }
    if (init.ownerId !== currentOwnerId) {
      accountSwitchHandledRef.current = true;
      handleNewProject();
    } else {
      accountSwitchHandledRef.current = true;
    }
    // handleNewProject is defined later in this hook; it's stable for the
    // lifetime of the hook so it's safe to call from a setup-time effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus, currentOwnerId]);

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

  // Hydrate the notify-opt-in preference from localStorage on mount.
  // SSR-safe: server renders with `false` and the effect adjusts client-side.
  useEffect(() => {
    if (loadNotifyOptIn()) setNotifyOptedIn(true);
  }, []);

  // Fire a desktop notification on terminal status transitions when the
  // user is opted in. Guarded by `notifiedThisRunRef` so we don't double-
  // fire (the effect re-runs on every status change, and on session
  // restore the initial render may already be READY). The fire helper
  // itself short-circuits when the tab is focused.
  useEffect(() => {
    if (!notifyOptedIn) return;
    if (status !== "READY" && status !== "ERROR") return;
    if (notifiedThisRunRef.current) return;
    notifiedThisRunRef.current = true;
    fireDesktopNotification({
      title:
        status === "READY"
          ? tNotify("completedTitle")
          : tNotify("errorTitle"),
      body:
        status === "READY"
          ? tNotify("completedBody")
          : tNotify("errorBody"),
      tag: "websitepls-generation",
    });
  }, [status, notifyOptedIn, tNotify]);

  // Auto-resume after the user unlocks an encrypted BYOK key. If they
  // delete the key instead (status → "none"), drop the stash without
  // firing — running on the platform key after an explicit destructive
  // action would be presumptuous. The microtask gap lets React flush
  // the new `byok.activeKey` value before doSubmit reads headers.
  //
  // We close the modal here so the user lands cleanly in the editor with
  // their generation kicking off. Manual-unlock cases (user opened the
  // modal themselves to unlock, no pending submit) leave the modal open
  // so they can tweak model/reasoning — that's gated by `pending`.
  useEffect(() => {
    const pending = pendingSubmitTextRef.current;
    if (!pending) return;
    if (byok.status === "encrypted-unlocked") {
      pendingSubmitTextRef.current = null;
      byok.closeModal();
      queueMicrotask(() => {
        void doSubmitRef.current(pending);
      });
    } else if (byok.status === "none") {
      pendingSubmitTextRef.current = null;
    }
  }, [byok.status, byok]);

  // Clear the stash when the user closes the modal without unlocking
  // (cancel / Esc / backdrop click). Keeps the typed prompt in the
  // input so they can recover their place.
  useEffect(() => {
    if (
      !byok.isModalOpen &&
      byok.status === "encrypted-locked" &&
      pendingSubmitTextRef.current !== null
    ) {
      pendingSubmitTextRef.current = null;
    }
  }, [byok.isModalOpen, byok.status]);

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
          // PLATFORM_BUDGET_LOW is the only error the worker raises that
          // should drive a banner — RATE_LIMIT and GENERATION_LIMIT can't
          // reach worker code (they reject at the API route).
          if (json.errorCode === ErrorCode.PLATFORM_BUDGET_LOW) {
            setPromptReason("platform-budget-low");
          }
          // Prefer the persisted Anthropic/worker error string when present:
          // "credit balance is too low" beats "Something went wrong" any day.
          // Fall back to the generic code-to-copy table otherwise.
          const content =
            typeof json.errorMessage === "string" && json.errorMessage
              ? json.errorMessage
              : localizedErrorMessage(json.errorCode ?? null);
          updateAssistantMessage({
            content,
            status: "ERROR",
            error: json.errorMessage ?? json.error,
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
  }, [
    versionId,
    status,
    updateAssistantMessage,
    tMsg,
    setPromptReason,
    localizedErrorMessage,
  ]);

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
    // Each new run gets its own chance to opt into notifications and one
    // terminal fire. Reset the flags so the toast re-appears (if applicable)
    // and the completion effect can fire once for this run.
    notifyDismissedRef.current = false;
    notifiedThisRunRef.current = false;
    // Clear versionId before GENERATING so the polling effect doesn't
    // re-activate with the old (READY) versionId while we wait for the API.
    setVersionId(null);
    setStatus("GENERATING");

    // Capture selectedFile locally so clearing it after the fetch doesn't
    // race with React state updates.
    const fileForThisRequest = selectedFile;

    // BYOK headers — only when an unlocked key is in the vault. The server
    // ignores model/provider when no key is supplied. Model is per-provider:
    // if the user hasn't picked one explicitly, omit the header and let
    // the server pick its provider-specific default.
    const byokHeaders: Record<string, string> = {};
    if (byok.activeKey && byok.storedProvider) {
      byokHeaders["x-byok-provider"] = byok.storedProvider;
      byokHeaders["x-byok-key"] = byok.activeKey;
      const model = byok.modelByProvider[byok.storedProvider];
      if (model) byokHeaders["x-byok-model"] = model;

      // Reasoning controls. Value shape is provider-specific:
      //   - OpenAI:    "none" | "low" | "medium" | "high" | "xhigh"
      //   - Anthropic: "on" when the thinking toggle is enabled
      //   - OpenRouter: never set; we don't try to manage cross-provider
      //     reasoning hints through the gateway.
      //
      // Gate by capability — only send when the UI would render the
      // control. A stale dial value shouldn't silently apply after the
      // user switches to a model that doesn't surface it (e.g. set
      // "high" on gpt-5.5 then switch to gpt-5.4-mini).
      const wireModelId = resolveModelId(
        byok.storedProvider,
        model || null,
      );
      if (
        byok.storedProvider === "openai" &&
        isOpenAIReasoningModel(wireModelId)
      ) {
        byokHeaders["x-byok-reasoning"] = byok.openaiReasoning;
      } else if (
        byok.storedProvider === "anthropic" &&
        byok.anthropicThinking &&
        isAnthropicThinkingCapable(wireModelId)
      ) {
        byokHeaders["x-byok-reasoning"] = "on";
      }
    }

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
          headers: byokHeaders,
          body: form,
        });
      } else {
        res = await fetch("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json", ...byokHeaders },
          body: JSON.stringify({ ...params, turnstileToken }),
        });
      }

      const json = await res.json();
      if (!res.ok) {
        // Map API error codes to the appropriate BYOK affordance.
        // BYOK_INVALID re-opens the modal so the user can fix the key.
        // PLATFORM_BUDGET_LOW / RATE_LIMIT / GENERATION_LIMIT all surface
        // the banner with copy tailored to the reason — but only when the
        // user isn't already on the BYOK path (banner self-suppresses).
        const code = json?.code;
        if (code === ErrorCode.BYOK_INVALID) {
          byok.openModal();
        } else if (code === ErrorCode.PLATFORM_BUDGET_LOW) {
          setPromptReason("platform-budget-low");
        } else if (code === ErrorCode.GENERATION_LIMIT) {
          setPromptReason("user-cap");
        } else if (code === ErrorCode.RATE_LIMIT) {
          setPromptReason("rate-limit");
        }
        setStatus("ERROR");
        updateAssistantMessage({
          content: json?.error ?? localizedErrorMessage(code),
          status: "ERROR",
          error: json?.error,
          errorCode: typeof code === "string" ? code : undefined,
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

  /**
   * Submit body, separated from handleSubmit so the locked-key path
   * can defer it. Reads fresh closure values when invoked from the
   * auto-resume effect after unlock.
   */
  async function doSubmit(text: string) {
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

  // Stable ref to the latest doSubmit so the auto-resume effect can
  // invoke it without depending on every closed-over hook state.
  const doSubmitRef = useRef(doSubmit);
  doSubmitRef.current = doSubmit;

  async function handleSubmit() {
    const text = inputValue.trim();
    if (!canSubmit) return;

    // Locked-key gate: don't fall through to the platform key silently.
    // Stash the prompt text and open the unlock modal — the user must
    // either unlock (auto-resumes via the effect below) or delete the
    // key (clears the stash, no auto-fire). Their typed prompt stays in
    // the input so they can recover it if they cancel.
    if (byok.status === "encrypted-locked") {
      pendingSubmitTextRef.current = text;
      byok.openModal();
      return;
    }

    await doSubmit(text);
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

  /** User clicked "Notify me when done" in the toast (or the settings
   *  toggle). Triggers the permission prompt if needed, persists the
   *  opt-in, and hides the toast for this run. */
  async function enableNotifications(): Promise<{
    ok: boolean;
    reason?: string;
  }> {
    const result = await requestNotificationPermission();
    if (result === "granted") {
      saveNotifyOptIn(true);
      setNotifyOptedIn(true);
      return { ok: true };
    }
    return {
      ok: false,
      reason:
        result === "denied" ? tNotify("blockedHint") : tNotify("unsupported"),
    };
  }

  /** Settings toggle path — turning it off after granting permission. */
  function disableNotifications() {
    saveNotifyOptIn(false);
    setNotifyOptedIn(false);
  }

  /** User dismissed the 30s toast — don't show it again for this run. */
  function dismissNotifyPrompt() {
    notifyDismissedRef.current = true;
    // Force re-render so showNotifyPrompt flips false immediately.
    setElapsedSeconds((s) => s);
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
    // Notifications
    notifyOptedIn,
    showNotifyPrompt,
    enableNotifications,
    disableNotifications,
    dismissNotifyPrompt,
    // Refs
    messagesEndRef,
    sidebarInputRef,
    landingInputRef,
  };
}
