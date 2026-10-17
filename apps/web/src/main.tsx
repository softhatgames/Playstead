import {
  RouterProvider,
  createBrowserHistory,
  createHashHistory,
  createRouter,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { WaitingForServer } from "./components/SignedInGate.tsx";
import { isElectron } from "./env.ts";
import "./index.css";
import { routeTree } from "./routeTree.gen.ts";

// The desktop window always loads `<scheme>://app/`, so it routes in the hash, as T3 Code does.
// Each page's loader is the session check, so a page still loading is waiting for the server.
const router = createRouter({
  routeTree,
  history: isElectron ? createHashHistory() : createBrowserHistory(),
  defaultPendingComponent: WaitingForServer,
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
