import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { auth } from "@/lib/auth/authOptions";
import { prisma } from "@/lib/db/prisma";
import { ProjectList } from "./project-list";
import { NewProjectLink } from "./new-project-link";

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/projects");
  }

  const t = await getTranslations("Projects");

  const projects = await prisma.project.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      prompt: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      versions: {
        orderBy: { versionNumber: "asc" },
        select: { id: true, versionNumber: true, promptDelta: true },
      },
    },
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-500 transition hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("backToHome")}
      </Link>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t("heading")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {t("projectCount", { count: projects.length })}
          </p>
        </div>
        <NewProjectLink label={t("newProject")} />
      </div>

      <ProjectList projects={projects} />
    </div>
  );
}
