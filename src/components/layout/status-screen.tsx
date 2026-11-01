"use client";

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// The centred icon / title / description / actions block that a
// whole-page dead stop renders: the error boundaries and the 404 page.
// Shared so those cannot drift apart, the way the callbacks panel is
// shared between the chat side panel and the contacts sheet.
//
// `tone` is only the icon's colour. A crash is destructive; a mistyped
// URL is not an error and gets the muted treatment, so the two don't
// shout equally loudly at someone who merely followed a stale link.

export function StatusScreen({
  icon: Icon,
  tone = "muted",
  title,
  description,
  reference,
  children,
}: {
  icon: LucideIcon;
  tone?: "muted" | "destructive";
  title: string;
  description: string;
  // Read out on a support call; only the error boundaries pass one.
  reference?: string;
  // The actions row — buttons and links, laid out by the caller.
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-4 py-10 text-center">
      <div
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-xl",
          tone === "destructive" ? "bg-destructive/10" : "bg-primary/10",
        )}
      >
        <Icon
          className={cn(
            "h-6 w-6",
            tone === "destructive" ? "text-destructive" : "text-primary",
          )}
          aria-hidden
        />
      </div>
      <h1 className="mt-4 text-lg font-semibold text-foreground">{title}</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {description}
      </p>
      {children && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {children}
        </div>
      )}
      {reference && (
        <p className="mt-4 text-[11px] text-muted-foreground/70">{reference}</p>
      )}
    </div>
  );
}
