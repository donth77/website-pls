#!/usr/bin/env node
/**
 * Merges new i18n keys from en.json into every other locale file.
 *
 * - New top-level namespaces: copied verbatim from en.json (English values
 *   become placeholders for human translation later).
 * - Existing namespaces with new keys: only the new keys are added, again
 *   with the English value as a placeholder.
 * - Existing keys are left untouched — won't clobber any human translation
 *   that's already been done.
 *
 * Run after adding new strings to en.json:
 *   node scripts/sync-i18n-additions.mjs
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MESSAGES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "messages",
);

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

/** Recursively fill missing keys in `target` with values from `source`. */
function fillMissing(source, target) {
  let added = 0;
  for (const [key, srcVal] of Object.entries(source)) {
    if (!(key in target)) {
      target[key] = srcVal;
      added += countLeaves(srcVal);
      continue;
    }
    if (
      typeof srcVal === "object" &&
      srcVal !== null &&
      !Array.isArray(srcVal) &&
      typeof target[key] === "object" &&
      target[key] !== null
    ) {
      added += fillMissing(srcVal, target[key]);
    }
  }
  return added;
}

function countLeaves(v) {
  if (typeof v !== "object" || v === null) return 1;
  let n = 0;
  for (const sub of Object.values(v)) n += countLeaves(sub);
  return n;
}

const enPath = join(MESSAGES_DIR, "en.json");
const en = loadJson(enPath);

const files = readdirSync(MESSAGES_DIR).filter(
  (f) => f.endsWith(".json") && f !== "en.json",
);

let totalAdded = 0;
for (const f of files) {
  const path = join(MESSAGES_DIR, f);
  const data = loadJson(path);
  const added = fillMissing(en, data);
  if (added > 0) {
    saveJson(path, data);
    console.log(`${f}: +${added} keys`);
    totalAdded += added;
  }
}
console.log(`\nDone. Added ${totalAdded} placeholder strings across ${files.length} locales.`);
