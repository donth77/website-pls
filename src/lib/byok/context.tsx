"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  loadPlainKey,
  loadVaultStatus,
  removeKey,
  savePlainKey,
  saveEncryptedKey,
  unlockEncryptedKey,
} from "./vault";
import { DEFAULT_PROVIDER, PROVIDERS, type Provider } from "./providers";

const PROVIDER_STORAGE_KEY = "websitepls:byok-selected-provider";
const MODELS_STORAGE_KEY = "websitepls:byok-models";

export type ByokStatus =
  | "none"
  | "plain"
  | "encrypted-locked"
  | "encrypted-unlocked";

/**
 * Why the BYOK banner is showing. Each reason gets its own copy so the
 * user understands whether to wait, sign up, or add a key.
 */
export type ByokPromptReason =
  | "platform-budget-low" // Anthropic 429 on the platform key
  | "user-cap" // GENERATION_LIMIT (guest cap or user credits exhausted)
  | "rate-limit"; // RATE_LIMIT (per-hour throttle hit)

export interface ByokContextValue {
  status: ByokStatus;
  /** Provider the saved key belongs to (also the active provider when status≠'none'). */
  storedProvider: Provider | null;
  /** Plaintext key if status is plain or encrypted-unlocked. */
  activeKey: string | null;
  /** Provider currently selected in the UI (for adding/editing a key). */
  selectedProvider: Provider;
  /** Preferred model per provider. Empty string = use the provider's default. */
  modelByProvider: Record<Provider, string>;
  isModalOpen: boolean;
  /** Why the banner is showing, or null if it shouldn't be. */
  promptReason: ByokPromptReason | null;

  openModal: () => void;
  closeModal: () => void;
  setSelectedProvider: (p: Provider) => void;
  savePlain: (provider: Provider, key: string) => void;
  saveEncrypted: (
    provider: Provider,
    key: string,
    passphrase: string,
  ) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  remove: () => void;
  /** Set the preferred model for a specific provider. */
  setModelForProvider: (provider: Provider, modelId: string) => void;
  setPromptReason: (reason: ByokPromptReason | null) => void;
}

const ByokContext = createContext<ByokContextValue | null>(null);

function loadStoredProvider(): Provider {
  try {
    const raw = localStorage.getItem(PROVIDER_STORAGE_KEY);
    if (raw && (PROVIDERS as readonly string[]).includes(raw)) {
      return raw as Provider;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PROVIDER;
}

function emptyModelMap(): Record<Provider, string> {
  return { anthropic: "", openai: "", openrouter: "" };
}

function loadStoredModelMap(): Record<Provider, string> {
  try {
    const raw = localStorage.getItem(MODELS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<Provider, string>>;
      return { ...emptyModelMap(), ...parsed };
    }
  } catch {
    /* ignore */
  }
  return emptyModelMap();
}

export function ByokProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ByokStatus>("none");
  const [storedProvider, setStoredProvider] = useState<Provider | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [selectedProvider, setSelectedProviderState] =
    useState<Provider>(DEFAULT_PROVIDER);
  const [modelByProvider, setModelByProvider] = useState<
    Record<Provider, string>
  >(emptyModelMap());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [promptReason, setPromptReasonState] =
    useState<ByokPromptReason | null>(null);

  // Hydrate from localStorage on mount. SSR returns defaults; the effect
  // runs once after the client takes over and pulls in saved state.
  // The lint rule treats setState-in-effect as a smell, but this is the
  // canonical "sync external system into React state" use case (same as
  // the notify-opt-in hydration in use-generation.ts).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelectedProviderState(loadStoredProvider());
    setModelByProvider(loadStoredModelMap());
    const v = loadVaultStatus();
    if (v.kind === "plain") {
      const loaded = loadPlainKey();
      if (loaded) {
        setActiveKey(loaded.key);
        setStoredProvider(loaded.provider);
        setStatus("plain");
        // Keep selectedProvider in sync with stored on first load — the
        // modal should open to "the provider you saved" not "Anthropic".
        setSelectedProviderState(loaded.provider);
      }
    } else if (v.kind === "encrypted") {
      setStatus("encrypted-locked");
      setStoredProvider(v.provider);
      setSelectedProviderState(v.provider);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);

  const setSelectedProvider = useCallback((p: Provider) => {
    try {
      localStorage.setItem(PROVIDER_STORAGE_KEY, p);
    } catch {
      /* ignore */
    }
    setSelectedProviderState(p);
  }, []);

  const savePlain = useCallback(
    (provider: Provider, key: string) => {
      savePlainKey(provider, key);
      setActiveKey(key);
      setStoredProvider(provider);
      setStatus("plain");
      setPromptReasonState(null);
      setSelectedProvider(provider);
    },
    [setSelectedProvider],
  );

  const saveEncrypted = useCallback(
    async (provider: Provider, key: string, passphrase: string) => {
      await saveEncryptedKey(provider, key, passphrase);
      setActiveKey(key);
      setStoredProvider(provider);
      setStatus("encrypted-unlocked");
      setPromptReasonState(null);
      setSelectedProvider(provider);
    },
    [setSelectedProvider],
  );

  const unlock = useCallback(async (passphrase: string) => {
    const result = await unlockEncryptedKey(passphrase);
    setActiveKey(result.key);
    setStoredProvider(result.provider);
    setStatus("encrypted-unlocked");
    setPromptReasonState(null);
  }, []);

  const remove = useCallback(() => {
    removeKey();
    setActiveKey(null);
    setStoredProvider(null);
    setStatus("none");
  }, []);

  const setModelForProvider = useCallback(
    (provider: Provider, modelId: string) => {
      setModelByProvider((prev) => {
        const next = { ...prev, [provider]: modelId };
        try {
          localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [],
  );

  const setPromptReason = useCallback(
    (reason: ByokPromptReason | null) => setPromptReasonState(reason),
    [],
  );

  const value = useMemo<ByokContextValue>(
    () => ({
      status,
      storedProvider,
      activeKey,
      selectedProvider,
      modelByProvider,
      isModalOpen,
      promptReason,
      openModal,
      closeModal,
      setSelectedProvider,
      savePlain,
      saveEncrypted,
      unlock,
      remove,
      setModelForProvider,
      setPromptReason,
    }),
    [
      status,
      storedProvider,
      activeKey,
      selectedProvider,
      modelByProvider,
      isModalOpen,
      promptReason,
      openModal,
      closeModal,
      setSelectedProvider,
      savePlain,
      saveEncrypted,
      unlock,
      remove,
      setModelForProvider,
      setPromptReason,
    ],
  );

  return <ByokContext.Provider value={value}>{children}</ByokContext.Provider>;
}

export function useByok(): ByokContextValue {
  const ctx = useContext(ByokContext);
  if (!ctx) {
    throw new Error("useByok must be used inside <ByokProvider>");
  }
  return ctx;
}
