"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Button } from "@ariakit/react";
import { AlertTriangle, Bell, Camera, Key, User } from "lucide-react";
import { toast } from "sonner";
import { signOut } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";
import { BackButton } from "@/components/back-button";
import { ByokProvider } from "@/lib/byok/context";
import { ByokPanel } from "@/components/byok/byok-panel";
import { NotificationSettings } from "@/components/notifications/notification-settings";
import { ConfirmModal } from "@/components/ui/confirm-modal";

export default function SettingsPage() {
  const t = useTranslations("Settings");
  const router = useRouter();
  const { data: session, status, update: updateSession } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(session?.user?.name ?? "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDeleteAccount() {
    setIsDeleting(true);
    try {
      const res = await fetch("/api/me", { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? t("deleteAccountError"));
        setIsDeleting(false);
        setDeleteOpen(false);
        return;
      }
      // Server cleared the row + cascades + R2. Now clear the local JWT
      // and land on the landing page — `redirect: false` so we control
      // navigation cleanly through next-intl's router.
      await signOut({ redirect: false });
      toast.success(t("deleteAccountSuccess"));
      // Don't reset isDeleting here — we want the modal's spinner to keep
      // showing right through the navigation so the user doesn't see a
      // blink-of-clickable-button before the page swap.
      setDeleteOpen(false);
      router.replace("/");
    } catch {
      toast.error(t("deleteAccountError"));
      setIsDeleting(false);
      setDeleteOpen(false);
    }
  }

  // Initial session fetch only: `update()` also sets status to "loading" while
  // refetching; session still holds the previous value, so don’t unmount the page.
  if (status === "loading" && !session) {
    return null;
  }

  // Redirect via effect so router.push isn't called during the SSR
  // pre-render pass (next-intl's router touches `location`, which throws
  // server-side when called from a render body).
  if (status === "unauthenticated" || !session) {
    return <RedirectToLogin />;
  }

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarPreview((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setAvatarFile(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);

    const formData = new FormData();
    formData.set("name", name);
    if (avatarFile) {
      formData.set("avatar", avatarFile);
    }

    const res = await fetch("/api/me", {
      method: "PATCH",
      body: formData,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? t("errorGeneric"));
      setIsSaving(false);
      return;
    }

    const updated = (await res.json()) as { image?: string | null };

    // Keep the blob visible until the saved avatar URL has loaded so the
    // circle doesn’t sit empty while /api/me/avatar hits R2.
    if (avatarFile && updated.image?.startsWith("/")) {
      const abs = new URL(updated.image, window.location.origin).href;
      try {
        await new Promise<void>((resolve, reject) => {
          const img = new window.Image();
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("preload"));
          img.src = abs;
        });
      } catch {
        /* session URL is still valid; continue without blocking */
      }
    }

    await updateSession({});

    setAvatarFile(null);
    setAvatarPreview((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return null;
    });
    toast.success(t("saved"));
    setIsSaving(false);
  }

  const displayImage = avatarPreview ?? session.user?.image;
  /** Local API or object-URL avatars: use <img> (next/image is flaky for /api/* + query and for blob:). */
  const useNativeAvatarImg =
    !!displayImage &&
    (displayImage.startsWith("blob:") || displayImage.startsWith("/"));

  return (
    <div className="flex min-h-dvh justify-center bg-white px-6 py-16 dark:bg-zinc-950">
      <div className="w-full max-w-md">
        <BackButton />

        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t("heading")}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {t("description")}
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          {/* Avatar */}
          <div>
            <label className="mb-3 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("avatarLabel")}
            </label>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-zinc-300 transition hover:border-zinc-400 dark:border-zinc-600 dark:hover:border-zinc-500"
              >
                {displayImage ? (
                  useNativeAvatarImg ? (
                    // eslint-disable-next-line @next/next/no-img-element -- blob: and /api/me/avatar are not reliably supported by next/image
                    <img
                      src={displayImage}
                      alt=""
                      width={64}
                      height={64}
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Image
                      src={displayImage}
                      alt=""
                      width={64}
                      height={64}
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                      unoptimized
                    />
                  )
                ) : (
                  <User className="h-6 w-6 text-zinc-400 dark:text-zinc-500" />
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                  <Camera className="h-5 w-5 text-white" />
                </div>
              </button>
              <div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-sm font-medium text-zinc-700 hover:underline dark:text-zinc-300"
                >
                  {t("changeAvatar")}
                </button>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t("avatarHint")}
                </p>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleAvatarChange}
              className="hidden"
            />
          </div>

          {/* Name */}
          <div>
            <label
              htmlFor="name"
              className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              {t("nameLabel")}
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-500"
            />
          </div>

          {/* Email (read-only) */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("emailLabel")}
            </label>
            <p className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              {session.user?.email}
            </p>
          </div>

          <Button
            type="submit"
            disabled={isSaving}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 aria-disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {isSaving ? t("saving") : t("save")}
          </Button>
        </form>

        {/* BYOK — same vault as the in-app key icon; localStorage is the
            source of truth so saves here are visible to the chat sidebar
            on its next mount. Wrapped in its own provider since the
            settings page doesn't mount GeneratorApp's. */}
        <section className="mt-12 border-t border-zinc-200 pt-8 dark:border-zinc-800">
          <div className="mb-4 flex items-center gap-2">
            <Key className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {t("byokHeading")}
            </h2>
          </div>
          <p className="mb-5 text-xs text-zinc-500 dark:text-zinc-400">
            {t("byokDescription")}
          </p>
          <ByokProvider>
            <ByokPanel />
          </ByokProvider>
        </section>

        {/* Desktop notifications — opt in here or via the 30s in-app prompt.
            Same localStorage preference as use-generation, so toggling here
            takes effect on the next generator visit. */}
        <section className="mt-12 border-t border-zinc-200 pt-8 dark:border-zinc-800">
          <div className="mb-4 flex items-center gap-2">
            <Bell className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {t("notificationsHeading")}
            </h2>
          </div>
          <p className="mb-5 text-xs text-zinc-500 dark:text-zinc-400">
            {t("notificationsDescription")}
          </p>
          <NotificationSettings />
        </section>

        {/* Danger zone — destructive actions live here so they're visually
            separated and unambiguous. The red border + AlertTriangle icon
            reinforce that this isn't an everyday setting. */}
        <section className="mt-12 rounded-xl border border-red-200 bg-red-50/40 p-5 dark:border-red-900/40 dark:bg-red-950/20">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
            <h2 className="text-base font-semibold text-red-900 dark:text-red-200">
              {t("deleteAccountHeading")}
            </h2>
          </div>
          <p className="mb-4 text-xs text-red-800/80 dark:text-red-300/80">
            {t("deleteAccountDescription")}
          </p>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            disabled={isDeleting}
            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900/60 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            {t("deleteAccountButton")}
          </button>
        </section>

        <ConfirmModal
          isOpen={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          onConfirm={handleDeleteAccount}
          title={t("deleteAccountConfirmTitle")}
          message={t("deleteAccountConfirmMessage")}
          confirmLabel={t("deleteAccountConfirmButton")}
          cancelLabel={t("cancel")}
          isConfirming={isDeleting}
        />
      </div>
    </div>
  );
}

/** Effect-based redirect so router.push runs after mount, not during the
 *  SSR pre-render pass. next-intl's router internally touches `location`,
 *  which throws server-side. */
function RedirectToLogin() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login");
  }, [router]);
  return null;
}
