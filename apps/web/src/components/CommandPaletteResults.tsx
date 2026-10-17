import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";

import { keybindings, shortcutLabelForCommand } from "../keybindings.ts";
import type {
  CommandPaletteEntry,
  CommandPaletteIcon,
  CommandPaletteRow,
} from "./CommandPalette.logic.ts";
import {
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  FolderUpIcon,
  LinkIcon,
  MessageSquareDashedIcon,
  MessageSquareIcon,
  SettingsIcon,
  SquarePenIcon,
} from "./icons.tsx";
import { ThreadStatusIndicator } from "./sidebar/SidebarThreadParts.tsx";
import { ThreadSearchMatchExcerpt } from "./ThreadSearchMatch.tsx";

/**
 * The palette's list of results (T3 Code's
 * `apps/web/src/components/CommandPaletteResults.tsx` at 2577baf): group
 * headings and rows, or a message when nothing matches. The input owns the
 * keyboard; a row is highlighted by hovering and runs on click.
 */

export const COMMAND_PALETTE_LISTBOX_ID = "command-palette-results";
export const commandPaletteOptionId = (index: number) => `command-palette-option-${index}`;

export const COMMAND_PALETTE_ICON_CLASS = "size-4 shrink-0 text-neutral-500 dark:text-neutral-400";

function ItemIcon({ icon }: { readonly icon: CommandPaletteIcon }) {
  switch (icon) {
    case "new-thread":
      return <SquarePenIcon className={COMMAND_PALETTE_ICON_CLASS} />;
    case "no-project":
      return <MessageSquareDashedIcon className={COMMAND_PALETTE_ICON_CLASS} />;
    case "add-project":
      return <FolderPlusIcon className={COMMAND_PALETTE_ICON_CLASS} />;
    case "settings":
      return <SettingsIcon className={COMMAND_PALETTE_ICON_CLASS} />;
    case "copy":
      return <LinkIcon className={COMMAND_PALETTE_ICON_CLASS} />;
    case "project":
    case "folder":
      return <FolderIcon className={COMMAND_PALETTE_ICON_CLASS} />;
    case "folder-up":
      return <FolderUpIcon className={COMMAND_PALETTE_ICON_CLASS} />;
    case "thread":
      return <MessageSquareIcon className={COMMAND_PALETTE_ICON_CLASS} />;
  }
}

export function CommandPaletteResults(props: {
  readonly rows: ReadonlyArray<CommandPaletteRow>;
  readonly activeValue: string | null;
  /** Shown when there are no rows; nothing shows when it is undefined. */
  readonly emptyMessage: string | undefined;
  readonly threadById: ReadonlyMap<string, OrchestrationV2ThreadShell>;
  readonly onHighlight: (item: CommandPaletteEntry) => void;
  readonly onExecute: (item: CommandPaletteEntry) => void;
}) {
  return (
    <div
      id={COMMAND_PALETTE_LISTBOX_ID}
      role="listbox"
      aria-label="Results"
      className="max-h-[min(28rem,70vh)] overflow-y-auto p-2"
    >
      {props.rows.length === 0 && props.emptyMessage !== undefined ? (
        <div className="py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
          {props.emptyMessage}
        </div>
      ) : (
        props.rows.map((row) =>
          row.kind === "label" ? (
            <div
              key={row.key}
              role="presentation"
              className={`px-2 pb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400 ${row.first ? "" : "pt-3"}`}
            >
              {row.label}
            </div>
          ) : (
            <ResultRow
              key={row.key}
              item={row.item}
              index={row.itemIndex}
              active={row.item.value === props.activeValue}
              thread={
                row.item.threadId === undefined
                  ? undefined
                  : props.threadById.get(row.item.threadId)
              }
              onHighlight={() => props.onHighlight(row.item)}
              onExecute={() => props.onExecute(row.item)}
            />
          ),
        )
      )}
    </div>
  );
}

/** A result (T3 Code's `CommandPaletteResultRow`). */
function ResultRow(props: {
  readonly item: CommandPaletteEntry;
  readonly index: number | null;
  readonly active: boolean;
  readonly thread: OrchestrationV2ThreadShell | undefined;
  readonly onHighlight: () => void;
  readonly onExecute: () => void;
}) {
  const { item } = props;
  const shortcut =
    item.shortcutCommand === undefined
      ? null
      : shortcutLabelForCommand(keybindings, item.shortcutCommand);
  const title = (
    <span className="flex min-w-0 items-center gap-1.5 text-sm text-neutral-900 dark:text-neutral-100">
      {props.thread === undefined ? null : <ThreadStatusIndicator thread={props.thread} />}
      <span className="truncate">
        {item.title}
        {item.titleEmphasis === undefined ? null : (
          <>
            {" "}
            <span className="font-semibold">{item.titleEmphasis}</span>
          </>
        )}
      </span>
    </span>
  );
  return (
    <div
      id={props.index === null ? undefined : commandPaletteOptionId(props.index)}
      role="option"
      aria-selected={props.active}
      aria-disabled={item.disabled || undefined}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={item.disabled ? undefined : props.onHighlight}
      onClick={item.disabled ? undefined : props.onExecute}
      className={`flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 py-1.5 ${
        item.disabled ? "opacity-60" : ""
      } ${props.active ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
    >
      <ItemIcon icon={item.icon} />
      {item.description !== undefined || item.threadContentMatch !== undefined ? (
        <span className="flex min-w-0 flex-1 flex-col">
          {title}
          {item.threadContentMatch === undefined ? null : (
            <ThreadSearchMatchExcerpt
              match={item.threadContentMatch}
              query={item.threadContentMatch.query}
            />
          )}
          {item.description === undefined || item.description === "" ? null : (
            <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {item.description}
            </span>
          )}
        </span>
      ) : (
        <span className="flex min-w-0 flex-1">{title}</span>
      )}
      {item.timestamp === undefined ? null : (
        <span className="min-w-12 shrink-0 text-right text-xs text-neutral-500 tabular-nums dark:text-neutral-400">
          {item.timestamp}
        </span>
      )}
      {shortcut === null ? null : (
        <kbd className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{shortcut}</kbd>
      )}
      {item.kind === "submenu" ? (
        <ChevronRightIcon className="size-4 shrink-0 text-neutral-500 dark:text-neutral-400" />
      ) : null}
    </div>
  );
}
