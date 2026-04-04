import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyToken } from "@/lib/auth/tokens";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth:verify-email");

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { token } = body as { token?: string };
  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  const email = await verifyToken(token, "verify");
  if (!email) {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 400 },
    );
  }

  await prisma.user.update({
    where: { email },
    data: { emailVerified: new Date() },
  });

  log.info("Email verified", { email });

  return NextResponse.json({ ok: true });
}
