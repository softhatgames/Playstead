import {
  RouterProvider,
  createBrowserHistory,
  createHashHistory,
  createRouter,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { isElectron } from "./env.ts";
import "./index.css";
import { routeTree } from "./routeTree.gen.ts";

// The desktop window always loads `<scheme>://app/`, so it routes in the hash, as T3 Code does.
const router = createRouter({
  routeTree,
  history: isElectron ? createHashHistory() : createBrowserHistory(),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
