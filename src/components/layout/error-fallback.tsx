"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { LayoutDashboard, RotateCcw, TriangleAlert } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";

// What an `error.tsx` boundary renders. Shared by the root boundary and
// the dashboard one so the two cannot drift apart.
//
// The error itself is never shown: in production Next replaces a server
// error's message with a generic string anyway, and a client-side stack
// means nothing to a telecaller. It goes to the console instead, where
// it is reachable over USB debugging or a support call, and the `digest`
// Next attaches to server errors is surfaced as a reference the user can
// read out — it's an opaque hash, not error text.

export function ErrorFallback({
  error,
  reset,
  showDashboardLink = true,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  // Off for the root boundary, where the link is a dead end: an
  // unauthenticated visitor is bounced straight back to /login, and if
  // the shell itself is what threw, /dashboard only remounts it.
  showDashboardLink?: boolean;
}) {
  const t = useTranslations("ErrorBoundary");

  useEffect(() => {
    console.error("[error-boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-4 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
        <TriangleAlert className="h-6 w-6 text-destructive" aria-hidden />
      </div>
      <h1 className="mt-4 text-lg font-semibold text-foreground">
        {t("title")}
      </h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {t("description")}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw className="size-4" aria-hidden />
          {t("tryAgain")}
        </Button>
        {/* Anchor styled with `buttonVariants` rather than a <Button>:
            the wacrm Button is the Base UI primitive and has no
            Radix-style asChild slot (same reasoning as the invite
            dialog's share link). */}
        {showDashboardLink && (
          <Link
            href="/dashboard"
            className={buttonVariants({ variant: "outline" })}
          >
            <LayoutDashboard className="size-4" aria-hidden />
            {t("backToDashboard")}
          </Link>
        )}
      </div>
      {error.digest && (
        <p className="mt-4 text-[11px] text-muted-foreground/70">
          {t("reference", { digest: error.digest })}
        </p>
      )}
    </div>
  );
}
