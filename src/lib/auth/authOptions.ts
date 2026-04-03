import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { COOKIE_NAME, verifySessionId } from "./cookie";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth");

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Cast: our PrismaClient is generated to src/generated/prisma, not @prisma/client.
  // The adapter only calls methods at runtime — the type mismatch is harmless.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: PrismaAdapter(prisma as any),
  providers: [
    Google,
    GitHub,
    Resend({
      from: process.env.EMAIL_FROM ?? "noreply@websitepls.com",
    }),
  ],
  session: { strategy: "database" },
  pages: {
    signIn: "/login",
    error: "/auth/error",
    verifyRequest: "/auth/verify-request",
  },
  callbacks: {
    session({ session, user }) {
      // Expose user ID on the session so routes can use it.
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (!user.id) return;

      // Merge guest projects into the authenticated user's account.
      try {
        const jar = await cookies();
        const guestCookie = jar.get(COOKIE_NAME)?.value;
        if (!guestCookie) return;

        const guestSessionId = verifySessionId(guestCookie);
        if (!guestSessionId) return;

        const guestSession = await prisma.guestSession.findUnique({
          where: { id: guestSessionId },
          select: { id: true },
        });
        if (!guestSession) return;

        // Reassign all guest projects to the authenticated user.
        const { count } = await prisma.project.updateMany({
          where: { guestSessionId },
          data: { userId: user.id, guestSessionId: null },
        });

        // Delete the guest session row.
        await prisma.guestSession.delete({
          where: { id: guestSessionId },
        });

        // Clear the guest cookie.
        jar.delete(COOKIE_NAME);

        if (count > 0) {
          log.info("Merged guest projects into user account", {
            userId: user.id,
            guestSessionId,
            projectsMerged: count,
          });
        }
      } catch (err) {
        // Non-fatal — user can still sign in, they just lose guest projects.
        log.warn("Guest-to-user merge failed", {
          userId: user.id,
          error: String(err),
        });
      }
    },
  },
});
