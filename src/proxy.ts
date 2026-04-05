import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

export const proxy = intlMiddleware;

export const config = {
  // Match all paths except: api, preview, p/ (public published sites),
  // admin/ (operator-only routes), _next, static files.
  //
  // Every entry except the plain `api` uses a trailing slash because a bare
  // letter in a negative lookahead matches the single character — a bare
  // `p` would silently exclude `/projects` and `/privacy`, and a bare
  // `admin` would exclude any path that happens to start with `admin`.
  matcher: ["/((?!api|preview|p/|admin/|_next|_vercel|.*\\..*).*)"],
};
