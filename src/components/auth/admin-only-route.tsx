"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { hasMinRole } from "@/lib/auth/roles";

/**
 * SVBTL fork: wraps an editor page (new broadcast, automation editor,
 * flow builder) that only admins may use. Anyone else is sent to the
 * read-only view at `fallback`; the server and database refuse their
 * writes anyway (migration 904), this just keeps them out of a form
 * they can't save.
 */
export function AdminOnlyRoute({
  fallback,
  children,
}: {
  fallback: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { profileLoading, accountRole } = useAuth();
  const allowed = !!accountRole && hasMinRole(accountRole, "admin");

  useEffect(() => {
    if (!profileLoading && !allowed) router.replace(fallback);
  }, [profileLoading, allowed, fallback, router]);

  if (!allowed) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return <>{children}</>;
}
