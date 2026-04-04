import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/auth/resolveOwner";
import { prisma } from "@/lib/db/prisma";
import { downloadFile } from "@/lib/storage/r2";

const EXTENSIONS = ["jpg", "png", "webp", "gif"];
const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export async function GET() {
  const owner = await resolveOwner();
  if (owner.type !== "user") {
    return new NextResponse(null, { status: 401 });
  }

  // Verify user exists
  const user = await prisma.user.findUnique({
    where: { id: owner.userId },
    select: { id: true },
  });
  if (!user) {
    return new NextResponse(null, { status: 404 });
  }

  // Try each extension — we don't store the extension in the DB
  for (const ext of EXTENSIONS) {
    const key = `avatars/${owner.userId}.${ext}`;
    const data = await downloadFile(key);
    if (data) {
      return new NextResponse(new Uint8Array(data), {
        headers: {
          "Content-Type": CONTENT_TYPES[ext],
          "Cache-Control": "private, max-age=3600",
        },
      });
    }
  }

  return new NextResponse(null, { status: 404 });
}
