"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useGeneration } from "@/hooks/use-generation";
import { Landing } from "./landing";
import { ChatSidebar } from "../chat/chat-sidebar";
import { PreviewPanel } from "./preview-panel";
import { InfoModal } from "../ui/info-modal";
import { PublishModal, type PublishedState } from "../publish-modal";
import { TurnstileWidget } from "../turnstile-widget";
import { useTabStore, TabList, Tab } from "@ariakit/react";

const DEFAULT_SIDEBAR_FRACTION = 1 / 3;
const MIN_SIDEBAR_REM = 20;
const MAX_PANEL_FRACTION = 0.5;
const COLLAPSE_THRESHOLD_REM = 14;

/**
 * sessionStorage key for the cached publish state. Kept separate from the
 * main `useGeneration` persistence (which owns project/version/messages) so
 * each concern writes through independently.
 */
const PUBLISH_SESSION_KEY = "websitepls:publishedEntry";

type PublishedEntry = {
  projectId: string;
  value: PublishedState | null;
};

/**
 * Restore the publish-state cache from sessionStorage. Wrapped in try/catch
 * so SSR (where sessionStorage is undefined) and quota/parse errors return
 * null cleanly — the fetch effect will then populate it normally.
 */
function loadPublishedEntry(): PublishedEntry | null {
  try {
    const raw = sessionStorage.getItem(PUBLISH_SESSION_KEY);
    return raw ? (JSON.parse(raw) as PublishedEntry) : null;
  } catch {
    return null;
  }
}

/**
 * Mirror the current publish-state cache into sessionStorage. Called from
 * a write-through effect whenever `publishedEntry` changes.
 */
function savePublishedEntry(entry: PublishedEntry | null): void {
  try {
    if (entry) {
      sessionStorage.setItem(PUBLISH_SESSION_KEY, JSON.stringify(entry));
    } else {
      sessionStorage.removeItem(PUBLISH_SESSION_KEY);
    }
  } catch {
    /* quota or unavailable — drop silently */
  }
}

