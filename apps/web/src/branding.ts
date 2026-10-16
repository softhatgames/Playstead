import { identity } from "@playstead/shared/identity";

/** The name in the window title and the interface: the development name in development. */
export const APP_DISPLAY_NAME = import.meta.env.DEV
  ? identity.productName.development
  : identity.productName.production;
