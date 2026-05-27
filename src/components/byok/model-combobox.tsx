"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  Combobox,
  ComboboxItem,
  ComboboxPopover,
  ComboboxProvider,
} from "@ariakit/react";

export interface ModelComboboxItem {
  id: string;
  label: string;
}

interface ModelComboboxProps {
  items: ModelComboboxItem[];
  /** Current selected id. Empty string = no selection (uses default). */
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  /** Optional "use the default" row shown above the live items. Its `id` is empty. */
  defaultRow?: ModelComboboxItem;
  /** Shown below the input when nothing matches the typed query. */
  emptyHint?: string;
}

/**
 * Searchable model picker built on Ariakit's Combobox primitive. Used for
 * OpenAI (small fixed list) and OpenRouter (100+ dynamic entries) so both
 * have the same affordance: type to filter, click to pick.
 *
 * The input doubles as the display:
 *   - empty value (no selection) → shows the default row label as a placeholder
 *   - non-empty value            → shows the selected item's label
 *   - user is typing             → shows their query and a filtered popover
 */
export function ModelCombobox({
  items,
  value,
  onChange,
  placeholder,
  defaultRow,
  emptyHint,
}: ModelComboboxProps) {
  // Display value in the input. We sync this to `value` whenever the
  // external selection changes (e.g. on first hydration), but also let
  // the user freely type to filter — `isTyping` distinguishes the two.
  const [text, setText] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  const selectedLabel = useMemo(() => {
    if (!value) return "";
    return items.find((i) => i.id === value)?.label ?? "";
  }, [items, value]);

  // Sync display text from external value when the user isn't actively
  // typing. Keeps the input showing the selected label after the user
  // closes the popover, and reflects external selection changes
  // (e.g. provider switch). This is a legitimate "external state → React
  // state" sync, not cascading, so we silence the lint rule.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isTyping) setText(selectedLabel);
  }, [selectedLabel, isTyping]);

  const query = isTyping ? text.toLowerCase() : "";
  const filtered = useMemo(
    () =>
      !query
        ? items
        : items.filter(
            (i) =>
              i.label.toLowerCase().includes(query) ||
              i.id.toLowerCase().includes(query),
          ),
    [items, query],
  );

  return (
    <ComboboxProvider
      resetValueOnHide
      setValue={(v) => {
        setText(v);
        setIsTyping(true);
      }}
    >
      <div className="relative">
        <Combobox
          placeholder={placeholder}
          value={text}
          autoSelect
          className="block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 pr-8 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500"
          onBlur={() => {
            // Drop transient typing state so the next render snaps the
            // input back to the canonical selected label.
            setIsTyping(false);
          }}
        />
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-500"
          aria-hidden="true"
        />
      </div>
      <ComboboxPopover
        gutter={4}
        sameWidth
        className="z-50 max-h-72 overflow-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      >
        {defaultRow && (
          <ComboboxItem
            value={defaultRow.label}
            onClick={() => {
              setIsTyping(false);
              onChange("");
            }}
            className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-1.5 text-sm data-[active-item]:bg-zinc-100 dark:data-[active-item]:bg-zinc-800 ${
              !value ? "font-medium" : ""
            }`}
          >
            <span className="text-zinc-700 dark:text-zinc-300">
              {defaultRow.label}
            </span>
            {!value && (
              <Check className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400" />
            )}
          </ComboboxItem>
        )}
        {filtered.length === 0 && (
          <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
            {emptyHint ?? "No matches"}
          </p>
        )}
        {filtered.map((item) => (
          <ComboboxItem
            key={item.id}
            value={item.label}
            onClick={() => {
              setIsTyping(false);
              onChange(item.id);
            }}
            className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-1.5 text-sm data-[active-item]:bg-zinc-100 dark:data-[active-item]:bg-zinc-800 ${
              value === item.id ? "font-medium" : ""
            }`}
          >
            <span className="text-zinc-700 dark:text-zinc-300">
              {item.label}
            </span>
            {value === item.id && (
              <Check className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400" />
            )}
          </ComboboxItem>
        ))}
      </ComboboxPopover>
    </ComboboxProvider>
  );
}
