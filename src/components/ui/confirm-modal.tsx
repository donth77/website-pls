"use client";

import { Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogDismiss,
  DialogHeading,
  useDialogStore,
  Button,
} from "@ariakit/react";

export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Visual emphasis for the confirm button. Defaults to "danger" (red). */
  variant?: "danger" | "primary";
  /** When true: disable buttons, show spinner on confirm, suppress auto-close.
   *  Parent owns the close timing so the modal stays mounted during async work. */
  isConfirming?: boolean;
}

/**
 * Generic Ariakit-based confirm dialog. Replaces native `window.confirm()`
 * for destructive actions so the experience is consistent across locales
 * and the OS/browser-specific dialog chrome doesn't show through.
 */
export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = "danger",
  isConfirming,
}: ConfirmModalProps) {
  // When the parent passes `isConfirming` at all (even as false), it's
  // signaling that it owns the async close timing — we never auto-close.
  // This avoids a stale-closure bug where the onClick handler reads
  // isConfirming === false (still!) right after onConfirm() queues a
  // setState to true and incorrectly closes the modal.
  const parentManagesClose = isConfirming !== undefined;
  const busy = isConfirming === true;
  const dialog = useDialogStore({
    open: isOpen,
    setOpen(open) {
      // Ignore close attempts (Esc, backdrop click, X) while a confirm
      // action is in flight — the parent closes it explicitly when the
      // work resolves so the modal can't disappear mid-request.
      if (!open && !busy) onClose();
    },
  });

  const confirmClass =
    variant === "danger"
      ? "rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
      : "rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200";

  return (
    <Dialog
      store={dialog}
      backdrop={
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" />
      }
      className="fixed inset-4 z-[60] m-auto h-fit w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="flex items-start justify-between gap-3">
        <DialogHeading className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {title}
        </DialogHeading>
        <DialogDismiss
          className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          aria-label={cancelLabel}
        >
          <X className="h-4 w-4" />
        </DialogDismiss>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {message}
      </p>

      <div className="mt-5 flex justify-end gap-2">
        <DialogDismiss
          disabled={busy}
          className="rounded-xl px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 aria-disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          {cancelLabel}
        </DialogDismiss>
        <Button
          onClick={() => {
            onConfirm();
            // Auto-close only for synchronous-confirm callers (BYOK
            // remove-key, etc). Async callers signal "I'll close it
            // myself" by passing isConfirming as a prop.
            if (!parentManagesClose) onClose();
          }}
          disabled={busy}
          className={`inline-flex items-center gap-2 ${confirmClass} aria-disabled:opacity-60`}
        >
          {busy && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          )}
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
