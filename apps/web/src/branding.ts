import { identity } from "@playstead/shared/identity";

import { desktopBridge } from "./env.ts";

/** The name in the window title and the interface: the development name in development. */
export const APP_DISPLAY_NAME =
  desktopBridge?.getAppBranding().displayName ??
  (import.meta.env.DEV ? identity.productName.development : identity.productName.production);
