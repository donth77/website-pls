import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/auth/resolveOwner";
import { prisma } from "@/lib/db/prisma";
import { GUEST_MAX_GENERATIONS } from "@/lib/auth/guestSession";

export async function GET() {
  const owner = await resolveOwner();

  if (owner.type === "user") {
    const user = await prisma.user.findUnique({
      where: { id: owner.userId },
      select: { credits: true },
    });
    return NextResponse.json({
      type: "user",
      generationsRemaining: user?.credits ?? 0,
    });
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
