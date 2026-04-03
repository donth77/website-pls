import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogDismiss,
  DialogHeading,
  useDialogStore,
} from "@ariakit/react";

export interface InfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function InfoModal({ isOpen, onClose }: InfoModalProps) {
  const t = useTranslations("Info");
  const dialog = useDialogStore({
    open: isOpen,
    setOpen(open) {
      if (!open) onClose();
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
      <div className="flex items-start justify-between gap-3">
        <DialogHeading className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {t("title")}
        </DialogHeading>
        <DialogDismiss
          className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          aria-label={t("close")}
        >
          <X className="h-4 w-4" />
        </DialogDismiss>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {t("description")}
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
        <li>{t("feature1")}</li>
        <li>{t("feature2")}</li>
        <li>{t("feature3")}</li>
      </ul>
      <div className="mt-5 flex justify-end">
        <DialogDismiss className="rounded-xl bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200">
          {t("gotIt")}
        </DialogDismiss>
      </div>
    </Dialog>
  );
}
