"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface QuickReplyFillDialogProps {
  /** The quick reply's title, shown in the heading. */
  title: string;
  /** Variable numbers to ask for, e.g. [1, 2, 3, 4]. */
  numbers: number[];
  /** Starting values (e.g. the contact's name for {{1}}). */
  initial?: Record<number, string>;
  /** The message as it will read with the current values. */
  preview: (values: Record<number, string>) => string;
  onConfirm: (values: Record<number, string>) => void;
  onCancel: () => void;
}

/**
 * Asks for a quick reply's {{1}}, {{2}}, … values before it goes into the
 * composer. Every value is required, so nothing is sent with a bare {{n}}.
 */
export function QuickReplyFillDialog({
  title,
  numbers,
  initial,
  preview,
  onConfirm,
  onCancel,
}: QuickReplyFillDialogProps) {
  const t = useTranslations("Inbox.composer");
  const [values, setValues] = useState<Record<number, string>>(() => ({ ...initial }));
  const complete = numbers.every((n) => (values[n] ?? "").trim() !== "");

  const trimmed = () =>
    Object.fromEntries(numbers.map((n) => [n, (values[n] ?? "").trim()])) as Record<number, string>;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("fillVariablesDesc")}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (complete) onConfirm(trimmed());
          }}
        >
          {numbers.map((n, i) => (
            <label key={n} className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{`{{${n}}}`}</span>
              <Input
                autoFocus={i === 0}
                value={values[n] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [n]: e.target.value }))}
                className="border-border bg-muted text-base text-foreground sm:text-sm"
              />
            </label>
          ))}

          <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background/50 p-3">
            <p className="mb-1 text-[11px] text-muted-foreground">{t("fillVariablesPreview")}</p>
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{preview(values)}</p>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("fillVariablesCancel")}
            </Button>
            <Button
              type="submit"
              disabled={!complete}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {t("fillVariablesUse")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
