import type { RuntimeMode } from "@playstead/contracts/orchestrationV2";
import { type KeyboardEvent, useEffect, useRef } from "react";

import { ChevronDownIcon } from "../icons.tsx";
import { runtimeModeConfig, runtimeModeOptions } from "./runtimeModeConfig.ts";

/**
 * The composer's mode picker (T3 Code's `ComposerFooterModeControls` in
 * `apps/web/src/components/chat/ChatComposer.tsx` at 2577baf): the mode's
 * icon and label, its description as the tooltip, and a list of the modes
 * with their descriptions. Choosing one only changes the composer's draft;
 * the mode is sent before the next message. The composer opens it on
 * `mod+shift+a`. Arrow keys move through the list, Enter chooses, Escape
 * closes.
 */
export function RuntimeModePicker(props: {
  readonly mode: RuntimeMode;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (mode: RuntimeMode) => void;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const current = runtimeModeConfig[props.mode];
  const CurrentIcon = current.icon;
  const { onOpenChange } = props;

  useEffect(() => {
    if (!props.open) return;
    list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    const close = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [props.open, onOpenChange]);

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const options = [...(list.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? [])];
    const at = options.findIndex((option) => option === document.activeElement);
    const next = event.key === "ArrowDown" ? at + 1 : at - 1;
    options[(next + options.length) % options.length]?.focus();
  };

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-label="Runtime mode"
        aria-haspopup="listbox"
        aria-expanded={props.open}
        data-composer-shortcut="composer.mode"
        title={current.description}
        onClick={() => onOpenChange(!props.open)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <CurrentIcon className="size-3.5" />
        <span>{current.label}</span>
        <ChevronDownIcon className="size-3" />
      </button>
      {props.open ? (
        <div
          ref={list}
          role="listbox"
          aria-label="Runtime mode"
          onKeyDown={onListKeyDown}
          className="absolute bottom-full left-0 z-20 mb-1 min-w-64 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
        >
          {runtimeModeOptions.map((mode) => {
            const option = runtimeModeConfig[mode];
            const OptionIcon = option.icon;
            const selected = mode === props.mode;
            return (
              <button
                key={mode}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  props.onSelect(mode);
                  onOpenChange(false);
                }}
                className={`grid w-full gap-0.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
                  selected
                    ? "bg-neutral-100 dark:bg-neutral-800"
                    : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                  <OptionIcon className="size-3.5 shrink-0 text-neutral-500 dark:text-neutral-400" />
                  {option.label}
                </span>
                <span className="text-xs leading-4 text-neutral-500 dark:text-neutral-400">
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
