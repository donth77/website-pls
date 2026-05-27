#!/usr/bin/env node
/**
 * One-shot script: adds the BYOK + Notify + ErrorCode + Settings additions
 * to en.json. Then run `node scripts/sync-i18n-additions.mjs` to propagate
 * placeholders to the other 19 locale files.
 *
 * Idempotent on en.json (existing keys are preserved, additions merged).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const enPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "messages",
  "en.json",
);

const en = JSON.parse(readFileSync(enPath, "utf-8"));

const additions = {
  Settings: {
    notificationsHeading: "Notifications",
    notificationsDescription:
      "Get a desktop notification when your generation finishes, even when you're working in another tab.",
    byokHeading: "API key",
    byokDescription:
      "Bring your own key to skip per-account limits and pick the model. Keys are stored in this browser only — they never reach our server except as a per-request header on your own generations.",
  },
  Byok: {
    modalTitle: "API key",
    close: "Close",
    newKeyDescription:
      "Your key stays in this browser. It's sent only with your own generation requests and never stored on the server.",
    apiKeyLabel: "API key",
    apiKeyPlaceholder: "sk-ant-…",
    // {provider} interpolates with the provider's display label.
    consoleLink: "Get a key from the {provider} console",
    encryptToggle: "Encrypt with a passphrase",
    encryptHint:
      "You'll re-enter the passphrase once per session. Without one, the key is stored unencrypted in this browser.",
    passphraseLabel: "Passphrase",
    passphraseConfirmLabel: "Confirm passphrase",
    save: "Save to this browser",
    saving: "Saving…",
    cancel: "Cancel",
    passphraseShort: "Passphrase must be at least 4 characters.",
    passphraseMismatch: "Passphrases don't match.",
    saveFailed: "Failed to encrypt key.",
    invalidKey: "Invalid API key.",
    unlockDescription:
      "Your key is encrypted in this browser. Enter your passphrase to unlock it for this session.",
    unlock: "Unlock",
    unlocking: "Unlocking…",
    unlockFailed: "Unlock failed.",
    forgotPassphrase: "Forgot passphrase?",
    forgotPassphraseConfirm:
      "This deletes the encrypted key in this browser. You'll need to paste your API key again.",
    forgotPassphraseTitle: "Forget passphrase?",
    confirmRemoveTitle: "Remove API key?",
    confirmRemoveMessage:
      "Your saved key will be deleted from this browser. You can paste it again any time.",
    confirmRemoveButton: "Remove",
    // Multi-provider additions
    providerLabel: "Provider",
    unlockDescriptionWithProvider:
      "Your {provider} key is encrypted in this browser. Enter your passphrase to unlock it for this session.",
    activeStatusWithProvider: "Using your {provider} key",
    anthropicModelHint:
      "Haiku is fastest and cheapest. Opus is highest quality. Sonnet is the balanced default.",
    openaiModelHint:
      "GPT-5.5 is the latest. GPT-5.4 is the balanced default. Nano/mini variants are cheaper; GPT-4 models are still available for compatibility.",
    openrouterModelHint:
      "{count} structured-output-capable models. Switching changes which model handles your generations.",
    openrouterModelsFailed:
      "Couldn't load the OpenRouter model list. Try again in a moment.",
    loadingModels: "Loading models…",
    openrouterDefault: "Default (anthropic/claude-sonnet-4)",
    searchModels: "Search models…",
    noMatches: "No matches",
    activeStatus: "Using your Anthropic key",
    encryptedLabel: "encrypted",
    modelLabel: "Model",
    modelHint:
      "Haiku is fastest and cheapest. Opus is highest quality. Sonnet is the balanced default.",
    removeKey: "Remove key",
    confirmRemove: "Confirm remove",
    triggerActive: "Using your Anthropic key",
    triggerLocked: "Unlock your Anthropic key",
    triggerInactive: "Use your own Anthropic key",
    bannerPlatformBudgetLowHeadline:
      "Free generations are temporarily unavailable.",
    bannerPlatformBudgetLowSub:
      "Add your own Anthropic API key to keep generating — your key stays in this browser.",
    bannerPlatformBudgetLowCta: "Add your key",
    bannerUserCapHeadline: "You've used your free generations.",
    bannerUserCapSub:
      "Add your own Anthropic API key for unlimited generations — your key stays in this browser.",
    bannerUserCapCta: "Use your own key",
    bannerRateLimitHeadline: "Too many requests in the last hour.",
    bannerRateLimitSub:
      "Wait an hour, or add your own Anthropic API key to keep generating now.",
    bannerRateLimitCta: "Use your own key",
    bannerDismiss: "Dismiss",
  },
  Notify: {
    prompt: "Notify me when this is done?",
    enable: "Enable",
    enabling: "Enabling…",
    dismiss: "Dismiss",
    completedTitle: "Your site is ready",
    completedBody: "Click to view your generated page.",
    errorTitle: "Generation failed",
    errorBody: "Open the tab to see what went wrong.",
    unsupported: "Notifications aren't supported in this browser.",
    blockedHint:
      "Notifications are blocked. Enable them in your browser's site settings to use this feature.",
    settingsStatusOn: "Notifying on completion",
    settingsStatusOff: "Off",
    settingsTurnOn: "Turn on",
    settingsTurnOff: "Turn off",
  },
  ErrorCode: {
    PROMPT_BLOCKED:
      "Your prompt wasn't accepted by the safety filter. Try rephrasing it.",
    RATE_LIMIT: "Too many requests — please wait a moment and try again.",
    SCREENING_UNAVAILABLE:
      "Safety check is temporarily unavailable. Try again shortly.",
    SCREENING_CONFIG:
      "There's a server misconfiguration. Please try again later.",
    VALIDATION:
      "There was an issue with your prompt. Please check and try again.",
    TURNSTILE: "Bot verification failed. Please try again.",
    GENERATION_LIMIT: "You've used all your free generations. Sign up for more!",
    SESSION_RATE_LIMIT: "Too many sessions created. Try again later.",
    FORBIDDEN: "You don't have access to this resource.",
    GUEST_BLOCKED_AUTH_IP:
      "An account has already been used from this network. Please sign in to continue.",
    EMAIL_NOT_VERIFIED:
      "Please verify your email address before generating. Check your inbox for a verification link.",
    PLATFORM_BUDGET_LOW:
      "Free generations are temporarily unavailable. Add your own Anthropic API key to continue.",
    BYOK_INVALID: "That Anthropic API key didn't work. Check it and try again.",
    BYOK_RATE_LIMIT:
      "Your Anthropic account is out of credits or rate-limited. Check usage at console.anthropic.com.",
    BYOK_AUTH_FAILED:
      "Your Anthropic key was rejected mid-generation. It may have been revoked — paste a fresh one.",
    BYOK_BAD_REQUEST:
      "Anthropic rejected the generation request. The prompt may be too long or hit a content policy.",
    DEFAULT: "Something went wrong. Please try again.",
  },
};

function mergeDeep(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (
      typeof v === "object" &&
      v !== null &&
      !Array.isArray(v) &&
      typeof target[k] === "object" &&
      target[k] !== null
    ) {
      mergeDeep(target[k], v);
    } else {
      target[k] = v;
    }
  }
}

mergeDeep(en, additions);

// Preserve a stable ordering: top-level keys alphabetical so diffs stay tidy.
const sorted = Object.fromEntries(
  Object.keys(en)
    .sort()
    .map((k) => [k, en[k]]),
);

writeFileSync(enPath, JSON.stringify(sorted, null, 2) + "\n");
console.log("en.json updated.");
