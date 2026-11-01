"use client";

import { ErrorFallback } from "@/components/layout/error-fallback";

// Error boundary for every page under the dashboard shell. Being a
// sibling of `(dashboard)/layout.tsx` it renders *inside* the shell, so
// a page that throws loses the page area only — the sidebar, header and
// nav stay usable and the user can walk to another screen.
//
// These pages are "use client" and query Supabase directly, so a throw
// in a hook or a render is a real possibility; without this the whole
// document went blank.

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} />;
}
