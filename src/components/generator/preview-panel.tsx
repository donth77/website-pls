import { useState } from "react";
import {
  Download,
  ExternalLink,
  Maximize2,
  Minimize2,
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
        render={<Button onClick={onClick} className={className} />}
      >
        {children}
      </TooltipAnchor>
      <Tooltip type="label" className={tooltipClass}>
        {label}
      </Tooltip>
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
}: PreviewPanelProps) {
  const t = useTranslations("Preview");
  const tProgress = useTranslations("Progress");
  const previewSrc = versionId ? `/preview/${versionId}` : null;
  const [iframeLoaded, setIframeLoaded] = useState(false);

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
          <div className="flex gap-1">
            <IconButton
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
            </IconButton>
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
            {isPreviewFullscreen && (
              <Button
                onClick={onToggleFullscreen}
                className="absolute top-3 right-3 z-20 rounded-lg bg-black/60 p-2 text-white backdrop-blur-sm transition hover:bg-black/80"
                aria-label={t("exitFullscreen")}
              >
                <Minimize2 className="h-5 w-5" />
              </Button>
            )}
            <iframe
              title="Generated site preview"
              src={previewSrc}
              onLoad={() => setIframeLoaded(true)}
              className={
                isPreviewFullscreen
                  ? "min-h-0 w-full flex-1 border-0 bg-white"
                  : "h-full w-full border-0 bg-white"
              }
              sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
            />
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
