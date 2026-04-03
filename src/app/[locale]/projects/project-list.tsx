"use client";

import { Globe, AlertCircle, Clock, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

interface ProjectSummary {
  id: string;
  name: string;
  prompt: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  versions: { id: string; versionNumber: number }[];
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  READY: <Globe className="h-4 w-4 text-green-500" />,
  GENERATING: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
  ERROR: <AlertCircle className="h-4 w-4 text-red-500" />,
  DRAFT: <Clock className="h-4 w-4 text-zinc-400" />,
};

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ProjectList({ projects }: { projects: ProjectSummary[] }) {
  const t = useTranslations("Projects");

  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-200 py-16 text-center dark:border-zinc-800">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("noProjects")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {projects.map((project) => {
        const latestVersion = project.versions[0];
        const previewUrl = latestVersion
          ? `/preview/${latestVersion.id}`
          : null;

        return (
          <div
            key={project.id}
            className="group flex items-center gap-4 rounded-xl border border-zinc-200 bg-white px-5 py-4 shadow-sm transition hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
          >
            <div className="flex-shrink-0">
              {STATUS_ICON[project.status] ?? STATUS_ICON.DRAFT}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {project.prompt
                  ? project.prompt.length > 80
                    ? project.prompt.slice(0, 80) + "\u2026"
                    : project.prompt
                  : project.name}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                v{latestVersion?.versionNumber ?? 0} &middot;{" "}
                {formatDate(project.updatedAt)}
              </p>
            </div>

            {previewUrl && project.status === "READY" && (
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t("preview")}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
