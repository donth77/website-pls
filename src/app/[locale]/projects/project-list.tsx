"use client";

import { useRef, useState, useEffect } from "react";
import {
  Globe,
  AlertCircle,
  ArrowUpRight,
  Clock,
  Loader2,
  MoreVertical,
  ExternalLink,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Button,
  MenuProvider,
  MenuButton,
  Menu,
  MenuItem,
  Dialog,
  DialogDismiss,
  DialogHeading,
  useDialogStore,
} from "@ariakit/react";
import { useRouter } from "@/i18n/navigation";
import { SESSION_KEY, type PersistedState } from "@/hooks/use-generation";
import type { ChatMessage, GenerationStatus } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface ProjectSummary {
  id: string;
  name: string;
  prompt: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  versions: {
    id: string;
    versionNumber: number;
    promptDelta: string | null;
    commentary: string | null;
  }[];
  publishedSites: { subdomain: string | null }[];
}

function renderStatusIcon(status: string, isPublished: boolean) {
  switch (status) {
    case "READY":
      return (
        <Globe
          className={`h-4 w-4 ${isPublished ? "text-indigo-500" : "text-green-500"}`}
        />
      );
    case "GENERATING":
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    case "ERROR":
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    default:
      return <Clock className="h-4 w-4 text-zinc-400" />;
  }
}

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildSessionState(
  project: ProjectSummary,
  labels: { websiteReady: string; generationFailed: string },
): PersistedState {
  const messages: ChatMessage[] = [];
  let msgId = 0;

  for (const version of project.versions) {
    const userText =
      version.versionNumber === 1
        ? (project.prompt ?? "")
        : (version.promptDelta ?? "");

    if (userText) {
      messages.push({
        id: String(msgId++),
        role: "user",
        content: userText,
        timestamp: Date.now(),
      });
    }

    if (version !== project.versions[project.versions.length - 1]) {
      messages.push({
        id: String(msgId++),
        role: "assistant",
        content: version.commentary || labels.websiteReady,
        status: "READY",
        timestamp: Date.now(),
      });
    }
  }

  const latestVersion = project.versions[project.versions.length - 1];
  const status = project.status as GenerationStatus;

  if (status === "READY" && latestVersion) {
    messages.push({
      id: String(msgId++),
      role: "assistant",
      content: latestVersion.commentary || labels.websiteReady,
      status: "READY",
      timestamp: Date.now(),
    });
  } else if (status === "ERROR") {
    messages.push({
      id: String(msgId++),
      role: "assistant",
      content: labels.generationFailed,
      status: "ERROR",
      timestamp: Date.now(),
    });
  } else if (status === "GENERATING") {
    messages.push({
      id: String(msgId++),
      role: "assistant",
      content: "",
      status: "GENERATING",
      progressPercent: 0,
      timestamp: Date.now(),
    });
  }

  return {
    phase: "builder",
    projectId: project.id,
    projectName: project.name,
    versionId: latestVersion?.id ?? null,
    status,
    versionNumber: latestVersion?.versionNumber ?? 0,
    originalPrompt: project.prompt ?? "",
    messages,
    generationStartTime: status === "GENERATING" ? Date.now() : null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 767px)").matches
      : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

// ---------------------------------------------------------------------------
// Rename modal
// ---------------------------------------------------------------------------

function RenameDialog({
  isOpen,
  name,
  onSave,
  onCancel,
}: {
  isOpen: boolean;
  name: string;
  onSave: (newName: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Projects");
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialog = useDialogStore({
    open: isOpen,
    setOpen(open) {
      if (!open) onCancel();
    },
  });

  // Auto-select text when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [isOpen]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) onSave(trimmed);
  }

  return (
    <Dialog
      store={dialog}
      backdrop={
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
      }
      className="fixed inset-4 z-50 m-auto h-fit w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="flex items-start justify-between gap-3">
        <DialogHeading className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {t("renameTitle")}
        </DialogHeading>
        <DialogDismiss className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
          <X className="h-4 w-4" />
        </DialogDismiss>
      </div>

      <form onSubmit={handleSubmit} className="mt-4">
        <label
          htmlFor="rename-input"
          className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          {t("displayName")}
        </label>
        <input
          ref={inputRef}
          id="rename-input"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={100}
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 transition outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />

        <div className="mt-5 flex justify-end gap-3">
          <DialogDismiss className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
            {t("cancelButton")}
          </DialogDismiss>
          <Button
            type="submit"
            disabled={!value.trim() || value.trim() === name}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 aria-disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {t("save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Three-dot menu: dropdown on desktop, bottom sheet on mobile
// ---------------------------------------------------------------------------

const menuItemClass =
  "flex w-full items-center gap-3 px-4 py-3 text-left text-base text-zinc-700 transition hover:bg-zinc-50 active:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:active:bg-zinc-800";

const menuItemDestructiveClass =
  "flex w-full items-center gap-3 px-4 py-3 text-left text-base text-red-600 transition hover:bg-red-50 active:bg-red-50 dark:text-red-400 dark:hover:bg-red-950 dark:active:bg-red-950";

function ProjectCardMenu({
  project,
  onViewPublished,
  onOpenInNewTab,
  onRename,
  onDelete,
}: {
  project: ProjectSummary;
  /** Set only when the project has a published site. Uses ArrowUpRight. */
  onViewPublished: (() => void) | null;
  /** Always present. Opens the builder for this project in a new tab. */
  onOpenInNewTab: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("Projects");
  const isMobile = useIsMobile();
  const isGenerating = project.status === "GENERATING";

  const dialog = useDialogStore();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (isMobile) {
    return (
      <>
        <Button
          onClick={(e) => {
            e.stopPropagation();
            setSheetOpen(true);
          }}
          className="rounded-lg p-2 text-zinc-500 dark:text-zinc-400"
          aria-label={t("moreActions")}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
        <Dialog
          store={dialog}
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          backdrop={
            <div
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
              onClick={() => setSheetOpen(false)}
            />
          }
          className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        >
          <div className="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-600" />
          <div className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {project.name}
            </p>
          </div>
          <div className="py-1">
            {onViewPublished && (
              <button
                type="button"
                className={menuItemClass}
                onClick={() => {
                  setSheetOpen(false);
                  onViewPublished();
                }}
              >
                <ArrowUpRight className="h-4 w-4" />
                {t("viewPublishedSite")}
              </button>
            )}
            <button
              type="button"
              className={menuItemClass}
              disabled={isGenerating}
              onClick={() => {
                setSheetOpen(false);
                onOpenInNewTab();
              }}
            >
              <ExternalLink className="h-4 w-4" />
              {t("openInNewTab")}
            </button>
            <button
              type="button"
              className={menuItemClass}
              disabled={isGenerating}
              onClick={() => {
                setSheetOpen(false);
                onRename();
              }}
            >
              <Pencil className="h-4 w-4" />
              {t("rename")}
            </button>
            <button
              type="button"
              className={menuItemDestructiveClass}
              disabled={isGenerating}
              onClick={() => {
                setSheetOpen(false);
                onDelete();
              }}
            >
              <Trash2 className="h-4 w-4" />
              {t("delete")}
            </button>
          </div>
          <div className="px-4 pt-1 pb-3">
            <DialogDismiss className="w-full rounded-xl border border-zinc-200 py-2.5 text-center text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 active:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:active:bg-zinc-800">
              {t("cancelButton")}
            </DialogDismiss>
          </div>
        </Dialog>
      </>
    );
  }

  // Desktop: dropdown menu
  return (
    <MenuProvider placement="bottom-end">
      <MenuButton
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="rounded-lg p-2 text-zinc-500 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        aria-label={t("moreActions")}
      >
        <MoreVertical className="h-4 w-4" />
      </MenuButton>
      <Menu
        gutter={4}
        className="z-50 w-48 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      >
        {onViewPublished && (
          <MenuItem className={menuItemClass} onClick={onViewPublished}>
            <ArrowUpRight className="h-4 w-4" />
            {t("viewPublishedSite")}
          </MenuItem>
        )}
        <MenuItem
          className={menuItemClass}
          disabled={isGenerating}
          onClick={onOpenInNewTab}
        >
          <ExternalLink className="h-4 w-4" />
          {t("openInNewTab")}
        </MenuItem>
        <MenuItem
          className={menuItemClass}
          disabled={isGenerating}
          onClick={onRename}
        >
          <Pencil className="h-4 w-4" />
          {t("rename")}
        </MenuItem>
        <MenuItem
          className={menuItemDestructiveClass}
          disabled={isGenerating}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
          {t("delete")}
        </MenuItem>
      </Menu>
    </MenuProvider>
  );
}

// ---------------------------------------------------------------------------
// Main list
// ---------------------------------------------------------------------------

export function ProjectList({ projects }: { projects: ProjectSummary[] }) {
  const t = useTranslations("Projects");
  const tMsg = useTranslations("Message");
  const router = useRouter();
  const [localProjects, setLocalProjects] = useState(projects);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [renamingProject, setRenamingProject] = useState<ProjectSummary | null>(
    null,
  );

  function handleEdit(project: ProjectSummary) {
    const state = buildSessionState(project, {
      websiteReady: tMsg("websiteReady"),
      generationFailed: tMsg("generationFailed"),
    });
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch {
      // sessionStorage full or unavailable — navigate anyway
    }
    router.push("/");
  }

  /**
   * Open this project in the builder in a new tab. Writes the session state
   * to sessionStorage *before* calling `window.open` so the new tab inherits
   * it as part of browsing-context-group session storage duplication.
   *
   * NOTE: `noopener` is intentionally omitted — setting it places the new
   * tab in its own top-level browsing context group, which means session
   * storage is NOT copied and the builder would boot with no project loaded.
   * Same-origin, same-site, internal navigation so the lack of `noopener`
   * is a non-issue.
   */
  function handleOpenInNewTab(project: ProjectSummary) {
    const state = buildSessionState(project, {
      websiteReady: tMsg("websiteReady"),
      generationFailed: tMsg("generationFailed"),
    });
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch {
      // sessionStorage full or unavailable — open anyway; the new tab will
      // load the landing page since it has no state to hydrate from.
    }
    window.open("/", "_blank");
  }

  async function handleRenameSave(newName: string) {
    if (!renamingProject) return;

    const id = renamingProject.id;
    const oldName = renamingProject.name;
    setRenamingProject(null);

    setLocalProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name: newName } : p)),
    );
    const toastId = toast.success(t("renameSuccess"));

    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) throw new Error("Rename failed");
    } catch {
      setLocalProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name: oldName } : p)),
      );
      toast.error(t("renameError"), { id: toastId });
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTargetId) return;

    const id = deleteTargetId;
    const backup = localProjects;
    setDeleteTargetId(null);

    setLocalProjects((prev) => prev.filter((p) => p.id !== id));
    const toastId = toast.success(t("deleteSuccess"));

    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { projectId?: string };
        if (parsed.projectId === id) {
          sessionStorage.removeItem(SESSION_KEY);
        }
      }
    } catch {
      // ignore
    }

    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Delete failed");
      }
    } catch {
      setLocalProjects(backup);
      toast.error(t("deleteError"), { id: toastId });
    }
  }

  if (localProjects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-200 py-16 text-center dark:border-zinc-800">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("noProjects")}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {localProjects.map((project) => {
          const latestVersion = project.versions[project.versions.length - 1];
          const publishedSlug = project.publishedSites[0]?.subdomain ?? null;
          const isGenerating = project.status === "GENERATING";

          const onViewPublished = publishedSlug
            ? () => window.open(`/p/${publishedSlug}`, "_blank", "noopener")
            : null;

          return (
            <div
              key={project.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (!isGenerating) handleEdit(project);
              }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !isGenerating) {
                  e.preventDefault();
                  handleEdit(project);
                }
              }}
              className={`group flex items-center gap-4 rounded-xl border border-zinc-200 bg-white px-5 py-4 shadow-sm transition hover:border-zinc-300 hover:shadow-md active:border-zinc-300 active:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:active:border-zinc-700 ${
                isGenerating ? "opacity-60" : "cursor-pointer"
              }`}
            >
              <div className="flex-shrink-0">
                {renderStatusIcon(project.status, !!publishedSlug)}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {project.name}
                  </p>
                  {publishedSlug && (
                    <Button
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        window.open(
                          `/p/${publishedSlug}`,
                          "_blank",
                          "noopener",
                        );
                      }}
                      aria-label={t("viewPublishedSite")}
                      className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
                    >
                      <Globe className="h-3.5 w-3.5" />
                      {t("publishedBadge")}
                    </Button>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  v{latestVersion?.versionNumber ?? 0} &middot;{" "}
                  {formatDate(project.updatedAt)}
                </p>
              </div>

              <div
                className="flex-shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <ProjectCardMenu
                  project={project}
                  onViewPublished={onViewPublished}
                  onOpenInNewTab={() => handleOpenInNewTab(project)}
                  onRename={() => setRenamingProject(project)}
                  onDelete={() => setDeleteTargetId(project.id)}
                />
              </div>
            </div>
          );
        })}
      </div>

      <RenameDialog
        key={renamingProject?.id ?? "closed"}
        isOpen={renamingProject !== null}
        name={renamingProject?.name ?? ""}
        onSave={handleRenameSave}
        onCancel={() => setRenamingProject(null)}
      />

      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTargetId(null)}
        title={t("deleteConfirmTitle")}
        description={t("deleteConfirmDescription")}
        confirmLabel={t("deleteConfirmButton")}
        cancelLabel={t("cancelButton")}
      />
    </>
  );
}
