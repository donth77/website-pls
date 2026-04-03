import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Match all paths except: api, preview, auth callback, _next, static files
  matcher: ["/((?!api|preview|auth|_next|_vercel|.*\\..*).*)"],
};
