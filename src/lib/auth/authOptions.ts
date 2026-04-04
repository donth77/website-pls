import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
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
    Google({ allowDangerousEmailAccountLinking: true }),
    GitHub({ allowDangerousEmailAccountLinking: true }),
    Credentials({
      credentials: {
        email: { type: "email" },
        password: { type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase().trim() },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            passwordHash: true,
          },
        });
        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/auth/error",
  },
  callbacks: {
    async jwt({ token, user, trigger }) {
      // Persist the user ID into the JWT on sign-in.
      if (user?.id) {
        token.sub = user.id;
      }
      // Refresh user data from DB on sign-in and session update (e.g. after
      // verification, avatar upload, or name change).
      if (token.sub && (user || trigger === "update")) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { emailVerified: true, name: true, image: true },
        });
        if (dbUser) {
          token.emailVerified = !!dbUser.emailVerified;
          token.name = dbUser.name;
          token.picture = dbUser.image;
        }
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }
      session.user.name = token.name ?? session.user.name;
      session.user.image = (token.picture as string) ?? session.user.image;
      session.user.emailVerified = !!token.emailVerified;
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
