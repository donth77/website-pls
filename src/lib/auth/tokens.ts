import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";

const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

/**
 * Create a verification token for email verification or password reset.
 * Uses the existing VerificationToken model with a prefixed identifier
 * to distinguish token types.
 */
export async function createToken(
  email: string,
  type: "verify" | "reset",
): Promise<string> {
  const identifier = `${type}:${email.toLowerCase().trim()}`;
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + TOKEN_EXPIRY_MS);

  // Delete any existing tokens for this identifier (one active token at a time)
  await prisma.verificationToken.deleteMany({ where: { identifier } });

  await prisma.verificationToken.create({
    data: { identifier, token, expires },
  });

  return token;
}

/**
 * Verify and consume a token. Returns the email if valid, null otherwise.
 * The token is deleted after successful verification (single-use).
 */
export async function verifyToken(
  token: string,
  type: "verify" | "reset",
): Promise<string | null> {
  // Find a matching token that hasn't expired
  const record = await prisma.verificationToken.findFirst({
    where: {
      token,
      identifier: { startsWith: `${type}:` },
      expires: { gt: new Date() },
    },
  });

  if (!record) return null;

  // Consume the token (single-use)
  await prisma.verificationToken.delete({
    where: {
      identifier_token: {
        identifier: record.identifier,
        token: record.token,
      },
    },
  });

  // Extract email from "type:email" identifier
  return record.identifier.slice(type.length + 1);
}
