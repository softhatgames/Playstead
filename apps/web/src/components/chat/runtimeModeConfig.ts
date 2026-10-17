import type { RuntimeMode } from "@playstead/contracts/orchestrationV2";
import type { JSX } from "react";

import { LockIcon, LockOpenIcon, PenLineIcon, SparklesIcon } from "../icons.tsx";

/**
 * Each runtime mode's label, description and icon, as T3 Code shows them
 * (`apps/web/src/components/chat/runtimeModeConfig.ts` at 2577baf).
 */
export const runtimeModeConfig: Record<
  RuntimeMode,
  {
    readonly label: string;
    readonly description: string;
    readonly icon: (props: { readonly className?: string }) => JSX.Element;
  }
> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  auto: {
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
    icon: SparklesIcon,
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: LockOpenIcon,
  },
};

/** The modes the picker offers, in T3 Code's order. */
export const runtimeModeOptions: ReadonlyArray<RuntimeMode> = [
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
];
