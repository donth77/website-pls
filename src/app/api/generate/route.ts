import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ProjectStatus } from "@/generated/prisma/enums";
import { getGenerationQueue } from "@/lib/queue/generationQueue";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const prompt = String(body?.prompt ?? "").trim();

    if (!prompt || prompt.length < 3) {
      return NextResponse.json(
        { error: "Missing or too-short `prompt`." },
        { status: 400 },
      );
    }

    // Anonymous demo: create a project without a user.
    const project = await prisma.project.create({
      data: {
        name: "Anonymous Demo",
        prompt,
        status: ProjectStatus.GENERATING,
      },
    });

    const version = await prisma.version.create({
      data: {
        projectId: project.id,
        versionNumber: 1,
      },
    });

    const queue = getGenerationQueue();
    // Use `versionId` as a deterministic jobId for de-duping in future.
    await queue.add(
      "generate-html",
      {
        projectId: project.id,
        versionId: version.id,
        userPrompt: prompt,
      },
      { jobId: version.id },
    );

    return NextResponse.json({
      projectId: project.id,
      versionId: version.id,
      status: project.status,
    });
  } catch (err) {
    console.error("POST /api/generate failed:", err);
    return NextResponse.json(
      { error: "Generation enqueue failed." },
      { status: 500 },
    );
  }
}

