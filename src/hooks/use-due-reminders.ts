"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Notification } from "@/types";

/**
 * How many callbacks the current agent owes right now — overdue, or due
 * before the day is out. Drives the badge on the Callbacks nav entry.
 *
 * RLS on `contact_reminders` already scopes reads (an agent sees their
 * own, an admin everyone's), so no explicit filter is needed — same
 * reasoning as `useUnreadNotifications`.
 *
 * `contact_reminders` is deliberately not on the realtime publication:
 * the one moment the count changes on its own is when a reminder falls
 * due, and that always writes a `reminder_due` notification, which IS
 * published. So we listen there and re-count. Writes from this tab
 * refresh through `refresh()` instead.
 */
export function useDueReminders(): { count: number; refresh: () => void } {
  const [count, setCount] = useState(0);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const recount = async () => {
      // End of today in the viewer's own zone: a callback promised for
      // "this evening" should be in the badge all day, not only once it
      // has already slipped.
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);

      const { count: due, error } = await supabase
        .from("contact_reminders")
        .select("*", { count: "exact", head: true })
        .in("status", ["pending", "notified"])
        .lte("remind_at", endOfToday.toISOString());

      if (cancelled || error) return;
      setCount(due ?? 0);
    };

    void recount();

    const channel = supabase
      .channel("due-reminders-count")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const row = payload.new as Notification;
          if (row.type === "reminder_due") void recount();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [tick]);

  return { count, refresh };
}
