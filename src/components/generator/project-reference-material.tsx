"use client";

import { useRef, useState } from "react";
import { Button } from "@ariakit/react";
import { FileText, Paperclip, X, AlertCircle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

export interface ReferenceDocumentInfo {
  id: string;
  fileName: string;
  fileSize: number;
  status: "pending" | "ready" | "failed" | string;
}

export interface ProjectReferenceMaterialProps {
  /** Is the caller authenticated? Guests see a disabled state with a copy prompt to sign in. */
  isAuthenticated: boolean;
  /** The active server-side reference document for this project, if any. */
  referenceDocument: ReferenceDocumentInfo | null;
  /** File staged in memory for the next POST /api/generate, if any. */
  pendingFile: File | null;
  /** Is the project currently generating? (disables remove to avoid racing the worker) */
  isGenerating: boolean;
  /** Called when the user picks a file from the picker. Called with null if validation failed. */
  onFileSelected: (file: File | null) => void;
  /** Called when the user clicks the clear button on a pending file. */
  onClearPending: () => void;
  /** Called when the user clicks remove on an attached document. Must return a promise. */
  onRemove: () => Promise<void>;
  /** Render variant — inline card for landing, compact chip for the builder chat input. */
  variant?: "inline" | "chip";
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPT_ATTR = ".pdf,.txt,.md,application/pdf,text/plain,text/markdown";
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
]);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isSupportedType(file: File): boolean {
  if (SUPPORTED_MIME_TYPES.has(file.type)) return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".pdf") || name.endsWith(".txt") || name.endsWith(".md");
}

/**
 * Reference material control shared between the landing view (inline card
 * below the textarea) and the builder view (compact chip above the chat input).
 *
 * Four states:
 *   - guest-disabled: caller is not signed in → inert control with "Sign in
 *     to attach reference material" copy. File input is not mounted.
 *   - empty: authenticated user, no file → file picker affordance
 *   - pending: authenticated user, file staged in memory but not yet uploaded
 *     (uploaded when the user clicks Generate → POST /api/generate multipart)
 *   - attached: a ready ReferenceDocument exists on the server
 *
 * Client-side validation matches the server-side enforcement in
 * src/lib/rag/extract.ts (10 MB cap, PDF/TXT/MD). Server still validates.
 */
export function ProjectReferenceMaterial({
  isAuthenticated,
  referenceDocument,
  pendingFile,
  isGenerating,
  onFileSelected,
  onClearPending,
  onRemove,
  variant = "inline",
}: ProjectReferenceMaterialProps) {
  const t = useTranslations("ReferenceMaterial");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  function handlePickClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    // Reset the input so picking the same file again re-fires change.
    e.target.value = "";
    if (!file) return;

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setValidationError(t("errorTooLarge"));
      onFileSelected(null);
      return;
    }
    if (!isSupportedType(file)) {
      setValidationError(t("errorWrongType"));
      onFileSelected(null);
      return;
    }
    setValidationError(null);
    onFileSelected(file);
  }

  async function handleRemoveClick() {
    try {
      await onRemove();
    } catch {
      /* parent surfaces errors via toast / inline message */
    }
  }

  const containerClass =
    variant === "chip"
      ? "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
      : "rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900/50";

  // ── Guest-disabled state ────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div
        className={`${containerClass} opacity-60`}
        role="group"
        aria-labelledby="reference-material-label"
      >
        <div className="flex items-center gap-2">
          <Paperclip
            className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500"
            aria-hidden="true"
          />
          <div className="flex min-w-0 flex-col">
            <span
              id="reference-material-label"
              className="truncate font-medium text-zinc-600 dark:text-zinc-300"
            >
              {t("label")}
            </span>
            <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {t("guestDisabled")}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ── Attached state ──────────────────────────────────────────────────
  if (referenceDocument && !pendingFile) {
    const badge =
      referenceDocument.status === "ready"
        ? {
            label: t("statusReady"),
            icon: null,
            color: "text-emerald-600 dark:text-emerald-400",
          }
        : referenceDocument.status === "failed"
          ? {
              label: t("statusFailed"),
              icon: <AlertCircle className="h-3 w-3" aria-hidden="true" />,
              color: "text-red-600 dark:text-red-400",
            }
          : {
              label: t("statusPending"),
              icon: (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ),
              color: "text-zinc-500 dark:text-zinc-400",
            };

    return (
      <div
        className={containerClass}
        role="group"
        aria-labelledby="reference-material-label"
      >
        <div className="flex items-center gap-2">
          <FileText
            className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400"
            aria-hidden="true"
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              id="reference-material-label"
              className="truncate font-medium text-zinc-700 dark:text-zinc-200"
              title={referenceDocument.fileName}
            >
              {referenceDocument.fileName}
            </span>
            <span className={`flex items-center gap-1 text-xs ${badge.color}`}>
              {badge.icon}
              {badge.label}
              <span className="text-zinc-400 dark:text-zinc-500">·</span>
              <span className="text-zinc-500 dark:text-zinc-400">
                {formatSize(referenceDocument.fileSize)}
              </span>
            </span>
          </div>
          <Button
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            onClick={handleRemoveClick}
            disabled={isGenerating}
            aria-label={t("remove")}
            title={
              isGenerating ? t("removeDisabledWhileGenerating") : t("remove")
            }
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  // ── Pending state ───────────────────────────────────────────────────
  if (pendingFile) {
    return (
      <div
        className={containerClass}
        role="group"
        aria-labelledby="reference-material-label"
      >
        <div className="flex items-center gap-2">
          <FileText
            className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400"
            aria-hidden="true"
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              id="reference-material-label"
              className="truncate font-medium text-zinc-700 dark:text-zinc-200"
              title={pendingFile.name}
            >
              {pendingFile.name}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("pendingHint", { size: formatSize(pendingFile.size) })}
            </span>
          </div>
          <Button
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            onClick={onClearPending}
            aria-label={t("clearPending")}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────
  return (
    <div
      className={containerClass}
      role="group"
      aria-labelledby="reference-material-label"
    >
      <Button
        className="flex w-full items-center gap-2 text-left text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50"
        onClick={handlePickClick}
      >
        <Paperclip className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span
          id="reference-material-label"
          className="flex-1 truncate font-medium"
        >
          {t("emptyCta")}
        </span>
        <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
          {t("emptyHint")}
        </span>
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="hidden"
        onChange={handleFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />
      {validationError && (
        <p
          className="mt-2 flex items-center gap-1 text-xs text-red-600 dark:text-red-400"
          role="alert"
        >
          <AlertCircle className="h-3 w-3" aria-hidden="true" />
          {validationError}
        </p>
      )}
    </div>
  );
}
