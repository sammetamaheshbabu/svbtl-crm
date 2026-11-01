"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Compass, LayoutDashboard } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { StatusScreen } from "@/components/layout/status-screen";

// The 404 for every URL that matches no route. Next renders it under
// the root layout, so there is no shell around it — hence the full-page
// wrapper, as in `src/app/error.tsx`.
//
// Unlike the root error boundary, "Back to dashboard" belongs here: the
// app is working, this address simply isn't part of it, so the link is
// a real way out rather than a loop. Middleware sends a signed-out
// visitor on to /login from there, which is also the right answer.
//
// A client component because the strings come from `useTranslations`.
// There is nothing here that needs the server, and a `notFound()` call
// from a client page lands on this same file either way.

export default function NotFound() {
  const t = useTranslations("NotFound");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <StatusScreen
        icon={Compass}
        title={t("title")}
        description={t("description")}
      >
        <Link
          href="/dashboard"
          className={buttonVariants({ variant: "outline" })}
        >
          <LayoutDashboard className="size-4" aria-hidden />
          {t("backToDashboard")}
        </Link>
      </StatusScreen>
    </div>
  );
}
