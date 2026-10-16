import type { ModelSelection } from "@playstead/contracts/orchestrationV2";
import { useEffect, useRef, useState } from "react";

import { ChevronDownIcon } from "../icons.tsx";
import type { ModelPickerEntry } from "./composer.logic.ts";

/**
 * T3 Code's model picker (`apps/web/src/components/chat/ProviderModelPicker.tsx`
 * and `ModelPickerContent.tsx` at 2577baf), trimmed: a popover listing each
 * provider's models. Changing a started thread's model is #23's, so once the
 * thread has started the picker only shows its model.
 */
export function ProviderModelPicker(props: {
  readonly entries: ReadonlyArray<ModelPickerEntry>;
  readonly selection: ModelSelection | undefined;
  readonly onSelect?: (selection: ModelSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement | null>(null);
  const selectedEntry = props.entries.find(
    (entry) => entry.instanceId === props.selection?.instanceId,
  );
  const selectedModel = selectedEntry?.models.find(
    (model) => model.slug === props.selection?.model,
  );
  const label =
    selectedEntry === undefined
      ? "No provider available"
      : `${selectedEntry.displayName} · ${selectedModel?.name ?? props.selection?.model}`;
  const choosable = props.onSelect !== undefined && props.entries.length > 0;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={!choosable}
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:hover:bg-transparent dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <span>{label}</span>
        {choosable ? <ChevronDownIcon className="size-3" /> : null}
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Model"
          className="absolute bottom-full left-0 z-20 mb-1 w-64 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
        >
          {props.entries.map((entry) => (
            <div key={entry.instanceId} className="py-1">
              <div className="px-2 pb-1 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                {entry.displayName}
              </div>
              {entry.models.map((model) => {
                const selected =
                  entry.instanceId === props.selection?.instanceId &&
                  model.slug === props.selection?.model;
                return (
                  <button
                    key={model.slug}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      props.onSelect?.({ instanceId: entry.instanceId, model: model.slug });
                      setOpen(false);
                    }}
                    className={`block w-full rounded-md px-2 py-1 text-left text-sm ${
                      selected
                        ? "bg-neutral-100 font-medium dark:bg-neutral-800"
                        : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    }`}
                  >
                    {model.name}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
