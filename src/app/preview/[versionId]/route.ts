import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getGeneratedBucket, getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ versionId: string }> },
) {
  const { versionId } = await context.params;

  const version = await prisma.version.findUnique({
    where: { id: versionId },
    select: { id: true, storageKey: true },
  });

  if (!version?.storageKey) {
    return NextResponse.json({ error: "Preview not ready." }, { status: 404 });
  }

  const supabase = getSupabaseAdmin();
  const bucket = getGeneratedBucket();

  const { data, error } = await supabase.storage
    .from(bucket)
    .download(version.storageKey);

  if (error || !data) {
    return NextResponse.json(
      { error: "Could not download preview HTML." },
      { status: 404 },
    );
  }

  const bytes = Buffer.from(await data.arrayBuffer());
  const html = bytes.toString("utf-8");

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // Helps third-party image CDNs (e.g. Wikimedia) receive a normal Referer from subresources.
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}

