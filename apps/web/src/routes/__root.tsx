import { CustomSnoozeDialogHost } from "../components/CustomSnoozeDialog.tsx";
import { Outlet, createRootRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { APP_DISPLAY_NAME } from "../branding.ts";
import { ConfirmDialogHost } from "../components/ConfirmDialogHost.tsx";
import { ToastHost } from "../components/ToastHost.tsx";
import { useSystemTheme } from "../hooks/useTheme.ts";

function RootRouteView() {
  useSystemTheme();
  useEffect(() => {
    document.title = APP_DISPLAY_NAME;
  }, []);
  return (
    <div className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <Outlet />
      <ConfirmDialogHost />
      <CustomSnoozeDialogHost />
      <ToastHost />
    </div>
  );
}

export const Route = createRootRoute({ component: RootRouteView });
