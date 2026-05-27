"use client";

import { Lock, Trash2, ExternalLink, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@ariakit/react";
import { useTranslations } from "next-intl";
import { useByok } from "@/lib/byok/context";
import {
  PROVIDERS,
  PROVIDER_META,
  REASONING_EFFORT_OPTIONS,
  isAnthropicThinkingCapable,
  isOpenAIReasoningModel,
  listFixedModels,
  resolveModelId,
  type Provider,
} from "@/lib/byok/providers";
import { validateApiKeyFormat } from "@/lib/byok/key";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { ModelCombobox } from "./model-combobox";

type SaveMode = "plain" | "encrypted";

interface ByokPanelProps {
  /** Called after a successful save / unlock. Modal uses this to auto-close
   *  (or — in current design — not auto-close, so the user can tweak model
   *  and reasoning settings post-save). */
  onAfterMutation?: () => void;
  /** Called after a successful key removal. Separate from `onAfterMutation`
   *  because remove is a destructive end-state — there's nothing left to
   *  configure, so the modal should close even when post-save kept it open. */
  onAfterRemove?: () => void;
  /** Called when the user clicks Cancel. Optional — settings has no cancel affordance. */
  onCancel?: () => void;
}

/**
 * The BYOK form body. Routed by `status` to one of three sub-views:
 *   - no key saved        → NewKeyForm     (with provider dropdown)
 *   - encrypted + locked  → UnlockForm
 *   - active              → ActiveKeyView  (with model picker per provider)
 *
 * Has no Dialog chrome of its own — wrap in `<ByokModal>` for in-app use
 * or render directly inside a settings page.
 */
export function ByokPanel({
  onAfterMutation,
  onAfterRemove,
  onCancel,
}: ByokPanelProps) {
  const {
    status,
    storedProvider,
    selectedProvider,
    setSelectedProvider,
    modelByProvider,
    setModelForProvider,
    savePlain,
    saveEncrypted,
    unlock,
    remove,
  } = useByok();

  if (status === "encrypted-locked") {
    return (
      <UnlockForm
        provider={storedProvider ?? "anthropic"}
        onUnlock={async (p) => {
          await unlock(p);
          onAfterMutation?.();
        }}
        onRemove={() => {
          remove();
          onAfterRemove?.();
        }}
        onCancel={onCancel}
      />
    );
  }

  if (status === "none") {
    return (
      <NewKeyForm
        provider={selectedProvider}
        onProviderChange={setSelectedProvider}
        onSave={(k) => {
          savePlain(selectedProvider, k);
          onAfterMutation?.();
        }}
        onSaveEncrypted={async (k, p) => {
          await saveEncrypted(selectedProvider, k, p);
          onAfterMutation?.();
        }}
        onCancel={onCancel}
      />
    );
  }

  // Active key — show status + model picker for the stored provider.
  // We pin the picker to storedProvider (not selectedProvider) because
  // the active key only works with its own provider.
  const activeProvider: Provider = storedProvider ?? "anthropic";
  return (
    <ActiveKeyView
      status={status}
      provider={activeProvider}
      model={modelByProvider[activeProvider]}
      onModelChange={(m) => setModelForProvider(activeProvider, m)}
      onRemove={() => {
        remove();
        onAfterRemove?.();
      }}
    />
  );
}

function ConsoleLink({ provider }: { provider: Provider }) {
  const t = useTranslations("Byok");
  return (
    <a
      href={PROVIDER_META[provider].consoleUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
    >
      {t("consoleLink", { provider: PROVIDER_META[provider].label })}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}

function ProviderSelector({
  value,
  onChange,
}: {
  value: Provider;
  onChange: (p: Provider) => void;
}) {
  const t = useTranslations("Byok");
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {t("providerLabel")}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Provider)}
        className="mt-1 block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500"
      >
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>
            {PROVIDER_META[p].label}
          </option>
        ))}
      </select>
    </div>
  );
}

