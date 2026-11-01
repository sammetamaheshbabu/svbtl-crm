"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { BellRing, Check, Loader2, MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { updateContactReminder } from "@/lib/contacts/reminder-api";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { ContactReminderWithContact } from "@/types";

/**
 * Everything this agent owes a callback on, worst first.
 *
 * A reminder on a customer's profile is only seen by someone who already
 * opened that chat — which is exactly the customer you are about to
 * forget. This is the page an agent starts the day on.
 */

/** Still waiting on the agent. Done and cancelled are history. */
const OPEN_STATUSES = ["pending", "notified"];

type Group = "overdue" | "today" | "upcoming";

function groupFor(remindAt: string, now: Date, endOfToday: Date): Group {
  const at = new Date(remindAt).getTime();
  if (at <= now.getTime()) return "overdue";
  if (at <= endOfToday.getTime()) return "today";
  return "upcoming";
}

export default function FollowUpsPage() {
  const t = useTranslations("Callbacks");
  const router = useRouter();
  const { accountId } = useAuth();

  const [reminders, setReminders] = useState<
    ContactReminderWithContact[] | null
  >(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    // RLS decides whose reminders come back: an agent's own, or every
    // one of them for an admin.
    const { data, error } = await supabase
      .from("contact_reminders")
      .select("*, contact:contacts(id, name, phone)")
      .eq("account_id", accountId)
      .in("status", OPEN_STATUSES)
      .order("remind_at", { ascending: true })
      .limit(200);

    if (error) {
      setReminders([]);
      toast.error(t("loadFailed"));
      return;
    }
    setReminders((data ?? []) as ContactReminderWithContact[]);
  }, [accountId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const markDone = async (id: string) => {
    setBusyId(id);
    try {
      await updateContactReminder(id, { status: "done" });
      setReminders((prev) => prev?.filter((r) => r.id !== id) ?? prev);
      toast.success(t("doneSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("doneFailed"));
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const now = new Date();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const groups: Record<Group, ContactReminderWithContact[]> = {
    overdue: [],
    today: [],
    upcoming: [],
  };
  for (const reminder of reminders ?? []) {
    groups[groupFor(reminder.remind_at, now, endOfToday)].push(reminder);
  }

  const GROUP_LABEL: Record<Group, string> = {
    overdue: t("groupOverdue"),
    today: t("groupToday"),
    upcoming: t("groupUpcoming"),
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">
          {t("pageTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("pageSubtitle")}
        </p>
      </div>

      {reminders === null ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : reminders.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-6 py-16 text-center">
          <BellRing className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            {t("pageEmpty")}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {(["overdue", "today", "upcoming"] as Group[]).map((group) =>
            groups[group].length === 0 ? null : (
              <section key={group}>
                <h2
                  className={cn(
                    "px-1 text-xs font-medium uppercase tracking-wider",
                    group === "overdue"
                      ? "text-red-400"
                      : "text-muted-foreground",
                  )}
                >
                  {GROUP_LABEL[group]} · {groups[group].length}
                </h2>
                <div className="mt-2 space-y-2">
                  {groups[group].map((reminder) => (
                    <div
                      key={reminder.id}
                      className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm text-foreground">
                          {reminder.reason}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("withContact", {
                            contact:
                              reminder.contact?.name ||
                              reminder.contact?.phone ||
                              "—",
                          })}
                          {" · "}
                          <span
                            className={cn(
                              group === "overdue" && "text-red-400",
                            )}
                          >
                            {t("dueAt", {
                              time: format(
                                new Date(reminder.remind_at),
                                "MMM d, yyyy HH:mm",
                              ),
                            })}
                          </span>
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {reminder.conversation_id && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("openChat")}
                            title={t("openChat")}
                            onClick={() =>
                              router.push(
                                `/inbox?c=${reminder.conversation_id}`,
                              )
                            }
                          >
                            <MessageSquare className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("done")}
                          title={t("done")}
                          disabled={busyId === reminder.id}
                          onClick={() => void markDone(reminder.id)}
                        >
                          {busyId === reminder.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ),
          )}
        </div>
      )}
    </div>
  );
}
