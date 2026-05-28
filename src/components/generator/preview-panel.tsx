import { useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  Globe,
  MousePointerClick,
  X,
  // Maximize2,
  // Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Button,
  Tooltip,
  TooltipAnchor,
  TooltipProvider,
} from "@ariakit/react";
import type { GenerationStatus } from "@/lib/types";
import { useInspector, type InspectorSelection } from "@/hooks/use-inspector";

const tooltipClass =
  "z-50 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900";

function IconButton({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider>
      <TooltipAnchor
        render={
          <Button onClick={onClick} className={className} aria-label={label} />
        }
      >
        {children}
      </TooltipAnchor>
      <Tooltip className={tooltipClass}>{label}</Tooltip>
    </TooltipProvider>
  );
}

export interface PreviewPanelProps {
  status: GenerationStatus;
  versionId: string | null;
  isPreviewFullscreen: boolean;
  previewWrapRef: React.RefObject<HTMLDivElement | null>;
  onToggleFullscreen: () => void;
  onOpenNewTab: () => void;
  onDownload: () => void;
  progressStep?: string;
  onToggleSidebar: () => void;
  isSidebarCollapsed: boolean;
  /**
   * Publish button wiring. Omit all three to hide the button (guest users,
   * landing page, etc.).
   */
  onPublish?: () => void;
  /** Whether the current project has an active published site. */
  isPublished?: boolean;
  /**
   * Whether the published version is older than the latest generated version.
   * When true, the button label becomes "Publish changes" as a subtle nudge.
   */
  hasUnpublishedChanges?: boolean;
  /**
   * Targeted element-edit handler. When provided, the "Inspect" toggle is
   * shown; selecting an element + submitting a prompt calls this. Omitted
   * in PR 1 (selection works, submit is a no-op) until generation is wired.
   */
  onElementEdit?: (selection: InspectorSelection, prompt: string) => void;
}

