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
import { DEFAULT_BYOK_MODEL, type ByokModelAlias, BYOK_MODELS } from "./models";

const MODEL_STORAGE_KEY = "websitepls:byok-model";

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
  /** Plaintext key if status is plain or encrypted-unlocked. */
  activeKey: string | null;
  model: ByokModelAlias;
  isModalOpen: boolean;
  /** Why the banner is showing, or null if it shouldn't be. */
  promptReason: ByokPromptReason | null;

  openModal: () => void;
  closeModal: () => void;
  savePlain: (key: string) => void;
  saveEncrypted: (key: string, passphrase: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  remove: () => void;
  setModel: (m: ByokModelAlias) => void;
  setPromptReason: (reason: ByokPromptReason | null) => void;
}

const ByokContext = createContext<ByokContextValue | null>(null);

function loadStoredModel(): ByokModelAlias {
  try {
    const raw = localStorage.getItem(MODEL_STORAGE_KEY);
    if (raw && raw in BYOK_MODELS) return raw as ByokModelAlias;
  } catch {
    /* ignore */
  }
  return DEFAULT_BYOK_MODEL;
}

export function ByokProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ByokStatus>("none");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [model, setModelState] = useState<ByokModelAlias>(DEFAULT_BYOK_MODEL);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [promptReason, setPromptReasonState] =
    useState<ByokPromptReason | null>(null);

  // Hydrate from localStorage on mount. SSR returns the defaults; the
  // effect runs once after the client takes over and pulls in the user's
  // saved key/model. This is the canonical "sync external system into
  // React state" use case the lint rule wants us to opt out of.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setModelState(loadStoredModel());
    const v = loadVaultStatus();
    if (v.kind === "plain") {
      const k = loadPlainKey();
      if (k) {
        setActiveKey(k);
        setStatus("plain");
      }
    } else if (v.kind === "encrypted") {
      setStatus("encrypted-locked");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);

  const savePlain = useCallback((key: string) => {
    savePlainKey(key);
    setActiveKey(key);
    setStatus("plain");
    setPromptReasonState(null);
  }, []);

  const saveEncrypted = useCallback(
    async (key: string, passphrase: string) => {
      await saveEncryptedKey(key, passphrase);
      setActiveKey(key);
      setStatus("encrypted-unlocked");
      setPromptReasonState(null);
    },
    [],
  );

  const unlock = useCallback(async (passphrase: string) => {
    const k = await unlockEncryptedKey(passphrase);
    setActiveKey(k);
    setStatus("encrypted-unlocked");
    setPromptReasonState(null);
  }, []);

  const remove = useCallback(() => {
    removeKey();
    setActiveKey(null);
    setStatus("none");
  }, []);

  const setModel = useCallback((m: ByokModelAlias) => {
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
    setModelState(m);
  }, []);

  const setPromptReason = useCallback(
    (reason: ByokPromptReason | null) => setPromptReasonState(reason),
    [],
  );

  const value = useMemo<ByokContextValue>(
    () => ({
      status,
      activeKey,
      model,
      isModalOpen,
      promptReason,
      openModal,
      closeModal,
      savePlain,
      saveEncrypted,
      unlock,
      remove,
      setModel,
      setPromptReason,
    }),
    [
      status,
      activeKey,
      model,
      isModalOpen,
      promptReason,
      openModal,
      closeModal,
      savePlain,
      saveEncrypted,
      unlock,
      remove,
      setModel,
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