export function GeneratorApp() {
  const tChat = useTranslations("Chat");
  const tPreview = useTranslations("Preview");
  const { status: sessionStatus } = useSession();
  const {
    phase,
    mobileView,
    setMobileView,
    messages,
    inputValue,
    setInputValue,
    canSubmit,
    status,
    isSubmitting,
    projectId,
    projectName,
    versionId,
    versionNumber,
    elapsedSeconds,
    isPreviewFullscreen,
    previewWrapRef,
    handleSubmit,
    handleRetry,
    handleNewProject,
    togglePreviewFullscreen,
    openPreviewInNewTab,
    downloadPreviewHtml,
    setTurnstileToken,
    turnstileResetRef,
    isInfoOpen,
    setIsInfoOpen,
    isMac,
    messagesEndRef,
    sidebarInputRef,
    landingInputRef,
  } = useGeneration();

  const mobileTabStore = useTabStore({
    selectedId: mobileView,
    setSelectedId(id) {
      if (id === "chat" || id === "preview") setMobileView(id);
    },
  });

  /* ═══════════════ Resizable + collapsible sidebar ═══════════════ */
  const [sidebarFraction, setSidebarFraction] = useState(
    DEFAULT_SIDEBAR_FRACTION,
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const builderRef = useRef<HTMLDivElement>(null);
  const sidebarPanelRef = useRef<HTMLDivElement>(null);
  const fractionBeforeCollapse = useRef(DEFAULT_SIDEBAR_FRACTION);

  function clampFraction(raw: number, containerWidth: number): number {
    const remPx = parseFloat(
      getComputedStyle(document.documentElement).fontSize,
    );
    const minFraction = (MIN_SIDEBAR_REM * remPx) / containerWidth;
    return Math.min(Math.max(raw, minFraction), MAX_PANEL_FRACTION);
  }

  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const el = sidebarPanelRef.current;
    const container = builderRef.current;
    if (!el || !container) return;

    flushSync(() => setIsDragging(true));
    el.style.transitionDuration = "0s";
    el.style.transitionDelay = "0s";

    let lastGoodFraction = sidebarFraction;
    let collapsed = false;

    const onMove = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const rawFraction = (ev.clientX - rect.left) / rect.width;
      const remPx = parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      const collapseThreshold = (COLLAPSE_THRESHOLD_REM * remPx) / rect.width;

      if (rawFraction < collapseThreshold) {
        if (!collapsed) fractionBeforeCollapse.current = lastGoodFraction;
        collapsed = true;
        el.style.width = "0px";
      } else {
        collapsed = false;
        const clamped = clampFraction(rawFraction, rect.width);
        lastGoodFraction = clamped;
        el.style.width = `${clamped * 100}%`;
      }
    };

    const onUp = () => {
      el.style.transitionDuration = "";
      el.style.transitionDelay = "";
      el.style.width = "";
      setIsDragging(false);
      setIsSidebarCollapsed(collapsed);
      if (!collapsed) setSidebarFraction(lastGoodFraction);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  const toggleSidebar = useCallback(() => {
    const el = sidebarPanelRef.current;
    if (el) {
      el.style.transition = "width 300ms ease-out";
      // Clear the temporary transition after it plays
      const cleanup = () => {
        el.style.transition = "";
      };
      el.addEventListener("transitionend", cleanup, { once: true });
      // Fallback in case transitionend doesn't fire
      setTimeout(cleanup, 350);
    }
    if (isSidebarCollapsed) {
      setIsSidebarCollapsed(false);
      setSidebarFraction(fractionBeforeCollapse.current);
    } else {
      fractionBeforeCollapse.current = sidebarFraction;
      setIsSidebarCollapsed(true);
    }
  }, [isSidebarCollapsed, sidebarFraction]);

  /* ═══════════════ Publish state ═══════════════ */
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  // Keyed on projectId so swapping projects clears stale publish data
  // via derived state rather than a state-resetting effect.
  //
  // Lazy-initialised from sessionStorage so navigating back to the editor
  // restores the published state synchronously on first render. Without this
  // cache, every remount starts with `null`, and the brief window before the
  // `/api/projects/{id}` fetch resolves causes the toolbar to flash "Publish"
  // before flipping to "Published". The fetch below still runs as a refresh,
  // so the cache self-heals if it's wrong.
  const [publishedEntry, setPublishedEntry] = useState<{
    projectId: string;
    value: PublishedState | null;
  } | null>(() => loadPublishedEntry());

  // Write-through: whenever publishedEntry changes (fetch result, publish,
  // unpublish, project swap to null), mirror it into sessionStorage so the
  // next mount restores instantly.
  useEffect(() => {
    savePublishedEntry(publishedEntry);
  }, [publishedEntry]);

  // Fetch publish state whenever projectId changes. No deduping ref:
  // StrictMode's double-invocation preserves refs across the two runs, so
  // a ref-based gate skips the second run and the first run's cancelled
  // cleanup silently drops its fetch — leaving publishedEntry unset. Two
  // parallel fetches are harmless; the cleanup's `cancelled` flag keeps
  // stale results from clobbering fresh ones.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { publishedSite?: PublishedState | null } | null) => {
        if (cancelled) return;
        setPublishedEntry({
          projectId,
          value: data?.publishedSite ?? null,
        });
      })
      .catch(() => {
        /* best-effort — button stays in unknown state until next fetch */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Derived: only expose publish state that matches the current projectId.
  // Swapping projects instantly hides stale data without a state reset.
  const publishedState =
    publishedEntry && publishedEntry.projectId === projectId
      ? publishedEntry.value
      : null;

  const isAuthenticated = sessionStatus === "authenticated";
  const hasUnpublishedChanges =
    !!publishedState &&
    versionNumber !== null &&
    versionNumber > publishedState.publishedVersionNumber;

  const handlePublishedChange = useCallback(
    (value: PublishedState | null) => {
      if (!projectId) return;
      setPublishedEntry({ projectId, value });
    },
    [projectId],
  );

  /* ═══════════════ Mobile card-swipe ═══════════════ */
  const mobileTrackRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const isSwiping = useRef(false);

  function handleTouchStart(e: React.TouchEvent) {
    const track = mobileTrackRef.current;
    // display:contents on desktop → offsetWidth 0 → skip
    if (!track || track.offsetWidth === 0) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isSwiping.current = false;
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const track = mobileTrackRef.current;
    if (!track) return;

    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;

    // First significant move decides the axis
    if (!isSwiping.current) {
      // Vertical wins → bail permanently for this gesture
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
        touchStartX.current = null;
        touchStartY.current = null;
        return;
      }
      // Horizontal wins → lock into swipe mode
      if (Math.abs(dx) > 8) {
        isSwiping.current = true;
        track.style.transition = "none";
      } else {
        return;
      }
    }

    // Move the track with the finger
    const panelWidth = track.offsetWidth;
    const base = mobileView === "chat" ? 0 : -panelWidth;
    const offset = Math.max(Math.min(base + dx, 0), -panelWidth);
    track.style.transform = `translateX(${offset}px)`;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const track = mobileTrackRef.current;
    if (!track || !isSwiping.current || touchStartX.current === null) {
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }

    const dx = e.changedTouches[0].clientX - touchStartX.current;

    // Any directional swipe commits — no threshold
    let newView = mobileView;
    if (dx < 0 && mobileView === "chat") newView = "preview";
    if (dx > 0 && mobileView === "preview") newView = "chat";

    // Enable transition and set the target transform directly on the DOM.
    // The CSS transition animates from the finger-release position to the
    // target.
    track.style.transition = "transform 300ms ease-out";
    track.style.transform =
      newView === "chat" ? "translateX(0)" : "translateX(-100%)";

    // Update tab bar (async is fine, only changes the tab highlight)
    if (newView !== mobileView) setMobileView(newView);

    touchStartX.current = null;
    touchStartY.current = null;
    isSwiping.current = false;
  }

  /* ═══════════════ Keyboard shortcut ═══════════════ */
  useEffect(() => {
    if (phase !== "builder") return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, toggleSidebar]);

  /* ═══════════════ Derived ═══════════════ */
  const generatingMsg = messages.find(
    (m) => m.role === "assistant" && m.status === "GENERATING",
  );

  const sidebarWidth = isSidebarCollapsed ? "0%" : `${sidebarFraction * 100}%`;

  /* ═══════════════ Render ═══════════════ */
  return (
    <div className="relative flex h-full flex-1 overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* ════════════════════ LANDING ════════════════════ */}
      <div
        className={`absolute inset-0 z-10 flex flex-col items-center justify-center px-6 transition-all duration-500 ease-out ${
          phase === "builder"
            ? "pointer-events-none scale-[0.98] opacity-0"
            : "scale-100 opacity-100"
        }`}
        style={{
          background:
            "radial-gradient(ellipse at 50% 40%, rgba(139, 92, 246, 0.06) 0%, transparent 70%)",
        }}
      >
        <Landing
          inputValue={inputValue}
          onInputChange={setInputValue}
          onSubmit={() => void handleSubmit()}
          canSubmit={canSubmit}
          isMac={isMac}
          onInfoOpen={() => setIsInfoOpen(true)}
          textareaRef={landingInputRef}
          turnstile={
            <TurnstileWidget
              onToken={setTurnstileToken}
              onExpire={() => setTurnstileToken(null)}
              onError={() => setTurnstileToken(null)}
              resetRef={turnstileResetRef}
            />
          }
        />
      </div>

      {/* ════════════════════ BUILDER ════════════════════ */}
      <div
        ref={builderRef}
        className={`flex h-full w-full flex-col md:flex-row ${
          phase === "builder" ? "" : "pointer-events-none"
        }`}
      >
        {/* ── Mobile tab bar ── */}
        <TabList
          store={mobileTabStore}
          aria-label="Chat and preview"
          className={`flex shrink-0 border-b border-zinc-200 transition-opacity duration-300 md:hidden dark:border-zinc-800 ${
            phase === "builder" ? "opacity-100" : "opacity-0"
          }`}
        >
          <Tab
            id="chat"
            className={`flex-1 py-2.5 text-center text-sm font-medium transition ${
              mobileView === "chat"
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {tChat("tab")}
          </Tab>
          <Tab
            id="preview"
            className={`flex-1 py-2.5 text-center text-sm font-medium transition ${
              mobileView === "preview"
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {tPreview("tab")}
            {status === "READY" && (
              <>
                <span
                  className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-green-500"
                  aria-hidden="true"
                />
                <span className="sr-only">(ready)</span>
              </>
            )}
          </Tab>
        </TabList>

        {/*
          Mobile: outer clips overflow, inner is a 200%-wide track.
          Desktop: both wrappers become display:contents so children
          participate directly in the builder's flex-row.

          Touch handlers live here
        */}
        <div
          className="flex-1 overflow-hidden md:contents"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            ref={mobileTrackRef}
            className="flex h-full touch-pan-y will-change-transform md:contents"
            style={{
              transition: "transform 300ms ease-out",
              transform:
                mobileView === "preview"
                  ? "translateX(-100%)"
                  : "translateX(0)",
            }}
          >
            {/* ── Sidebar (Chat) ── */}
            <div
              ref={sidebarPanelRef}
              className={`flex w-full shrink-0 flex-col overflow-hidden transition-[opacity,transform] duration-300 ease-out md:flex-none ${
                phase === "builder"
                  ? "translate-x-0 opacity-100"
                  : "-translate-x-4 opacity-0"
              }`}
              style={{
                transitionDelay: phase === "builder" ? "150ms" : "0ms",
                ...({ "--sidebar-w": sidebarWidth } as React.CSSProperties),
              }}
            >
              <ChatSidebar
                messages={messages}
                inputValue={inputValue}
                onInputChange={setInputValue}
                onSubmit={() => void handleSubmit()}
                onRetry={() => void handleRetry()}
                canSubmit={canSubmit}
                status={status}
                isSubmitting={isSubmitting}
                projectName={projectName}
                versionNumber={versionNumber}
                elapsedSeconds={elapsedSeconds}
                onNewProject={handleNewProject}
                onInfoOpen={() => setIsInfoOpen(true)}
                onToggleSidebar={toggleSidebar}
                isSidebarCollapsed={isSidebarCollapsed}
                messagesEndRef={messagesEndRef}
                sidebarInputRef={sidebarInputRef}
                turnstile={
                  <TurnstileWidget
                    onToken={setTurnstileToken}
                    onExpire={() => setTurnstileToken(null)}
                    onError={() => setTurnstileToken(null)}
                    resetRef={turnstileResetRef}
                  />
                }
              />
            </div>

            {/* ── Resize divider (desktop only) ── */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              className={`group relative hidden shrink-0 cursor-col-resize touch-none items-center justify-center md:flex ${
                isDragging ? "z-30" : ""
              } ${phase === "builder" ? "opacity-100" : "opacity-0"}`}
              style={{
                width: "9px",
                marginLeft: "-4px",
                marginRight: "-4px",
              }}
              onPointerDown={handlePointerDown}
              onDoubleClick={() => {
                setIsSidebarCollapsed(false);
                setSidebarFraction(DEFAULT_SIDEBAR_FRACTION);
              }}
            >
              <div
                className={`h-full w-px transition-colors ${
                  isDragging
                    ? "bg-indigo-500"
                    : "bg-zinc-200 group-hover:bg-zinc-400 dark:bg-zinc-700 dark:group-hover:bg-zinc-500"
                }`}
              />
            </div>

            {/* ── Preview Panel ── */}
            <div
              className={`flex w-full shrink-0 flex-col bg-zinc-50 transition-[opacity,transform] duration-500 ease-out md:min-w-0 md:flex-1 md:shrink dark:bg-zinc-900 ${
                phase === "builder"
                  ? "translate-x-0 opacity-100"
                  : "translate-x-4 opacity-0"
              }`}
              style={{
                transitionDelay: phase === "builder" ? "300ms" : "0ms",
              }}
            >
              <PreviewPanel
                status={status}
                versionId={versionId}
                isPreviewFullscreen={isPreviewFullscreen}
                previewWrapRef={previewWrapRef}
                onToggleFullscreen={() => void togglePreviewFullscreen()}
                onOpenNewTab={openPreviewInNewTab}
                onDownload={() => void downloadPreviewHtml()}
                progressStep={generatingMsg?.progressStep}
                onToggleSidebar={toggleSidebar}
                isSidebarCollapsed={isSidebarCollapsed}
                onPublish={
                  isAuthenticated && projectId
                    ? () => setIsPublishModalOpen(true)
                    : undefined
                }
                isPublished={!!publishedState}
                hasUnpublishedChanges={hasUnpublishedChanges}
              />
            </div>
          </div>
        </div>

        {/* Drag overlay — prevents iframe from stealing pointer events */}
        {isDragging && (
          <div
            className="fixed inset-0 z-20 cursor-col-resize"
            aria-hidden="true"
          />
        )}
      </div>

      {/* ════════════════════ INFO MODAL ════════════════════ */}
      <InfoModal isOpen={isInfoOpen} onClose={() => setIsInfoOpen(false)} />

      {/* ════════════════════ PUBLISH MODAL ════════════════════ */}
      {projectId && (
        <PublishModal
          isOpen={isPublishModalOpen}
          onClose={() => setIsPublishModalOpen(false)}
          projectId={projectId}
          projectName={projectName}
          currentVersionNumber={versionNumber}
          published={publishedState}
          onPublished={handlePublishedChange}
          onUnpublished={() => handlePublishedChange(null)}
        />
      )}
    </div>
  );
}
