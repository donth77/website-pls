"use client";

import { Key, X } from "lucide-react";
import {
  Dialog,
  DialogDismiss,
  DialogHeading,
  useDialogStore,
} from "@ariakit/react";
import { useByok } from "@/lib/byok/context";
import { ByokPanel } from "./byok-panel";

/**
 * In-app modal wrapper around <ByokPanel>. Use this for the chat-sidebar
 * trigger; for the settings page, render <ByokPanel> directly without
 * a Dialog around it.
 */
export function ByokModal() {
  const { isModalOpen, closeModal } = useByok();

  const dialog = useDialogStore({
    open: isModalOpen,
    setOpen(open) {
      if (!open) closeModal();
    },
  });

  return (
    <Dialog
      store={dialog}
      backdrop={
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
      }
      className="fixed inset-4 z-50 m-auto h-fit w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
          <DialogHeading className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Anthropic API key
          </DialogHeading>
        </div>
        <DialogDismiss
          className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </DialogDismiss>
      </div>

      <ByokPanel onAfterMutation={closeModal} onCancel={closeModal} />
    </Dialog>
  );
}
