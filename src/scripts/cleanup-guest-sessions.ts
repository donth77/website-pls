/**
 * Cleanup expired guest sessions and their orphaned projects + Supabase storage.
 *
 * Run as a cron job (e.g., daily):
 *   pnpm exec tsx src/scripts/cleanup-guest-sessions.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/logger";
import { cleanupExpiredGuestSessions } from "@/lib/cleanup/guestSessions";

const log = createLogger("cleanup:script");

cleanupExpiredGuestSessions()
  .then((result) => {
    log.info("Script finished", result);
  })
  .catch((err) => {
    log.error("Script failed", { error: String(err) });
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
