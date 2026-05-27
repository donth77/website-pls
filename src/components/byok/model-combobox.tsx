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
 * Searchable model picker built on Ariakit's Combobox primitive. The input
 * doubles as the display — it shows the selected item's label when the
 * user isn't actively searching.
 *
 * Filtering: anything typed that doesn't exactly equal the selected
 * label is treated as a search query. This lets the popover show the
 * full list when first opened (input already holds the selected label,
 * "matches itself") but narrows as the user types.
 */
export function ModelCombobox({
  items,
  value,
  onChange,
  placeholder,
  defaultRow,
  emptyHint,
}: ModelComboboxProps) {
  const selectedLabel = useMemo(() => {
    if (!value) return defaultRow?.label ?? "";
    return items.find((i) => i.id === value)?.label ?? "";
  }, [items, value, defaultRow]);

  // Controlled value for the input. We sync it from `selectedLabel`
  // whenever the external selection changes, but let the user type
  // freely in between.
  const [text, setText] = useState(selectedLabel);

  useEffect(() => {
    setText(selectedLabel);
  }, [selectedLabel]);

  // Filter only when the user has typed something other than the
  // selected label. On first open the input holds the selected label,
  // so the popover shows the full list rather than a single self-match.
  const query = text === selectedLabel ? "" : text.toLowerCase().trim();
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

  function commit(id: string, label: string) {
    setText(label);
    onChange(id);
  }

  return (
    <ComboboxProvider value={text} setValue={setText}>
      <div className="relative">
        <Combobox
          placeholder={placeholder}
          autoSelect
          className="block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 pr-8 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500"
          onFocus={(e) => e.currentTarget.select()}
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
            onClick={() => commit("", defaultRow.label)}
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
            onClick={() => commit(item.id, item.label)}
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
