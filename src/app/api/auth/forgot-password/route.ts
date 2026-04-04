import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createToken } from "@/lib/auth/tokens";
import { sendEmail } from "@/lib/email/resend";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth:forgot-password");

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

  const { email } = body as { email?: string };
  const normalizedEmail = email?.toLowerCase().trim();
  if (!normalizedEmail) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  // Always return success to prevent email enumeration
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, passwordHash: true },
  });

  // Only send reset email if user exists AND has a password (not OAuth-only)
  if (user?.passwordHash) {
    try {
      const token = await createToken(normalizedEmail, "reset");
      const baseUrl = req.nextUrl.origin;
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;
      await sendEmail({
        to: normalizedEmail,
        subject: "Reset your password — WebsitePls",
        html: `<p>You requested a password reset for your WebsitePls account.</p><p>Click the link below to set a new password:</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in 1 hour.</p><p>If you didn't request this, you can ignore this email.</p>`,
      });
    } catch (err) {
      log.warn("Failed to send password reset email", {
        email: normalizedEmail,
        error: String(err),
      });
    }
  }

  // Always return success — don't reveal whether the account exists
  return NextResponse.json({ ok: true });
}
