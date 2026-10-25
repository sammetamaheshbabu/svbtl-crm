import { describe, expect, it } from 'vitest'

import en from '../../../messages/en.json'
import es from '../../../messages/es.json'
import ko from '../../../messages/ko.json'
import pt from '../../../messages/pt.json'
import { deliveryErrorKey, type DeliveryErrorKey } from './delivery-error-help'

describe('deliveryErrorKey', () => {
  it('names the two errors agents hit most', () => {
    expect(deliveryErrorKey(131049)).toBe('marketingLimit')
    expect(deliveryErrorKey(131026)).toBe('undeliverable')
  })

  it('has nothing for unknown or missing codes', () => {
    expect(deliveryErrorKey(999999)).toBeNull()
    expect(deliveryErrorKey(null)).toBeNull()
    expect(deliveryErrorKey(undefined)).toBeNull()
  })

  it('has text for every key in every language', () => {
    const keys: DeliveryErrorKey[] = [
      'marketingLimit', 'undeliverable', 'windowClosed', 'marketingOptOut', 'metaExperiment',
      'spamLimit', 'pairLimit', 'unsupportedType', 'mediaUpload', 'payment', 'templateParams',
      'templateMissing', 'templatePaused', 'accountRestricted', 'temporary',
    ]
    for (const locale of [en, es, ko, pt] as unknown as Record<string, Record<string, Record<string, string>>>[]) {
      const help = locale.DeliveryErrors
      expect(typeof help.fixLabel).toBe('string')
      for (const key of keys) {
        expect(help[key]?.what, key).toBeTruthy()
        expect(help[key]?.fix, key).toBeTruthy()
      }
    }
  })
})
