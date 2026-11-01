"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
// Aliased: `Notification` is also the DOM constructor used below.
import type { Message, Notification as NotificationRow } from "@/types";
import {
  DEFAULT_NOTIFICATION_LABELS,
  buildNotificationContent,
  conversationHref,
  getNotificationPermission,
  pickContactDisplayName,
  readBrowserNotifyPref,
  shouldNotifyForMessage,
  subscribeBrowserNotifyPref,
  viewedConversationFromLocation,
  type NotificationLabels,
} from "@/lib/notifications/browser-notify";

const serverSnapshot = () => false;

/**
 * The device-scoped "browser notifications" opt-in, kept in sync with
 * localStorage across this tab (settings toggle) and other tabs.
 */
export function useBrowserNotifyPref(): boolean {
  return useSyncExternalStore(
    subscribeBrowserNotifyPref,
    readBrowserNotifyPref,
    serverSnapshot,
  );
}

/**
 * Desktop notifications for new inbound customer messages. Mount ONCE
 * per signed-in dashboard tab (the dashboard shell does this via
 * <BrowserNotificationsListener />) so alerts fire on any page.
 *
 * Listens for realtime INSERTs on `messages` — RLS scopes the stream to
 * the caller's account, same as useTotalUnread / useRealtime. Only
 * live events are considered: there is no initial fetch, so an existing
 * backlog never produces a burst of alerts on page load.
 *
 * Own channel name so it coexists with the inbox page's subscription
 * and the sidebar's unread counters.
 *
 * Fires only while a dashboard tab is open — there is no service worker
 * or Web Push here, so a closed browser stays quiet.
 */
export function useBrowserNotifications(): void {
  const enabled = useBrowserNotifyPref();
  const router = useRouter();
  const t = useTranslations("Settings.browserNotifications.labels");

  // Translated labels, read inside the async Realtime callback. Kept in
  // a ref (assigned in an effect, not during render) so a locale change
  // doesn't tear down and re-open the channel.
  const labelsRef = useRef<NotificationLabels>(DEFAULT_NOTIFICATION_LABELS);
  useEffect(() => {
    labelsRef.current = {
      fallbackTitle: t("fallbackTitle"),
      image: t("image"),
      audio: t("audio"),
      video: t("video"),
      document: t("document"),
      location: t("location"),
      template: t("template"),
    };
  });

  // Message ids already handled, for replay dedupe. Survives re-renders,
  // pruned by shouldNotifyForMessage.
  const seenRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!enabled) return;
    if (getNotificationPermission() === "unsupported") return;

    const supabase = createClient();
    let cancelled = false;

    const notify = async (msg: Message) => {
      // One small select to put the contact's name in the title. A
      // failure here just means the generic fallback title.
      const { data } = await supabase
        .from("conversations")
        .select("contact:contacts(name, wa_username, phone)")
        .eq("id", msg.conversation_id)
        .maybeSingle();
      if (cancelled) return;

      const contact = (data as {
        contact?: { name?: string | null; wa_username?: string | null; phone?: string | null } | null;
      } | null)?.contact;
      const { title, body } = buildNotificationContent(
        msg,
        pickContactDisplayName(contact),
        labelsRef.current,
      );

      try {
        const notification = new Notification(title, {
          body,
          // One alert per conversation: a second message from the same
          // customer replaces the first instead of stacking.
          tag: msg.conversation_id,
          icon: "/icon",
        });
        notification.onclick = () => {
          window.focus();
          router.push(conversationHref(msg.conversation_id));
          notification.close();
        };
      } catch (err) {
        // Some browsers throw from the constructor (e.g. Android Chrome
        // requires a service worker). Non-fatal.
        console.error("[useBrowserNotifications] failed to show:", err);
      }
    };

    const channel = supabase
      .channel("browser-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          // Re-check every time: the user can revoke permission in the
          // browser without the preference flipping.
          if (getNotificationPermission() !== "granted") return;
          const msg = payload.new as Message;
          const shouldNotify = shouldNotifyForMessage(msg, {
            documentVisible: document.visibilityState === "visible",
            viewingConversationId: viewedConversationFromLocation(
              window.location.pathname,
              window.location.search,
            ),
            seen: seenRef.current,
          });
          if (!shouldNotify) return;
          void notify(msg);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [enabled, router]);
}

/**
 * Desktop notifications for callback reminders that have come due.
 *
 * Separate from the message listener above because the trigger is a
 * different table: a reminder becomes due in the database (the pg_cron
 * job in migration 906 writes the `notifications` row), not in response
 * to anything happening in this tab. Watching `notifications` rather
 * than `contact_reminders` means the alert and the in-app bell always
 * agree, and keeps `contact_reminders` off the realtime publication.
 *
 * Title and body are already translated and stored on the row, so
 * nothing is composed here.
 *
 * Same two gates as above — the device opt-in, re-checked permission —
 * and the same limitation: a closed browser stays quiet.
 */
export function useReminderBrowserNotifications(): void {
  const enabled = useBrowserNotifyPref();
  const router = useRouter();

  // Ids already alerted on, so a realtime replay after a reconnect does
  // not alert twice. Bounded: reminders are low-volume by nature.
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    if (getNotificationPermission() === "unsupported") return;

    const supabase = createClient();

    const channel = supabase
      .channel("reminder-browser-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          if (getNotificationPermission() !== "granted") return;

          const row = payload.new as NotificationRow;
          if (row.type !== "reminder_due") return;
          if (seenRef.current.has(row.id)) return;
          seenRef.current.add(row.id);

          try {
            const notification = new Notification(row.title, {
              body: row.body ?? undefined,
              // One alert per reminder.
              tag: row.id,
              icon: "/icon",
            });
            notification.onclick = () => {
              window.focus();
              // Straight to the chat when the reminder came from one,
              // otherwise to the list of what is owed.
              router.push(
                row.conversation_id
                  ? conversationHref(row.conversation_id)
                  : "/follow-ups",
              );
              notification.close();
            };
          } catch (err) {
            console.error(
              "[useReminderBrowserNotifications] failed to show:",
              err,
            );
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, router]);
}
