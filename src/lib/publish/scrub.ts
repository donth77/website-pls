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
 * Applied at publish time only. The preview route intentionally keeps the
 * original HTML intact so the author can see exactly what the model emitted.
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
