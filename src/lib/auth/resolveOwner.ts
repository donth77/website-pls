import { cookies } from "next/headers";
import { auth } from "./authOptions";
import { COOKIE_NAME, verifySessionId } from "./cookie";

export type Owner =
  | { type: "guest"; guestSessionId: string }
  | { type: "user"; userId: string }
  | { type: "anonymous" };

/**
 * Resolve the caller's identity from the request cookies.
 *
 * Priority: authenticated user session → guest cookie → anonymous.
 * Routes call this directly — identity is never passed via headers.
 */
export async function resolveOwner(): Promise<Owner> {
  // Check NextAuth session first.
  try {
    const session = await auth();
    if (session?.user?.id) {
      return { type: "user", userId: session.user.id };
    }
  } catch {
    // NextAuth not configured or session check failed — fall through.
  }

  // Fall back to guest cookie.
  const jar = await cookies();
  const guestCookie = jar.get(COOKIE_NAME)?.value;
  if (guestCookie) {
    const sessionId = verifySessionId(guestCookie);
    if (sessionId) {
      return { type: "guest", guestSessionId: sessionId };
    }
  }

  return { type: "anonymous" };
}
