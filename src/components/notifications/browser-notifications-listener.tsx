"use client";

import {
  useBrowserNotifications,
  useReminderBrowserNotifications,
} from "@/hooks/use-browser-notifications";

/**
 * Headless. Mount ONCE per signed-in dashboard tab (the dashboard
 * shell, below the auth gate) so desktop notifications fire on every
 * dashboard page, not just the inbox.
 *
 * Two listeners, two sources: new customer messages, and callback
 * reminders that have come due.
 */
export function BrowserNotificationsListener() {
  useBrowserNotifications();
  useReminderBrowserNotifications();
  return null;
}
