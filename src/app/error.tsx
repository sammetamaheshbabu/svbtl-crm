"use client";

import { ErrorFallback } from "@/components/layout/error-fallback";

// Catch-all boundary for everything the dashboard boundary doesn't
// cover — the auth pages, `/join`, and the dashboard layout itself if
// the shell is what throws. It sits under the root layout, so the
// theme and the next-intl provider are both still in place here.
//
// No "Back to dashboard" here: every path this boundary covers makes it
// a dead end. A signed-out visitor who hits it on /login is redirected
// back to /login, and if `DashboardShell` is what threw, /dashboard
// just remounts the thing that threw. "Try again" is the honest offer.

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <ErrorFallback error={error} reset={reset} showDashboardLink={false} />
    </div>
  );
}
