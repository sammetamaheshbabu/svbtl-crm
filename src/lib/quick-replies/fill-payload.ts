// ============================================================
// Apply a text change to every visible text of an interactive message
// (body, header, footer, button labels, list labels and rows), so a
// quick reply's {name} and {{n}} fill-ins work in all of them.
// ============================================================

import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';

type Change = (text: string) => string;

const opt = (text: string | undefined, change: Change) =>
  text === undefined ? undefined : change(text);

export function mapPayloadText(
  payload: InteractiveMessagePayload,
  change: Change
): InteractiveMessagePayload {
  const shared = {
    body: change(payload.body),
    header: opt(payload.header, change),
    footer: opt(payload.footer, change),
  };
  if (payload.kind === 'buttons') {
    return {
      ...payload,
      ...shared,
      buttons: payload.buttons.map((b) => ({ ...b, title: change(b.title) })),
    };
  }
  return {
    ...payload,
    ...shared,
    button_label: change(payload.button_label),
    sections: payload.sections.map((s) => ({
      ...s,
      title: opt(s.title, change),
      rows: s.rows.map((r) => ({
        ...r,
        title: change(r.title),
        description: opt(r.description, change),
      })),
    })),
  };
}

/** Every visible text of the message, for finding fill-ins. */
export function payloadTexts(payload: InteractiveMessagePayload): string[] {
  const texts: string[] = [];
  mapPayloadText(payload, (text) => (texts.push(text), text));
  return texts;
}
