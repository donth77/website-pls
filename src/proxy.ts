import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

export const proxy = intlMiddleware;

export const config = {
  // Match all paths except: api, preview, _next, static files
  matcher: ["/((?!api|preview|_next|_vercel|.*\\..*).*)"],
};
