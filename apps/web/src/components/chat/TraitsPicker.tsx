import type { ModelCapabilities, ProviderOptionSelection } from "@playstead/contracts/model";
import type { ProviderDriverKind } from "@playstead/contracts/providerInstance";
import { useEffect, useRef, useState } from "react";

import { BrainIcon, ChevronDownIcon } from "../icons.tsx";
import { chooseTrait, selectedChoice, traitsMenuState } from "./traits.logic.ts";

/**
 * T3 Code's reasoning and traits picker (`apps/web/src/components/chat/TraitsPicker.tsx`
 * at 2577baf), descriptor-driven: a trigger with the brain icon that reads
 * the current choices, and a menu with one radio group per select (its
 * label, each choice's description and a **Default** badge) and On/Off for
 * each boolean. Picking Ultrathink writes it into the prompt. A model
 * without options shows nothing. While the composer cannot send it is
 * disabled, as the model picker is.
 */
export function TraitsPicker(props: {
  readonly provider: ProviderDriverKind;
  readonly capabilities: ModelCapabilities | null | undefined;
  readonly options: ReadonlyArray<ProviderOptionSelection> | undefined;
  readonly prompt: string;
  readonly onPromptChange: (prompt: string) => void;
  readonly onOptionsChange: (options: ReadonlyArray<ProviderOptionSelection> | undefined) => void;
  readonly disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement | null>(null);
  const state = traitsMenuState({
    provider: props.provider,
    capabilities: props.capabilities,
    prompt: props.prompt,
    options: props.options,
  });

  useEffect(() => {
    if (props.disabled) setOpen(false);
  }, [props.disabled]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!state.hasAnyControls) return null;

  const choose = (descriptorId: string, value: string | boolean) => {
    const change = chooseTrait(state, descriptorId, value, props.prompt);
    if (change.prompt !== undefined) props.onPromptChange(change.prompt);
    if ("options" in change) props.onOptionsChange(change.options);
    setOpen(false);
  };

  const sectionTitle = (title: string) => (
    <div className="px-2 pt-1.5 pb-1 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
      {title}
    </div>
  );
  const itemClass = (selected: boolean) =>
    `flex w-full flex-col rounded-md px-2 py-1 text-left text-sm disabled:opacity-50 ${
      selected
        ? "bg-neutral-100 font-medium dark:bg-neutral-800"
        : "hover:bg-neutral-100 disabled:hover:bg-transparent dark:hover:bg-neutral-800"
    }`;
  const divider = <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />;

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={state.triggerLabel}
        title={state.triggerLabel}
        disabled={props.disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex max-w-48 items-center gap-1 rounded-md px-2 py-1 text-xs whitespace-nowrap text-neutral-600 hover:bg-neutral-100 disabled:hover:bg-transparent dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <BrainIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{state.triggerLabel}</span>
        <ChevronDownIcon className="size-3 shrink-0" />
      </button>
      {open && !props.disabled ? (
        <div
          role="menu"
          aria-label="Traits"
          className="absolute bottom-full left-0 z-20 mb-1 w-64 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
        >
          {state.selectDescriptors.map((descriptor, index) => {
            const isPrimary = descriptor.id === state.primarySelectDescriptor?.id;
            const locked = state.ultrathinkInBodyText && isPrimary;
            const picked = selectedChoice(state, descriptor);
            return (
              <div key={descriptor.id} role="group" aria-label={descriptor.label}>
                {index > 0 ? divider : null}
                {sectionTitle(descriptor.label)}
                {locked ? (
                  <p className="px-2 pb-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                    Your prompt contains &quot;ultrathink&quot; in the text. Remove it to change
                    this option.
                  </p>
                ) : null}
                {descriptor.options.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={picked === choice.id}
                    disabled={locked}
                    onClick={() => choose(descriptor.id, choice.id)}
                    className={itemClass(picked === choice.id)}
                  >
                    <span className="flex items-center gap-1.5">
                      {choice.label}
                      {choice.isDefault === true ? (
                        <span className="rounded border border-neutral-300 px-1 text-[10px] leading-4 font-normal text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                          Default
                        </span>
                      ) : null}
                    </span>
                    {choice.description === undefined ? null : (
                      <span className="text-xs font-normal text-neutral-500 dark:text-neutral-400">
                        {choice.description}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
          {state.booleanDescriptors.map((descriptor, index) => (
            <div key={descriptor.id} role="group" aria-label={descriptor.label}>
              {index > 0 || state.selectDescriptors.length > 0 ? divider : null}
              {sectionTitle(descriptor.label)}
              {[true, false].map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  role="menuitemradio"
                  aria-checked={(descriptor.currentValue === true) === value}
                  onClick={() => choose(descriptor.id, value)}
                  className={itemClass((descriptor.currentValue === true) === value)}
                >
                  {value ? "On" : "Off"}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
