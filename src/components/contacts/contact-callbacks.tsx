"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { BellRing, Check, Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  createContactReminder,
  listContactReminders,
  updateContactReminder,
} from "@/lib/contacts/reminder-api";
import {
  exactReminderInstant,
  reminderPresets,
  type ReminderPresetId,
} from "@/lib/contacts/reminder-presets";
import { browserTimeZone } from "@/lib/time/zoned";
import { cn } from "@/lib/utils";
import type { ContactReminder } from "@/types";

/**
 * The callbacks a customer is owed, plus the form to add one.
 *
 * Shared deliberately: the chat-side panel and the Contacts detail sheet
 * both render this. Those two surfaces duplicate notes, tags and profile
 * editing between them, which is why a fix to one keeps missing the
 * other — this feature does not repeat that.
 */

const PRESET_LABEL: Record<ReminderPresetId, string> = {
  this_evening: "presetThisEvening",
  tomorrow_morning: "presetTomorrowMorning",
  in_three_days: "presetInThreeDays",
  next_week: "presetNextWeek",
};

/** Only these are still waiting on the agent; done/cancelled are history. */
const OPEN_STATUSES = new Set(["pending", "notified"]);

interface ContactCallbacksProps {
  contactId: string;
  /** Lets the notification deep-link into the chat it came from. */
  conversationId?: string | null;
  /** Agents and above may set a callback; viewers may only read. */
  canEdit: boolean;
}

export function ContactCallbacks({
  contactId,
  conversationId,
  canEdit,
}: ContactCallbacksProps) {
  const t = useTranslations("Callbacks");

  const [reminders, setReminders] = useState<ContactReminder[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [reason, setReason] = useState("");
  const [exactDate, setExactDate] = useState("");
  const [exactTime, setExactTime] = useState("");

  // Read once per mount: a telecaller's machine does not change zone
  // mid-call, and re-reading per render would churn the presets.
  const timeZone = useMemo(() => browserTimeZone(), []);
  const presets = useMemo(
    () => reminderPresets(new Date(), timeZone),
    // `adding` re-derives them when the form opens, so "this evening"
    // disappears once 5:30 has gone by rather than going stale on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timeZone, adding],
  );

  const load = useCallback(async () => {
    try {
      const { reminders: rows } = await listContactReminders(contactId);
      setReminders(rows);
    } catch {
      setReminders([]);
      toast.error(t("loadFailed"));
    }
  }, [contactId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (reminders ?? []).filter((r) => OPEN_STATUSES.has(r.status));

  const resetForm = () => {
    setReason("");
    setExactDate("");
    setExactTime("");
    setAdding(false);
  };

  const save = async (at: Date) => {
    setSaving(true);
    try {
      await createContactReminder(contactId, {
        reason,
        remindAt: at,
        remindAtTz: timeZone,
        conversationId,
      });
      resetForm();
      await load();
      toast.success(t("saved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const markDone = async (id: string) => {
    setBusyId(id);
    try {
      await updateContactReminder(id, { status: "done" });
      await load();
      toast.success(t("doneSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("doneFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const exactAt = exactReminderInstant(exactDate, exactTime, timeZone);
  const reasonReady = reason.trim().length > 0;

  return (
    <div>
      <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <BellRing className="h-3 w-3" />
        <span className="flex-1">{t("heading")}</span>
        {canEdit && (
          <Popover
            open={adding}
            onOpenChange={(next) => (next ? setAdding(true) : resetForm())}
          >
            <PopoverTrigger
              aria-label={t("add")}
              title={t("add")}
              className="flex h-6 w-6 items-center justify-center rounded-md normal-case text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-3 p-3">
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {t("reasonLabel")}
                </span>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("reasonPlaceholder")}
                  className="h-9 border-border bg-muted text-base sm:text-sm"
                />
              </div>

              <div className="space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {t("whenLabel")}
                </span>
                <div className="flex flex-wrap gap-1">
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={!reasonReady || saving}
                      onClick={() => void save(preset.at)}
                      className="rounded-md border border-border px-2 py-1 text-xs text-popover-foreground hover:bg-muted disabled:opacity-50"
                    >
                      {t(PRESET_LABEL[preset.id])}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1 border-t border-border pt-2">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {t("orExact")}
                </span>
                <div className="flex gap-1">
                  <Input
                    type="date"
                    value={exactDate}
                    onChange={(e) => setExactDate(e.target.value)}
                    className="h-9 border-border bg-muted text-base sm:text-xs"
                  />
                  <Input
                    type="time"
                    value={exactTime}
                    onChange={(e) => setExactTime(e.target.value)}
                    className="h-9 w-24 border-border bg-muted text-base sm:text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={resetForm}>
                  {t("cancel")}
                </Button>
                <Button
                  size="sm"
                  disabled={!reasonReady || !exactAt || saving}
                  onClick={() => exactAt && void save(exactAt)}
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    t("save")
                  )}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      <div className="mt-2 space-y-2">
        {reminders === null ? (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : open.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t("none")}</p>
        ) : (
          open.map((reminder) => {
            const at = new Date(reminder.remind_at);
            const overdue = at.getTime() <= Date.now();
            return (
              <div
                key={reminder.id}
                className="rounded-lg bg-muted px-3 py-2 text-sm"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-foreground">
                      {reminder.reason}
                    </p>
                    <p
                      className={cn(
                        "mt-0.5 text-xs",
                        overdue ? "text-red-400" : "text-muted-foreground",
                      )}
                    >
                      {overdue && `${t("overdue")} · `}
                      {t("dueAt", {
                        time: format(at, "MMM d, yyyy HH:mm"),
                      })}
                    </p>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={t("done")}
                      title={t("done")}
                      disabled={busyId === reminder.id}
                      onClick={() => void markDone(reminder.id)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
                    >
                      {busyId === reminder.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
