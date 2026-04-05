"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogDescription,
  DialogDismiss,
  DialogHeading,
  useDialogStore,
  Button,
} from "@ariakit/react";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

/**
 * Browser-safe equivalent of the server's `generateSlug` — produces an
 * 8-char lowercase alphanumeric candidate. The server still validates and
 * owns uniqueness; this is purely a UX prefill so the slug field isn't blank.
 */
function generateSlugCandidate(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[bytes[i] % chars.length];
  return out;
}

/**
 * Transform a project name into a base slug: lowercase, non-alphanumeric runs
 * collapsed to single hyphens, leading/trailing hyphens trimmed. Clamped to
 * 45 chars so a `-99` suffix still fits under the server's 48-char limit.
 * Returns null if the name doesn't yield a slug that would pass the server's
 * validation (too short, empty after normalization, etc.) — caller falls
 * back to a random candidate in that case.
 */
function slugifyProjectName(name: string | null | undefined): string | null {
  if (!name) return null;
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 45)
    .replace(/-+$/, ""); // slice may have left a trailing hyphen mid-group
  return base.length >= 3 ? base : null;
}

/**
 * Compute the initial slug candidate for a first-time publish. Prefers a
 * slugified project name; falls back to a random candidate when the name
 * yields no valid slug (empty after normalization, too short, etc.).
 */
function initialSlugCandidate(projectName: string | null | undefined): string {
  return slugifyProjectName(projectName) ?? generateSlugCandidate();
}

/**
 * Client-side mirror of the server's `validateSlug` format rules (length +
 * character pattern). The server remains authoritative — this exists purely
 * so the Publish button can disable on invalid input and an inline error can
 * appear without a round-trip. Reserved-word checks are left to the server;
 * they're rare and the error surfaces naturally via the submit path.
 */
type SlugClientError = "too_short" | "too_long" | "invalid_chars";

const SLUG_PATTERN_CLIENT = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;

function validateSlugClient(slug: string): {
  ok: boolean;
  error: SlugClientError | null;
} {
  // Empty is "not valid yet" but not an error worth showing — the user is
  // mid-edit. The Publish button stays disabled via `ok: false`.
  if (slug.length === 0) return { ok: false, error: null };
  if (slug.length < 3) return { ok: false, error: "too_short" };
  if (slug.length > 48) return { ok: false, error: "too_long" };
  if (!SLUG_PATTERN_CLIENT.test(slug))
    return { ok: false, error: "invalid_chars" };
  return { ok: true, error: null };
}

export interface PublishedState {
  slug: string;
  publishedUrl: string;
  publishedVersionNumber: number;
}

export interface PublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  /** Project name — used to seed the slug input on first-time publish. */
  projectName: string | null;
  currentVersionNumber: number | null;
  /** Existing publish info if the project is already published. */
  published: PublishedState | null;
  /** Called after a successful publish/republish with the new state. */
  onPublished: (state: PublishedState) => void;
  /** Called after a successful unpublish. */
  onUnpublished: () => void;
}

/**
 * Publish / update / unpublish dialog.
 *
 * First-time publish shows a slug input. Re-publish shows the existing URL
 * with copy/unpublish actions. The slug input is hidden on re-publish because
 * rename is not in scope for MVP — slugs are immutable until unpublish.
 */
