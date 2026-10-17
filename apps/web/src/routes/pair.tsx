import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { APP_DISPLAY_NAME } from "../branding.ts";
import { exchangePairingLink } from "../environments/primary/auth.ts";
import type { PairingResult } from "../pairingExchange.ts";

const messages: Record<Exclude<PairingResult["_tag"], "Paired">, string> = {
  MissingToken: "This pairing link has no token. Open the link the server printed.",
  Rejected: "This pairing link has been used or has expired. Restart the server for a new one.",
};

/** Where the server's pairing link lands: it signs this browser in once. */
function PairRouteView() {
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | undefined>();
  useEffect(() => {
    let cancelled = false;
    exchangePairingLink().then(
      (result) => {
        if (cancelled) return;
        if (result._tag === "Paired") void navigate({ to: "/", replace: true });
        else setProblem(messages[result._tag]);
      },
      (error: unknown) => {
        if (!cancelled) setProblem(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [navigate]);
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">{APP_DISPLAY_NAME}</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{problem ?? "Signing in…"}</p>
    </main>
  );
}

export const Route = createFileRoute("/pair")({ component: PairRouteView });
