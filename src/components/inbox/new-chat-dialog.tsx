"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { format } from "date-fns";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { findExistingContact, type ExistingContact } from "@/lib/contacts/dedupe";
import { parseInternationalPhone } from "@/lib/whatsapp/phone-utils";
import { renderTemplateBody } from "@/lib/whatsapp/template-body";
import type { MessageTemplate } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TemplatePicker, type TemplateSendValues } from "./template-picker";

// Most of our customers are in India; the rest are mostly in the Gulf.
// "Other" takes the whole number with its + and country code.
const COUNTRY_CODES = [
  { code: "+91", label: "India" },
  { code: "+971", label: "UAE" },
  { code: "+966", label: "Saudi Arabia" },
  { code: "+974", label: "Qatar" },
  { code: "+968", label: "Oman" },
  { code: "+965", label: "Kuwait" },
  { code: "+973", label: "Bahrain" },
  { code: "+1", label: "USA / Canada" },
  { code: "+44", label: "UK" },
  { code: "+65", label: "Singapore" },
  { code: "+60", label: "Malaysia" },
  { code: "+61", label: "Australia" },
] as const;
const OTHER = "other";

/** The typed number with its country code, as the send route takes it. */
function fullNumber(code: string, number: string): string {
  const typed = number.trim();
  if (code === OTHER) return typed;
  // Pasted with its own +code, or typed with the trunk 0 Indians often add.
  if (typed.startsWith("+")) return typed;
  return `${code}${typed.replace(/^0+/, "")}`;
}

interface NewChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The chat the template went to, so the inbox can open it. */
  onStarted: (conversationId: string) => void;
}

export function NewChatDialog({ open, onOpenChange, onStarted }: NewChatDialogProps) {
  const t = useTranslations("Inbox.newChat");
  const { accountId } = useAuth();

  const [code, setCode] = useState<string>("+91");
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [existing, setExisting] = useState<ExistingContact | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  // Set before the picker closes itself, so closing doesn't reopen the form.
  const sendingRef = useRef(false);

  const phone = parseInternationalPhone(fullNumber(code, number));
  const optedInAt =
    typeof existing?.whatsapp_opt_in_at === "string" ? existing.whatsapp_opt_in_at : null;

  // Show who the number belongs to, and whether they already opted in.
  useEffect(() => {
    if (!phone || !accountId) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const match = await findExistingContact(createClient(), accountId, phone);
      if (!cancelled) setExisting(match);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setExisting(null);
    };
  }, [phone, accountId]);

  function reset() {
    setCode("+91");
    setNumber("");
    setName("");
    setOptIn(false);
    setExisting(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next && !pickerOpen) reset();
    onOpenChange(next);
  }

  function chooseTemplate() {
    onOpenChange(false);
    setPickerOpen(true);
  }

  function handlePickerOpenChange(next: boolean) {
    setPickerOpen(next);
    // Cancelled the picker: back to the number, as typed.
    if (!next && !sendingRef.current) onOpenChange(true);
  }

  async function send(template: MessageTemplate, values: TemplateSendValues) {
    if (!phone) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: `+${phone}`,
          name: name.trim() || undefined,
          opt_in_confirmed: optIn || !!optedInAt,
          message_type: "template",
          template_name: template.name,
          template_language: template.language,
          template_message_params: {
            body: values.body,
            headerText: values.headerText,
            buttonParams: values.buttonParams,
            headerMediaUrl: values.headerMediaUrl,
          },
          template_params: values.body,
          content_text: renderTemplateBody(template.body_text, values.body),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(t("failed", { reason: payload?.error || `HTTP ${res.status}` }));
        onOpenChange(true);
        return;
      }
      toast.success(t("sent"));
      reset();
      if (payload.conversation_id) onStarted(payload.conversation_id);
    } catch (err) {
      console.error("Failed to start chat:", err);
      toast.error(t("failed", { reason: String(err) }));
      onOpenChange(true);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  const canContinue = !!phone && (optIn || !!optedInAt) && !sending;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <MessageSquarePlus className="h-4 w-4 text-primary" />
              {t("title")}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t("description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs text-popover-foreground">{t("numberLabel")}</Label>
              <div className="flex gap-2">
                <Select value={code} onValueChange={(v) => v && setCode(v)}>
                  <SelectTrigger className="w-28 flex-shrink-0" aria-label={t("countryLabel")}>
                    <SelectValue>
                      {(value: string) => (value === OTHER ? t("otherCountry") : value)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRY_CODES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code} {c.label}
                      </SelectItem>
                    ))}
                    <SelectItem value={OTHER}>{t("otherCountry")}</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="tel"
                  inputMode="tel"
                  autoFocus
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder={code === OTHER ? "+44 7700 900123" : "98765 43210"}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {number.trim() && !phone
                  ? t("numberInvalid")
                  : existing
                    ? t("existingContact", { name: existing.name || `+${phone}` })
                    : t("numberHint")}
              </p>
            </div>

            {!existing && (
              <div className="space-y-1">
                <Label className="text-xs text-popover-foreground">{t("nameLabel")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("namePlaceholder")}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
              </div>
            )}

            {optedInAt ? (
              <p className="rounded-md border border-border bg-background/50 p-3 text-xs text-muted-foreground">
                {t("alreadyOptedIn", { date: format(new Date(optedInAt), "d MMM yyyy") })}
              </p>
            ) : (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-background/50 p-3">
                <Checkbox
                  checked={optIn}
                  onCheckedChange={(checked) => setOptIn(checked === true)}
                  className="mt-0.5"
                />
                <span className="text-xs text-popover-foreground">{t("optInLabel")}</span>
              </label>
            )}

            <p className="text-[11px] text-muted-foreground">{t("templateOnlyNote")}</p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="border-border text-popover-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              disabled={!canContinue}
              onClick={chooseTemplate}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {sending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("chooseTemplate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TemplatePicker
        open={pickerOpen}
        onOpenChange={handlePickerOpenChange}
        onSelect={send}
      />
    </>
  );
}
