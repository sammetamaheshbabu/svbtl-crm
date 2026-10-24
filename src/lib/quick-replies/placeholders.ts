// ============================================================
// Placeholders in quick replies.
//
// A saved reply may say "Hi {name}, ..." and the inbox fills in the
// customer's name when it's inserted. Supported: {name} (the contact's
// name) and {first_name} (its first word). Matching is case-insensitive.
//
// When the name is unknown (no name, or only the phone number, which is
// what a contact created from a number is named) the placeholder is
// dropped and the space around it tidied: "Hi {name}, thanks" → "Hi,
// thanks".
// ============================================================

export const QUICK_REPLY_PLACEHOLDERS = ['{name}', '{first_name}'] as const;

/** A usable name, or null for an empty one or a bare phone number. */
function usableName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed || /^\+?[\d\s().-]+$/.test(trimmed)) return null;
  return trimmed;
}

export function fillPlaceholders(
  text: string,
  contact: { name?: string | null } | null | undefined
): string {
  const name = usableName(contact?.name);
  const first = name?.split(/\s+/)[0] ?? null;

  let filled = text.replace(/\{(name|first_name)\}/gi, (_, key: string) => {
    const value = key.toLowerCase() === 'name' ? name : first;
    return value ?? '\u0000';
  });

  if (filled.includes('\u0000')) {
    filled = filled
      // "Hi {name}," / "Thanks, {name}!" → "Hi," / "Thanks!"
      .replace(/[ \t]*,?[ \t]*\u0000(?=[ \t]*[,.!?])/g, '')
      // "{name} - your quote" → "- your quote"
      .replace(/(^|\n)\u0000[ \t]*/g, '$1')
      .replace(/[ \t]*\u0000/g, '');
  }
  return filled;
}

// ------------------------------------------------------------
// Numbered fill-ins: {{1}}, {{2}}, ... — values the agent types when
// picking the reply (a city, a price, their own name). Same syntax as
// WhatsApp templates, so a template's text can be reused as is.
// ------------------------------------------------------------

const NUMBERED = /\{\{\s*(\d+)\s*\}\}/g;

/** The distinct variable numbers in `texts`, ascending. */
export function numberedVariables(...texts: (string | null | undefined)[]): number[] {
  const found = new Set<number>();
  for (const text of texts) {
    for (const m of (text ?? '').matchAll(NUMBERED)) found.add(Number(m[1]));
  }
  return [...found].sort((a, b) => a - b);
}

/** Replace {{n}} with `values[n]`; numbers without a value stay as they are. */
export function fillNumbered(text: string, values: Record<number, string>): string {
  return text.replace(NUMBERED, (whole, n: string) => {
    const value = values[Number(n)];
    return value !== undefined && value !== '' ? value : whole;
  });
}

/** True while any {{n}} is left in the text. */
export function hasUnfilledVariables(text: string): boolean {
  return numberedVariables(text).length > 0;
}
