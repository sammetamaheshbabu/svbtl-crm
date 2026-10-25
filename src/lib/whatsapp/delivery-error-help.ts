/**
 * SVBTL fork. Plain-language help for the error codes Meta reports when a
 * sent WhatsApp message fails (status webhook `errors[].code`, stored on
 * `messages.error_code`). Meta's own titles — "Message undeliverable",
 * "…healthy ecosystem engagement" — don't tell an agent what happened or
 * what to do next; the text for each key lives in `messages/*.json` under
 * `DeliveryErrors.<key>` (`what` + `fix`).
 *
 * Codes: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */

export type DeliveryErrorKey =
  | 'marketingLimit'
  | 'undeliverable'
  | 'windowClosed'
  | 'marketingOptOut'
  | 'metaExperiment'
  | 'spamLimit'
  | 'pairLimit'
  | 'unsupportedType'
  | 'mediaUpload'
  | 'payment'
  | 'templateParams'
  | 'templateMissing'
  | 'templatePaused'
  | 'accountRestricted'
  | 'temporary'

const BY_CODE: Record<number, DeliveryErrorKey> = {
  131049: 'marketingLimit',
  131026: 'undeliverable',
  131047: 'windowClosed',
  470: 'windowClosed',
  131050: 'marketingOptOut',
  130472: 'metaExperiment',
  131048: 'spamLimit',
  131056: 'pairLimit',
  131051: 'unsupportedType',
  131053: 'mediaUpload',
  131042: 'payment',
  132000: 'templateParams',
  132012: 'templateParams',
  132001: 'templateMissing',
  132015: 'templatePaused',
  132016: 'templatePaused',
  131031: 'accountRestricted',
  368: 'accountRestricted',
  1: 'temporary',
  2: 'temporary',
  131000: 'temporary',
  131016: 'temporary',
}

/** The help entry for a Meta delivery error code, or null when we have none. */
export function deliveryErrorKey(code: number | null | undefined): DeliveryErrorKey | null {
  if (code == null) return null
  return BY_CODE[code] ?? null
}