export function PreviewPanel({
  status,
  versionId,
  isPreviewFullscreen,
  previewWrapRef,
  onToggleFullscreen,
  onOpenNewTab,
  onDownload,
  progressStep,
  onToggleSidebar,
  isSidebarCollapsed,
  onPublish,
  isPublished,
  hasUnpublishedChanges,
  onElementEdit,
}: PreviewPanelProps) {
  const t = useTranslations("Preview");
  const tPublish = useTranslations("Publish");
  const tProgress = useTranslations("Progress");
  const previewSrc = versionId ? `/preview/${versionId}` : null;
  const [iframeLoaded, setIframeLoaded] = useState(false);

  /* ── Inspect-element ── */
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [inspectMode, setInspectMode] = useState(false);
  const [selection, setSelection] = useState<InspectorSelection | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const inspectAvailable = !!onElementEdit;

  useInspector({
    iframeRef,
    enabled: inspectMode,
    ready: iframeLoaded,
    onSelect: (sel) => {
      setSelection(sel);
      setInspectMode(false); // one selection per inspect session
    },
  });

  function clearSelection() {
    setSelection(null);
    setEditPrompt("");
  }

  function submitElementEdit() {
    const p = editPrompt.trim();
    if (!selection || p.length < 3 || !onElementEdit) return;
    onElementEdit(selection, p);
    clearSelection();
  }

  const iconBtnClass =
    "rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar — bottom on mobile, top on desktop */}
      <div className="order-last flex shrink-0 items-center justify-between border-t border-zinc-200 bg-white px-4 py-3 md:order-none md:border-t-0 md:border-b dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2">
          <IconButton
            label={isSidebarCollapsed ? t("showChat") : t("hideChat")}
            className={`hidden md:flex ${iconBtnClass}`}
            onClick={onToggleSidebar}
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </IconButton>
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t("title")}
          </span>
        </div>
        {status === "READY" && versionId && (
          <div className="flex items-center gap-1">
            {inspectAvailable && (
              <IconButton
                label={inspectMode ? t("inspectExit") : t("inspect")}
                // Desktop-first: inspect mode needs a fine pointer; hide on
                // touch/narrow layouts.
                className={`hidden md:flex ${iconBtnClass} ${
                  inspectMode
                    ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                    : ""
                }`}
                onClick={() => {
                  setInspectMode((v) => !v);
                  if (selection) clearSelection();
                }}
              >
                <MousePointerClick className="h-4 w-4" />
              </IconButton>
            )}
            {/* <IconButton
              label={
                isPreviewFullscreen ? t("exitFullscreen") : t("fullscreen")
              }
              className={iconBtnClass}
              onClick={onToggleFullscreen}
            >
              {isPreviewFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </IconButton> */}
            <IconButton
              label={t("openNewTab")}
              className={iconBtnClass}
              onClick={onOpenNewTab}
            >
              <ExternalLink className="h-4 w-4" />
            </IconButton>
            <IconButton
              label={t("downloadHtml")}
              className={iconBtnClass}
              onClick={onDownload}
            >
              <Download className="h-4 w-4" />
            </IconButton>
            {onPublish && (
              <Button
                onClick={onPublish}
                aria-label={
                  isPublished
                    ? hasUnpublishedChanges
                      ? tPublish("publishChanges")
                      : tPublish("managePublication")
                    : tPublish("publish")
                }
                className={
                  isPublished
                    ? "ml-1 flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
                    : "ml-1 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700"
                }
              >
                <Globe className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {isPublished
                    ? hasUnpublishedChanges
                      ? tPublish("publishChanges")
                      : tPublish("published")
                    : tPublish("publish")}
                </span>
                {isPublished && hasUnpublishedChanges && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-amber-500"
                    aria-hidden="true"
                  />
                )}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Preview content */}
      <div className="min-h-0 flex-1">
        {status === "READY" && previewSrc ? (
          <div
            key={previewSrc}
            ref={previewWrapRef}
            className={
              isPreviewFullscreen
                ? "relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-white [:fullscreen]:min-h-dvh [:fullscreen]:w-dvw"
                : "relative h-full w-full"
            }
          >
            {!iframeLoaded && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white dark:bg-zinc-900">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-indigo-500 dark:border-zinc-700 dark:border-t-indigo-400" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {t("loading")}
                </p>
              </div>
            )}
            {/* {isPreviewFullscreen && (
              <Button
                onClick={onToggleFullscreen}
                className="absolute top-3 right-3 z-20 rounded-lg bg-black/60 p-2 text-white backdrop-blur-sm transition hover:bg-black/80"
                aria-label={t("exitFullscreen")}
              >
                <Minimize2 className="h-5 w-5" />
              </Button>
            )} */}
            <iframe
              ref={iframeRef}
              title={t("iframeTitle")}
              src={previewSrc}
              onLoad={() => setIframeLoaded(true)}
              className={
                isPreviewFullscreen
                  ? "min-h-0 w-full flex-1 border-0 bg-white"
                  : "h-full w-full border-0 bg-white"
              }
              sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
            />

            {/* Inspect-mode hint banner */}
            {inspectMode && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center p-3">
                <div className="rounded-full bg-indigo-600/95 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
                  {t("inspectHint")}
                </div>
              </div>
            )}

            {/* Selected-element edit bar */}
            {selection && (
              <div className="absolute inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 p-3 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
                <div className="mx-auto flex max-w-2xl items-center gap-2">
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                    title={t("editingElement")}
                  >
                    <MousePointerClick className="h-3 w-3" aria-hidden="true" />
                    <span className="font-mono">{`<${selection.tagName}>`}</span>
                  </span>
                  <input
                    type="text"
                    autoFocus
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitElementEdit();
                      if (e.key === "Escape") clearSelection();
                    }}
                    placeholder={t("editPlaceholder")}
                    className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500"
                  />
                  <Button
                    onClick={submitElementEdit}
                    disabled={editPrompt.trim().length < 3}
                    className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700 aria-disabled:opacity-50"
                  >
                    {t("applyEdit")}
                  </Button>
                  <IconButton
                    label={t("clearSelection")}
                    className={iconBtnClass}
                    onClick={clearSelection}
                  >
                    <X className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3">
            {status === "GENERATING" ? (
              <>
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-indigo-500 dark:border-zinc-700 dark:border-t-indigo-400" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {progressStep
                    ? tProgress.has(progressStep)
                      ? tProgress(progressStep)
                      : progressStep
                    : tProgress("generating")}
                </p>
              </>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {t("placeholder")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
