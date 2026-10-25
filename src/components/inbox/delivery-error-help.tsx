"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { deliveryErrorKey } from "@/lib/whatsapp/delivery-error-help";

/**
 * What a failed send's Meta error code means and what to do about it —
 * under the red reason in the dashboard's Failed messages list and under
 * a failed bubble in the chat. Renders nothing for codes we have no help
 * for, so Meta's own wording stays the only text there.
 */
export function DeliveryErrorHelp({
  code,
  className,
}: {
  code: number | null | undefined;
  className?: string;
}) {
  const t = useTranslations("DeliveryErrors");
  const key = deliveryErrorKey(code);
  if (!key) return null;
  return (
    <div className={cn("space-y-0.5 text-xs leading-snug", className)}>
      <p className="text-foreground/80">{t(`${key}.what`)}</p>
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground/80">{t("fixLabel")}:</span> {t(`${key}.fix`)}
      </p>
    </div>
  );
}
