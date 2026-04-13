/**
 * Strip navigation-directive meta tags from LLM-generated HTML before it
 * becomes publicly accessible.
 *
 * Why this exists: the CSP on generated HTML blocks scripts, XHR, and inline
 * event handlers — but `<meta http-equiv="refresh" content="0;url=...">` is
 * a browser navigation directive, NOT a script, so CSP does not cover it.
 * An LLM-emitted (or prompt-injected) meta refresh would turn any published
 * site into an open phishing redirect.
 *
 * Applied at both publish and preview time: even the author shouldn't be
 * silently redirected when viewing a prompt-injected site.
 *
 * Uses a permissive regex rather than a full HTML parser because the attack
 * surface is narrow (two specific `http-equiv` values) and the regex is
 * easier to audit than pulling in a DOM library. Case-insensitive, tolerates
 * any attribute order, any quoting style, and arbitrary whitespace.
 */

// Matches <meta ... http-equiv="refresh|location" ... > in any attribute
// order. The outer `<meta\b[^>]*>` bounds us to a single tag; the inner
// lookahead finds the dangerous http-equiv value without caring where it
// sits relative to the other attributes.
const DANGEROUS_META_TAG =
  /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*["']?(?:refresh|location)["']?)[^>]*>/gi;

export function scrubRedirectMetaTags(html: string): string {
  return html.replace(DANGEROUS_META_TAG, "");
}