function NewKeyForm({
  provider,
  onProviderChange,
  onSave,
  onSaveEncrypted,
  onCancel,
}: {
  provider: Provider;
  onProviderChange: (p: Provider) => void;
  onSave: (k: string) => void;
  onSaveEncrypted: (k: string, p: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const t = useTranslations("Byok");
  const [key, setKey] = useState("");
  const [mode, setMode] = useState<SaveMode>("plain");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Switching providers clears the in-progress key + error: a key valid
  // for one provider won't be valid for another and the prefix hint
  // changes.
  function handleProviderChange(p: Provider) {
    setKey("");
    setError(null);
    onProviderChange(p);
  }

  async function handleSave() {
    setError(null);
    const fmt = validateApiKeyFormat(key, provider);
    if (!fmt.ok) {
      setError(fmt.reason ?? t("invalidKey"));
      return;
    }
    if (mode === "encrypted") {
      if (passphrase.length < 4) {
        setError(t("passphraseShort"));
        return;
      }
      if (passphrase !== confirm) {
        setError(t("passphraseMismatch"));
        return;
      }
      setBusy(true);
      try {
        await onSaveEncrypted(key.trim(), passphrase);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("saveFailed"));
      } finally {
        setBusy(false);
      }
    } else {
      onSave(key.trim());
    }
  }

  return (
    <>
      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {t("newKeyDescription")}
      </p>

      <div className="mt-4">
        <ProviderSelector value={provider} onChange={handleProviderChange} />
      </div>

      <div className="mt-4">
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {t("apiKeyLabel")}
        </label>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={PROVIDER_META[provider].keyPlaceholder}
          className="mt-1 block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500"
        />
        <div className="mt-1.5">
          <ConsoleLink provider={provider} />
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={mode === "encrypted"}
            onChange={(e) => setMode(e.target.checked ? "encrypted" : "plain")}
          />
          <span className="text-xs text-zinc-700 dark:text-zinc-300">
            <span className="font-medium">{t("encryptToggle")}</span>
            <span className="block text-zinc-500 dark:text-zinc-400">
              {t("encryptHint")}
            </span>
          </span>
        </label>
        {mode === "encrypted" && (
          <div className="mt-3 grid gap-2">
            <input
              type="password"
              autoComplete="new-password"
              placeholder={t("passphraseLabel")}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500"
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder={t("passphraseConfirmLabel")}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500"
            />
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {t("cancel")}
          </button>
        )}
        <Button
          onClick={handleSave}
          disabled={busy || key.length === 0}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 aria-disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {busy ? t("saving") : t("save")}
        </Button>
      </div>
    </>
  );
}

function UnlockForm({
  provider,
  onUnlock,
  onRemove,
  onCancel,
}: {
  provider: Provider;
  onUnlock: (p: string) => Promise<void>;
  onRemove: () => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("Byok");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgetOpen, setForgetOpen] = useState(false);

  async function handleUnlock() {
    setError(null);
    if (!passphrase) return;
    setBusy(true);
    try {
      await onUnlock(passphrase);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unlockFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {t("unlockDescriptionWithProvider", {
          provider: PROVIDER_META[provider].label,
        })}
      </p>

      <div className="mt-4">
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {t("passphraseLabel")}
        </label>
        <input
          type="password"
          autoFocus
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && passphrase) void handleUnlock();
          }}
          className="mt-1 block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500"
        />
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <ConfirmModal
        isOpen={forgetOpen}
        onClose={() => setForgetOpen(false)}
        onConfirm={onRemove}
        title={t("forgotPassphraseTitle")}
        message={t("forgotPassphraseConfirm")}
        confirmLabel={t("confirmRemoveButton")}
        cancelLabel={t("cancel")}
      />

      <div className="mt-5 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setForgetOpen(true)}
          className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          {t("forgotPassphrase")}
        </button>
        <div className="flex gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              {t("cancel")}
            </button>
          )}
          <Button
            onClick={handleUnlock}
            disabled={busy || !passphrase}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 aria-disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {busy ? t("unlocking") : t("unlock")}
          </Button>
        </div>
      </div>
    </>
  );
}

