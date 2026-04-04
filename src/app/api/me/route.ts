import { NextRequest, NextResponse } from "next/server";
import { resolveOwner } from "@/lib/auth/resolveOwner";
import { prisma } from "@/lib/db/prisma";
import { GUEST_MAX_GENERATIONS } from "@/lib/auth/guestSession";
import { uploadFile, deleteFiles } from "@/lib/storage/r2";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:me");

const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_AVATAR_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function GET() {
  const owner = await resolveOwner();

  if (owner.type === "user") {
    if (process.env.ENABLE_MONETIZATION === "true") {
      const user = await prisma.user.findUnique({
        where: { id: owner.userId },
        select: { credits: true },
      });
      return NextResponse.json({
        type: "user",
        generationsRemaining: user?.credits ?? 0,
      });
    }
    return NextResponse.json({ type: "user" });
  }

  if (owner.type === "guest") {
    const session = await prisma.guestSession.findUnique({
      where: { id: owner.guestSessionId },
      select: { generationsUsed: true },
    });
    const used = session?.generationsUsed ?? 0;
    return NextResponse.json({
      type: "guest",
      generationsRemaining: Math.max(0, GUEST_MAX_GENERATIONS - used),
      generationsMax: GUEST_MAX_GENERATIONS,
    });
  }

  return NextResponse.json({
    type: "anonymous",
    generationsRemaining: GUEST_MAX_GENERATIONS,
    generationsMax: GUEST_MAX_GENERATIONS,
  });
}

export async function PATCH(req: NextRequest) {
  const owner = await resolveOwner();
  if (owner.type !== "user") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const name = formData.get("name");
  const avatar = formData.get("avatar");

  const data: { name?: string; image?: string } = {};

  if (typeof name === "string") {
    data.name = name.trim() || undefined;
  }

  // Handle avatar upload
  if (avatar instanceof File && avatar.size > 0) {
    if (!ALLOWED_AVATAR_TYPES.has(avatar.type)) {
      return NextResponse.json(
        { error: "Invalid image type. Use JPEG, PNG, WebP, or GIF." },
        { status: 400 },
      );
    }
    if (avatar.size > MAX_AVATAR_SIZE) {
      return NextResponse.json(
        { error: "Image must be under 2 MB." },
        { status: 400 },
      );
    }

    const ext =
      avatar.type.split("/")[1] === "jpeg" ? "jpg" : avatar.type.split("/")[1];
    const key = `avatars/${owner.userId}.${ext}`;

    // Delete any existing avatars with different extensions to prevent stale files.
    const otherKeys = ["jpg", "png", "webp", "gif"]
      .filter((e) => e !== ext)
      .map((e) => `avatars/${owner.userId}.${e}`);
    await deleteFiles(otherKeys);

    const buffer = Buffer.from(await avatar.arrayBuffer());
    await uploadFile(key, buffer, avatar.type);

    // Point to our proxy route so Next.js Image can serve it
    data.image = `/api/me/avatar?v=${Date.now()}`;

    log.info("Avatar uploaded", {
      userId: owner.userId,
      key,
      size: avatar.size,
    });
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: owner.userId },
    data,
    select: { id: true, name: true, image: true },
  });

  return NextResponse.json(user);
}
