"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useGeneration } from "@/hooks/use-generation";
import { Landing } from "./landing";
import { ChatSidebar } from "./chat-sidebar";
import { PreviewPanel } from "./preview-panel";
import { InfoModal } from "./info-modal";
import { TurnstileWidget } from "./turnstile-widget";

const DEFAULT_SIDEBAR_FRACTION = 1 / 3;
const MIN_SIDEBAR_REM = 20;
const MAX_PANEL_FRACTION = 0.5;
const COLLAPSE_THRESHOLD_REM = 14;

export function GeneratorApp() {
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
    versionId,
    versionNumber,
    secretToken,
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
  } = useGeneration();

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

  function toggleSidebar() {
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
  }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isSidebarCollapsed, sidebarFraction]);

  /* ═══════════════ Derived ═══════════════ */
  const generatingMsg = messages.find(
    (m) => m.role === "assistant" && m.status === "GENERATING",
  );

  const sidebarWidth = isSidebarCollapsed ? "0%" : `${sidebarFraction * 100}%`;

  /* ═══════════════ Render ═══════════════ */
  return (
    <div className="relative flex h-dvh overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
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
        />
        <div className="mt-3 flex justify-center">
          <TurnstileWidget
            onToken={setTurnstileToken}
            onExpire={() => setTurnstileToken(null)}
            onError={() => setTurnstileToken(null)}
            resetRef={turnstileResetRef}
          />
        </div>
      </div>

      {/* ════════════════════ BUILDER ════════════════════ */}
      <div
        ref={builderRef}
        className={`flex h-full w-full flex-col md:flex-row ${
          phase === "builder" ? "" : "pointer-events-none"
        }`}
      >
        {/* ── Mobile tab bar ── */}
        <div
          role="tablist"
          aria-label="Chat and preview"
          className={`flex shrink-0 border-b border-zinc-200 transition-opacity duration-300 md:hidden dark:border-zinc-800 ${
            phase === "builder" ? "opacity-100" : "opacity-0"
          }`}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mobileView === "chat"}
            className={`flex-1 py-2.5 text-center text-sm font-medium transition ${
              mobileView === "chat"
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
            onClick={() => setMobileView("chat")}
          >
            Chat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileView === "preview"}
            className={`flex-1 py-2.5 text-center text-sm font-medium transition ${
              mobileView === "preview"
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
            onClick={() => setMobileView("preview")}
          >
            Preview
            {status === "READY" && (
              <>
                <span
                  className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-green-500"
                  aria-hidden="true"
                />
                <span className="sr-only">(ready)</span>
              </>
            )}
          </button>
        </div>

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
                versionNumber={versionNumber}
                elapsedSeconds={elapsedSeconds}
                onNewProject={handleNewProject}
                onInfoOpen={() => setIsInfoOpen(true)}
                onToggleSidebar={toggleSidebar}
                isSidebarCollapsed={isSidebarCollapsed}
                messagesEndRef={messagesEndRef}
                sidebarInputRef={sidebarInputRef}
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
                secretToken={secretToken}
                isPreviewFullscreen={isPreviewFullscreen}
                previewWrapRef={previewWrapRef}
                onToggleFullscreen={() => void togglePreviewFullscreen()}
                onOpenNewTab={openPreviewInNewTab}
                onDownload={() => void downloadPreviewHtml()}
                progressStep={generatingMsg?.progressStep}
                onToggleSidebar={toggleSidebar}
                isSidebarCollapsed={isSidebarCollapsed}
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
    </div>
  );
}
