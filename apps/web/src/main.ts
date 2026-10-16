import { identity } from "@playstead/shared/identity";

// The interface itself arrives with "Server and interface in a browser".
document.title = import.meta.env.DEV
  ? identity.productName.development
  : identity.productName.production;
