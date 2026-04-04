import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { verifyToken } from "@/lib/auth/tokens";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth:reset-password");

const PASSWORD_MIN_LENGTH = 8;
const BCRYPT_ROUNDS = 12;

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

  const { token, password } = body as { token?: string; password?: string };

  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` },
      { status: 400 },
    );
  }

  const email = await verifyToken(token, "reset");
  if (!email) {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { email },
    data: { passwordHash },
  });

  log.info("Password reset completed", { email });

  return NextResponse.json({ ok: true });
}
