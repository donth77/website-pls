"use client";

import {
  Dialog,
  DialogDescription,
  DialogDismiss,
  DialogHeading,
  useDialogStore,
} from "@ariakit/react";
import { Button } from "@ariakit/react";

export interface ConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
}

export function ConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel,
  cancelLabel,
}: ConfirmDialogProps) {
  const dialog = useDialogStore({
    open: isOpen,
    setOpen(open) {
      if (!open) onCancel();
    },
  });

  return (
    <Dialog
      store={dialog}
      role="alertdialog"
      backdrop={
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
      }
      className="fixed inset-4 z-50 m-auto h-fit w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      <DialogHeading className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {title}
      </DialogHeading>
      <DialogDescription className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {description}
      </DialogDescription>
      <div className="mt-5 flex justify-end gap-3">
        <DialogDismiss className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          {cancelLabel}
        </DialogDismiss>
        <Button
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700"
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
