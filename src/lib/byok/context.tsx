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

export interface ByokContextValue {
  status: ByokStatus;
  /** Plaintext key if status is plain or encrypted-unlocked. */
  activeKey: string | null;
  model: ByokModelAlias;
  isModalOpen: boolean;
  /** Set when the server reports PLATFORM_BUDGET_LOW. */
  budgetLow: boolean;

  openModal: () => void;
  closeModal: () => void;
  savePlain: (key: string) => void;
  saveEncrypted: (key: string, passphrase: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  remove: () => void;
  setModel: (m: ByokModelAlias) => void;
  markBudgetLow: () => void;
  clearBudgetLow: () => void;
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
  const [budgetLow, setBudgetLow] = useState(false);

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
    setBudgetLow(false);
  }, []);

  const saveEncrypted = useCallback(
    async (key: string, passphrase: string) => {
      await saveEncryptedKey(key, passphrase);
      setActiveKey(key);
      setStatus("encrypted-unlocked");
      setBudgetLow(false);
    },
    [],
  );

  const unlock = useCallback(async (passphrase: string) => {
    const k = await unlockEncryptedKey(passphrase);
    setActiveKey(k);
    setStatus("encrypted-unlocked");
    setBudgetLow(false);
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

  const markBudgetLow = useCallback(() => setBudgetLow(true), []);
  const clearBudgetLow = useCallback(() => setBudgetLow(false), []);

  const value = useMemo<ByokContextValue>(
    () => ({
      status,
      activeKey,
      model,
      isModalOpen,
      budgetLow,
      openModal,
      closeModal,
      savePlain,
      saveEncrypted,
      unlock,
      remove,
      setModel,
      markBudgetLow,
      clearBudgetLow,
    }),
    [
      status,
      activeKey,
      model,
      isModalOpen,
      budgetLow,
      openModal,
      closeModal,
      savePlain,
      saveEncrypted,
      unlock,
      remove,
      setModel,
      markBudgetLow,
      clearBudgetLow,
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