export function PublishModal({
  isOpen,
  onClose,
  projectId,
  projectName,
  currentVersionNumber,
  published,
  onPublished,
  onUnpublished,
}: PublishModalProps) {
  const t = useTranslations("Publish");

  const dialog = useDialogStore({
    open: isOpen,
    setOpen(open) {
      if (!open) onClose();
    },
  });

  const [slugInput, setSlugInput] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [isUnpublishing, setIsUnpublishing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Tracks whether the current slugInput is an untouched auto-generated
  // candidate or was typed by the user. Drives collision handling: an
  // untouched prefill that collides is retried transparently with a
  // suffixed variant; a user-chosen slug surfaces the "URL taken" error
  // so they can pick another.
  const [slugIsPrefill, setSlugIsPrefill] = useState(false);
  // Base slug (without any collision suffix) used to build retry variants
  // like `my-site-2`, `my-site-3`. Captured on prefill so retries always
  // append to the original, never to a previous retry's output.
  const baseSlugRef = useRef<string>("");

  // Hold the latest `published` + `projectName` in refs so the reset effect
  // below can read them without declaring them as dependencies. The effect
  // should only fire on the `isOpen` transition — depending on `published`
  // directly would re-run every time the parent hands us a new object
  // reference (e.g. after a successful publish), stomping on state we just
  // set in handlePublish.
  const publishedRef = useRef(published);
  publishedRef.current = published;
  const projectNameRef = useRef(projectName);
  projectNameRef.current = projectName;

  // Reset transient state whenever the modal opens. Prefill the slug input
  // with a slugified project name (falling back to a random candidate if the
  // name yields nothing valid) so the field isn't blank on first open — the
  // user can accept it or edit it.
  useEffect(() => {
    if (isOpen) {
      const p = publishedRef.current;
      const seed = p ? "" : initialSlugCandidate(projectNameRef.current);
      setSlugInput(seed);
      setSlugIsPrefill(!p);
      baseSlugRef.current = seed;
      setFormError(null);
      setIsPublishing(false);
      setIsUnpublishing(false);
    }
  }, [isOpen]);

  async function handlePublish() {
    setFormError(null);
    setIsPublishing(true);
    try {
      // Up to 5 attempts so an untouched prefilled slug that collides with
      // an existing row can be retried transparently with a suffixed variant
      // (`my-site` → `my-site-2` → `my-site-3` …). User-edited slugs never
      // retry — the collision error is surfaced immediately so they can pick
      // another. If the base slug itself came from a random fallback (empty
      // project name), the suffixing still works and produces `ab12cd34-2`.
      let slugToSubmit = slugInput.trim().toLowerCase();
      const allowRetry = slugIsPrefill;
      const MAX_ATTEMPTS = allowRetry ? 5 : 1;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const body: Record<string, string> = { projectId };
        // Only send a slug on first publish — re-publish ignores it server-side,
        // but omitting keeps the wire clean.
        if (!published && slugToSubmit) {
          body.slug = slugToSubmit;
        }

        const res = await fetch("/api/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            publishedUrl: string;
            slug: string;
            versionNumber: number;
          };

          onPublished({
            publishedUrl: data.publishedUrl,
            slug: data.slug,
            publishedVersionNumber: data.versionNumber,
          });
          toast.success(published ? t("updated") : t("published"));
          // Intentionally do NOT close the modal here. The parent state updates
          // the `published` prop, so the modal re-renders with the URL, copy,
          // open-in-new-tab, and unpublish controls visible. Closing would hide
          // the thing the user just created — they'd have to guess that the
          // toolbar "Published" button reopens the manage view.
          return;
        }

        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;

        // On 409 with an untouched prefill, append a numeric suffix to the
        // base slug and retry silently. Any other failure (or retries
        // exhausted) surfaces the error. The base is captured on open so
        // each retry appends to the original, not to a previous retry:
        // `my-site` → `my-site-2` → `my-site-3`, never `my-site-2-3`.
        const canRetry =
          allowRetry && res.status === 409 && attempt < MAX_ATTEMPTS - 1;
        if (canRetry) {
          slugToSubmit = `${baseSlugRef.current}-${attempt + 2}`;
          setSlugInput(slugToSubmit);
          continue;
        }

        // Localize the collision message — the raw server error is English
        // only, but the user's locale may not be. Fall back to the server
        // string for any other 4xx/5xx (rate limit, auth, reserved, etc.).
        if (res.status === 409) {
          setFormError(t("slugTaken"));
        } else {
          setFormError(data?.error ?? t("publishFailed"));
        }
        return;
      }
    } catch {
      setFormError(t("publishFailed"));
    } finally {
      setIsPublishing(false);
    }
  }

  async function handleUnpublish() {
    setFormError(null);
    setIsUnpublishing(true);
    try {
      const res = await fetch("/api/publish", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) {
        setFormError(t("unpublishFailed"));
        return;
      }
      onUnpublished();
      toast.success(t("unpublished"));
      onClose();
    } catch {
      setFormError(t("unpublishFailed"));
    } finally {
      setIsUnpublishing(false);
    }
  }

  async function handleCopyUrl() {
    if (!published) return;
    try {
      await navigator.clipboard.writeText(published.publishedUrl);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  const hasNewerVersion =
    published &&
    currentVersionNumber !== null &&
    currentVersionNumber > published.publishedVersionNumber;

  // Client-side slug validation for the first-time-publish input. Disables
  // the Publish button on invalid input and drives the inline error below.
  // On re-publish the input isn't rendered, so we skip validation.
  const slugValidation = published
    ? { ok: true, error: null as SlugClientError | null }
    : validateSlugClient(slugInput.trim().toLowerCase());
  const slugErrorKey: Record<SlugClientError, string> = {
    too_short: "slugTooShort",
    too_long: "slugTooLong",
    invalid_chars: "slugInvalidChars",
  };

  return (
    <Dialog
      store={dialog}
      backdrop={
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
      }
      className="fixed inset-4 z-50 m-auto h-fit w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      <DialogHeading className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {published ? t("titlePublished") : t("titlePublish")}
      </DialogHeading>
      <DialogDescription className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {published ? t("descriptionPublished") : t("descriptionPublish")}
      </DialogDescription>

      {/* First-time publish: show slug input */}
      {!published && (
        <div className="mt-5">
          <label
            htmlFor="publish-slug"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            {t("slugLabel")}
          </label>
          <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800">
            <span className="text-zinc-500 dark:text-zinc-400">/p/</span>
            <input
              id="publish-slug"
              type="text"
              value={slugInput}
              onChange={(e) => {
                // Force lowercase as the user types — slugs are lowercase
                // per the server's validation pattern, and this spares users
                // from seeing a validation error on otherwise-valid input
                // that differs only in case (e.g. "My-Site" → "my-site").
                setSlugInput(e.target.value.toLowerCase());
                setSlugIsPrefill(false);
              }}
              placeholder={t("slugPlaceholder")}
              className="flex-1 bg-transparent text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus-visible:ring-0 focus-visible:outline-none dark:text-zinc-100"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {slugValidation.error && (
            <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
              {t(slugErrorKey[slugValidation.error])}
            </p>
          )}
        </div>
      )}

      {/* Already published: show URL with copy + open actions */}
      {published && (
        <div className="mt-5 space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800">
            <code className="flex-1 truncate text-sm text-zinc-900 dark:text-zinc-100">
              {published.publishedUrl}
            </code>
            <Button
              onClick={handleCopyUrl}
              className="rounded p-1.5 text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
              aria-label={t("copyUrl")}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <a
              href={published.publishedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded p-1.5 text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
              aria-label={t("openInNewTab")}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
          {hasNewerVersion ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t("unpublishedChanges", {
                published: published.publishedVersionNumber,
                current: currentVersionNumber,
              })}
            </p>
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("currentVersion", {
                version: published.publishedVersionNumber,
              })}
            </p>
          )}
        </div>
      )}

      {formError && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">
          {formError}
        </p>
      )}

      <div className="mt-6 flex items-center justify-end gap-3">
        {published && (
          <Button
            onClick={handleUnpublish}
            disabled={isUnpublishing || isPublishing}
            className="mr-auto rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
          >
            {isUnpublishing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              t("unpublish")
            )}
          </Button>
        )}
        <DialogDismiss className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          {t("cancel")}
        </DialogDismiss>
        <Button
          onClick={handlePublish}
          disabled={isPublishing || isUnpublishing || !slugValidation.ok}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {isPublishing && <Loader2 className="h-4 w-4 animate-spin" />}
          {published
            ? hasNewerVersion
              ? t("publishChanges")
              : t("republish")
            : t("publish")}
        </Button>
      </div>
    </Dialog>
  );
}
