import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/authOptions";
import { prisma } from "@/lib/db/prisma";
import { createToken } from "@/lib/auth/tokens";
import { sendEmail } from "@/lib/email/resend";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth:resend-verification");

/** Rate limit: one resend per 60 seconds per user (in-memory, resets on deploy). */
const lastSent = new Map<string, number>();
const RESEND_COOLDOWN_MS = 60_000;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, emailVerified: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (user.emailVerified) {
    return NextResponse.json(
      { error: "Email already verified" },
      { status: 400 },
    );
  }

  // Simple cooldown to prevent spam.
  const now = Date.now();
  const last = lastSent.get(session.user.id) ?? 0;
  if (now - last < RESEND_COOLDOWN_MS) {
    return NextResponse.json(
      { error: "Please wait before requesting another email." },
      { status: 429 },
    );
  }
  lastSent.set(session.user.id, now);

  try {
    const token = await createToken(user.email, "verify");
    const baseUrl = req.nextUrl.origin;
    const verifyUrl = `${baseUrl}/auth/verify-email?token=${token}`;
    await sendEmail({
      to: user.email,
      subject: "Verify your email — WebsitePls",
      html: `<p>Click the link below to verify your email address:</p><p><a href="${verifyUrl}">Verify email</a></p><p>This link expires in 1 hour.</p><p>If you didn't request this, you can ignore this email.</p>`,
    });
  } catch (err) {
    log.error("Failed to send verification email", {
      userId: session.user.id,
      error: String(err),
    });
    return NextResponse.json(
      { error: "Failed to send email. Please try again." },
      { status: 500 },
    );
  }

  log.info("Verification email resent", { userId: session.user.id });
  return NextResponse.json({ ok: true });
}
