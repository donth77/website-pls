import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { createToken } from "@/lib/auth/tokens";
import { sendEmail } from "@/lib/email/resend";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth:signup");

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

  const { email, password, name } = body as {
    email?: string;
    password?: string;
    name?: string;
  };

  // Validate email
  const normalizedEmail = email?.toLowerCase().trim();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return NextResponse.json(
      { error: "Valid email is required" },
      { status: 400 },
    );
  }

  // Validate password
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` },
      { status: 400 },
    );
  }

  // Check for existing user
  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 409 },
    );
  }

  // Hash password and create user
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      name: name?.trim() || null,
    },
    select: { id: true, email: true },
  });

  log.info("User created via email/password signup", {
    userId: user.id,
    email: user.email,
  });

  // Send verification email (non-blocking — don't fail signup if email fails)
  try {
    const token = await createToken(normalizedEmail, "verify");
    const baseUrl = req.nextUrl.origin;
    const verifyUrl = `${baseUrl}/auth/verify-email?token=${token}`;
    await sendEmail({
      to: normalizedEmail,
      subject: "Verify your email — WebsitePls",
      html: `<p>Welcome to WebsitePls!</p><p>Click the link below to verify your email address:</p><p><a href="${verifyUrl}">Verify email</a></p><p>This link expires in 1 hour.</p><p>If you didn't create this account, you can ignore this email.</p>`,
    });
  } catch (err) {
    log.warn("Failed to send verification email", {
      userId: user.id,
      error: String(err),
    });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
