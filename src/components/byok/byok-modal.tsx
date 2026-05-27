"use client";

import { Key, Lock, Trash2, X, ExternalLink, Check } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogDismiss,
  DialogHeading,
  useDialogStore,
  Button,
} from "@ariakit/react";
import { useByok } from "@/lib/byok/context";
import { BYOK_MODELS, type ByokModelAlias } from "@/lib/byok/models";
import { validateApiKeyFormat } from "@/lib/byok/key";

const ANTHROPIC_CONSOLE_URL = "https://console.anthropic.com/settings/keys";

type SaveMode = "plain" | "encrypted";

export function ByokModal() {
  const {
    status,
    isModalOpen,
    closeModal,
    model,
    setModel,
    savePlain,
    saveEncrypted,
    unlock,
    remove,
  } = useByok();

  const dialog = useDialogStore({
    open: isModalOpen,
    setOpen(open) {
      if (!open) closeModal();
    },
  });

  return (
    <Dialog
      store={dialog}
      backdrop={
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
      }
      className="fixed inset-4 z-50 m-auto h-fit w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
          <DialogHeading className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Anthropic API key
          </DialogHeading>
        </div>
        <DialogDismiss
          className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </DialogDismiss>
      </div>

      {status === "encrypted-locked" ? (
        <UnlockForm onUnlock={unlock} onRemove={remove} />
      ) : status === "none" ? (
        <NewKeyForm onSave={savePlain} onSaveEncrypted={saveEncrypted} />
      ) : (
        <ActiveKeyView
          status={status}
          model={model}
          onModelChange={setModel}
          onRemove={remove}
        />
      )}
    </Dialog>
  );
}

function ConsoleLink() {
  return (
    <a
      href={ANTHROPIC_CONSOLE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
    >
      Get a key from the Anthropic console
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}

function NewKeyForm({
  onSave,
  onSaveEncrypted,
}: {
  onSave: (k: string) => void;
  onSaveEncrypted: (k: string, p: string) => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [mode, setMode] = useState<SaveMode>("plain");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setError(null);
    const fmt = validateApiKeyFormat(key);
    if (!fmt.ok) {
      setError(fmt.reason ?? "Invalid API key.");
      return;
    }
    if (mode === "encrypted") {
      if (passphrase.length < 4) {
        setError("Passphrase must be at least 4 characters.");
        return;
      }
      if (passphrase !== confirm) {
        setError("Passphrases don't match.");
        return;
      }
      setBusy(true);
      try {
        await onSaveEncrypted(key.trim(), passphrase);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to encrypt key.");
      } finally {
        setBusy(false);
      }
    } else {
      onSave(key.trim());
    }
  }

  return (
    <>
      <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Your key stays in this browser. It&apos;s sent only with your own
        generation requests and never stored on the server.
      </p>

      <div className="mt-4">
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          API key
        </label>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-ant-…"
          className="mt-1 block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500"
        />
        <div className="mt-1.5">
          <ConsoleLink />
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
            <span className="font-medium">Encrypt with a passphrase</span>
            <span className="block text-zinc-500 dark:text-zinc-400">
              You&apos;ll re-enter the passphrase once per session. Without one,
              the key is stored unencrypted in this browser.
            </span>
          </span>
        </label>
        {mode === "encrypted" && (
          <div className="mt-3 grid gap-2">
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500"
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Confirm passphrase"
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
        <DialogDismiss className="rounded-xl px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">
          Cancel
        </DialogDismiss>
        <Button
          onClick={handleSave}
          disabled={busy || key.length === 0}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 aria-disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {busy ? "Saving…" : "Save to this browser"}
        </Button>
      </div>
    </>
  );
}

function UnlockForm({
  onUnlock,
  onRemove,
}: {
  onUnlock: (p: string) => Promise<void>;
  onRemove: () => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleUnlock() {
    setError(null);
    if (!passphrase) return;
    setBusy(true);
    try {
      await onUnlock(passphrase);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unlock failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Your key is encrypted in this browser. Enter your passphrase to unlock
        it for this session.
      </p>

      <div className="mt-4">
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Passphrase
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

      <div className="mt-5 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            if (
              confirm(
                "This deletes the encrypted key in this browser. You'll need to paste your API key again.",
              )
            ) {
              onRemove();
            }
          }}
          className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Forgot passphrase?
        </button>
        <div className="flex gap-2">
          <DialogDismiss className="rounded-xl px-4 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">
            Cancel
          </DialogDismiss>
          <Button
            onClick={handleUnlock}
            disabled={busy || !passphrase}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 aria-disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {busy ? "Unlocking…" : "Unlock"}
          </Button>
        </div>
      </div>
    </>
  );
}

function ActiveKeyView({
  status,
  model,
  onModelChange,
  onRemove,
}: {
  status: "plain" | "encrypted-unlocked";
  model: ByokModelAlias;
  onModelChange: (m: ByokModelAlias) => void;
  onRemove: () => void;
}) {
  // Reset transient confirm state when modal re-opens
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  useEffect(() => {
    return () => setConfirmingRemove(false);
  }, []);

  return (
    <>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-900/40 dark:bg-emerald-950/30">
        <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <span className="text-emerald-800 dark:text-emerald-300">
          Using your Anthropic key
          {status === "encrypted-unlocked" && (
            <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-emerald-700 dark:text-emerald-400">
              <Lock className="h-3 w-3" aria-hidden="true" />
              encrypted
            </span>
          )}
        </span>
      </div>

      <div className="mt-4">
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Model
        </label>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(Object.keys(BYOK_MODELS) as ByokModelAlias[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModelChange(m)}
              className={`rounded-lg border px-3 py-2 text-xs font-medium capitalize transition ${
                model === m
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 text-zinc-700 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          Haiku is fastest and cheapest. Opus is highest quality. Sonnet is the
          balanced default.
        </p>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <ConsoleLink />
        {confirmingRemove ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onRemove();
                setConfirmingRemove(false);
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              <Trash2 className="h-3 w-3" />
              Confirm remove
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingRemove(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Trash2 className="h-3 w-3" />
            Remove key
          </button>
        )}
      </div>
    </>
  );
}
