import {
  Download,
  ExternalLink,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import type { GenerationStatus } from "@/lib/types";

export interface PreviewPanelProps {
  status: GenerationStatus;
  versionId: string | null;
  secretToken: string | null;
  isPreviewFullscreen: boolean;
  previewWrapRef: React.RefObject<HTMLDivElement | null>;
  onToggleFullscreen: () => void;
  onOpenNewTab: () => void;
  onDownload: () => void;
  progressStep?: string;
  onToggleSidebar: () => void;
  isSidebarCollapsed: boolean;
}

export function PreviewPanel({
  status,
  versionId,
  secretToken,
  isPreviewFullscreen,
  previewWrapRef,
  onToggleFullscreen,
  onOpenNewTab,
  onDownload,
  progressStep,
  onToggleSidebar,
  isSidebarCollapsed,
}: PreviewPanelProps) {
  const previewSrc = versionId
    ? `/preview/${versionId}${secretToken ? `?token=${secretToken}` : ""}`
    : null;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2">
          <button
            type="button"
            title={isSidebarCollapsed ? "Show chat" : "Hide chat"}
            aria-label={isSidebarCollapsed ? "Show chat" : "Hide chat"}
            className="hidden rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 md:flex dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            onClick={onToggleSidebar}
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Preview
          </span>
        </div>
        {status === "READY" && versionId && (
          <div className="flex gap-1">
            <button
              type="button"
              title={isPreviewFullscreen ? "Exit full screen" : "Full screen"}
              aria-label={
                isPreviewFullscreen ? "Exit full screen" : "Full screen"
              }
              className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              onClick={onToggleFullscreen}
            >
              {isPreviewFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              title="Open in new tab"
              aria-label="Open in new tab"
              className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              onClick={onOpenNewTab}
            >
              <ExternalLink className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Download HTML"
              aria-label="Download HTML"
              className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              onClick={onDownload}
            >
              <Download className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Preview content */}
      <div className="min-h-0 flex-1">
        {status === "READY" && previewSrc ? (
          <div
            ref={previewWrapRef}
            className={
              isPreviewFullscreen
                ? "flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-white [:fullscreen]:min-h-dvh [:fullscreen]:w-dvw"
                : "h-full w-full"
            }
          >
            <iframe
              title="Generated site preview"
              src={previewSrc}
              className={
                isPreviewFullscreen
                  ? "min-h-0 w-full flex-1 border-0 bg-white"
                  : "h-full w-full border-0 bg-white"
              }
              sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
            />
          </div>
        ) : (
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-3"
            role="status"
            aria-live="polite"
          >
            {status === "GENERATING" ? (
              <>
                <div
                  className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-indigo-500 dark:border-zinc-700 dark:border-t-indigo-400"
                  aria-hidden="true"
                />
                <p className="text-sm text-zinc-400 dark:text-zinc-500">
                  {progressStep ?? "Generating your website\u2026"}
                </p>
              </>
            ) : (
              <p className="text-sm text-zinc-400">
                Your preview will appear here
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
