import type { InputHTMLAttributes, ReactNode, Ref } from "react";

/**
 * The palette's frame (T3 Code's `apps/web/src/components/CommandPaletteContent.tsx`
 * at 2577baf): the dialog over a dimmed window, the search input with what
 * sits before and after it, a status line, the results, and the footer's
 * key hints. Pressing outside the dialog closes it.
 */
export function CommandPaletteContent(props: {
  readonly onClose: () => void;
  readonly inputRef: Ref<HTMLInputElement>;
  readonly inputProps: InputHTMLAttributes<HTMLInputElement>;
  /** Before the input: the Back button in a submenu, or the browse icon. */
  readonly inputLeading?: ReactNode;
  /** After the input, such as Add project's **Add** button. */
  readonly inputAccessory?: ReactNode;
  /** A line under the input: an error, or what browsing is waiting for. */
  readonly status?: ReactNode;
  /** What Enter does, or nothing when Enter does nothing. */
  readonly footerActionLabel?: string;
  readonly showBackHint: boolean;
  readonly footerTrailing?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[15vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-command-palette=""
        className="flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-950"
      >
        <div className="relative flex items-center gap-2 border-b border-neutral-200 px-4 dark:border-neutral-800">
          {props.inputLeading}
          <input
            ref={props.inputRef}
            {...props.inputProps}
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none"
          />
          {props.inputAccessory}
        </div>
        {props.status === undefined ? null : (
          <div role="status" className="px-4 py-2 text-sm text-neutral-500 dark:text-neutral-400">
            {props.status}
          </div>
        )}
        {props.children}
        <div className="flex items-center justify-between gap-3 border-t border-neutral-200 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          <div className="flex items-center gap-3">
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> Navigate
            </span>
            {props.footerActionLabel === undefined ? null : (
              <span>
                <kbd>Enter</kbd> {props.footerActionLabel}
              </span>
            )}
            {props.showBackHint ? (
              <span>
                <kbd>Backspace</kbd> Back
              </span>
            ) : null}
            <span>
              <kbd>Esc</kbd> Close
            </span>
          </div>
          {props.footerTrailing}
        </div>
      </div>
    </div>
  );
}
