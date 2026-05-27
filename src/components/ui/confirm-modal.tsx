"use client";

import { X } from "lucide-react";
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
}: ConfirmModalProps) {
  const dialog = useDialogStore({
    open: isOpen,
    setOpen(open) {
      if (!open) onClose();
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
        <DialogDismiss className="rounded-xl px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">
          {cancelLabel}
        </DialogDismiss>
        <Button
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={confirmClass}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