function ActiveKeyView({
  status,
  provider,
  model,
  onModelChange,
  onRemove,
}: {
  status: "plain" | "encrypted-unlocked";
  provider: Provider;
  model: string;
  onModelChange: (m: string) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("Byok");
  const [removeOpen, setRemoveOpen] = useState(false);

  return (
    <>
      <ConfirmModal
        isOpen={removeOpen}
        onClose={() => setRemoveOpen(false)}
        onConfirm={onRemove}
        title={t("confirmRemoveTitle")}
        message={t("confirmRemoveMessage")}
        confirmLabel={t("confirmRemoveButton")}
        cancelLabel={t("cancel")}
      />
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-900/40 dark:bg-emerald-950/30">
        <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <span className="text-emerald-800 dark:text-emerald-300">
          {t("activeStatusWithProvider", {
            provider: PROVIDER_META[provider].label,
          })}
          {status === "encrypted-unlocked" && (
            <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-emerald-700 dark:text-emerald-400">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {t("encryptedLabel")}
            </span>
          )}
        </span>
      </div>

      <ModelPicker
        provider={provider}
        model={model}
        onChange={onModelChange}
      />

      <ReasoningControls provider={provider} model={model} />

      <div className="mt-5 flex items-center justify-between">
        <ConsoleLink provider={provider} />
        <button
          type="button"
          onClick={() => setRemoveOpen(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Trash2 className="h-3 w-3" />
          {t("removeKey")}
        </button>
      </div>
    </>
  );
}

/**
 * Per-provider model picker:
 *   - Anthropic:   3 fixed-tier chips (Haiku / Sonnet / Opus)
 *   - OpenAI:      searchable combobox over the fixed tier list
 *   - OpenRouter:  searchable combobox over the server-cached
 *                  structured-output allowlist
 */
function ModelPicker({
  provider,
  model,
  onChange,
}: {
  provider: Provider;
  model: string;
  onChange: (m: string) => void;
}) {
  const t = useTranslations("Byok");

  if (provider === "openrouter") {
    return <OpenRouterModelPicker model={model} onChange={onChange} />;
  }

  if (provider === "openai") {
    const fixed = listFixedModels(provider);
    return (
      <div className="mt-4">
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {t("modelLabel")}
        </label>
        <div className="mt-1">
          <ModelCombobox
            items={fixed.map((m) => ({ id: m.alias, label: m.label }))}
            value={model}
            onChange={onChange}
            placeholder={t("searchModels")}
            emptyHint={t("noMatches")}
          />
        </div>
      </div>
    );
  }

  // Anthropic — chips are clearer for three short tier names than a combobox.
  const fixed = listFixedModels(provider);
  return (
    <div className="mt-4">
      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {t("modelLabel")}
      </label>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {fixed.map((m) => (
          <button
            key={m.alias}
            type="button"
            onClick={() => onChange(m.alias)}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
              model === m.alias || (!model && m.alias === fixed[1]?.alias)
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-200 text-zinc-700 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function OpenRouterModelPicker({
  model,
  onChange,
}: {
  model: string;
  onChange: (m: string) => void;
}) {
  const t = useTranslations("Byok");
  const [models, setModels] = useState<{ id: string; name: string }[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/byok/openrouter-models")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fetch"))))
      .then((data: { models: { id: string; name: string }[] }) => {
        if (cancelled) return;
        setModels(data.models);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("openrouterModelsFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="mt-4">
      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {t("modelLabel")}
      </label>
      {models === null && !error && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {t("loadingModels")}
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
      {models && (
        <>
          <div className="mt-1">
            <ModelCombobox
              items={models.map((m) => ({ id: m.id, label: m.name }))}
              value={model}
              onChange={onChange}
              placeholder={t("searchModels")}
              defaultRow={{ id: "", label: t("openrouterDefault") }}
              emptyHint={t("noMatches")}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Provider-specific reasoning UI:
 *   - OpenAI:    4-segment chip control over reasoning_effort, but only
 *                when the selected model is reasoning-tier (gpt-5*, o*).
 *   - Anthropic: pill toggle switch for extended thinking, only when
 *                the selected model supports it (Sonnet 4.5+, Opus 4.1+).
 *   - OpenRouter: nothing — we don't try to manage cross-provider hints.
 */
function ReasoningControls({
  provider,
  model,
}: {
  provider: Provider;
  model: string;
}) {
  const t = useTranslations("Byok");
  const {
    openaiReasoning,
    setOpenaiReasoning,
    anthropicThinking,
    setAnthropicThinking,
  } = useByok();

  if (provider === "openai") {
    // For OpenAI we store the alias as-is (alias === id); detect by the
    // resolved wire ID for safety even when alias and id diverge.
    const wireId = resolveModelId("openai", model || null);
    if (!isOpenAIReasoningModel(wireId)) return null;
    return (
      <div className="mt-4">
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {t("reasoningEffortLabel")}
        </label>
        <div className="mt-2 grid grid-cols-5 gap-2">
          {REASONING_EFFORT_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setOpenaiReasoning(opt)}
              className={`rounded-lg border px-2 py-2 text-xs font-medium capitalize transition ${
                openaiReasoning === opt
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 text-zinc-700 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (provider === "anthropic") {
    // Anthropic chips store the alias; resolve to the wire ID for the
    // capability check (the alias map could change without us noticing).
    const wireId = resolveModelId("anthropic", model || null);
    if (!isAnthropicThinkingCapable(wireId)) return null;
    return (
      <div className="mt-4 flex items-center justify-between">
        <div>
          <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t("thinkingLabel")}
          </span>
          <span className="mt-0.5 block text-[11px] text-zinc-500 dark:text-zinc-400">
            {t("thinkingHint")}
          </span>
        </div>
        <Switch
          checked={anthropicThinking}
          onChange={setAnthropicThinking}
          aria-label={t("thinkingLabel")}
        />
      </div>
    );
  }

  return null;
}

/** Anthropic-style pill toggle switch. role=switch + aria-checked so SR
 *  tools announce it correctly without any extra label wiring. */
function Switch({
  checked,
  onChange,
  ...rest
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange">) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      {...rest}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
        checked
          ? "bg-indigo-600"
          : "bg-zinc-300 dark:bg-zinc-700"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
