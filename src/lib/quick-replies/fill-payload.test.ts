import { describe, expect, it } from 'vitest';

import { mapPayloadText, payloadTexts } from './fill-payload';
import { fillNumbered, numberedVariables } from './placeholders';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';

const buttons: InteractiveMessagePayload = {
  kind: 'buttons',
  body: 'Hi {{1}}, this is {{2}}.',
  header_image_url: 'https://example.com/a.jpg',
  footer: 'From {{2}}',
  buttons: [
    { id: 'yes', title: "I'm interested" },
    { id: 'more', title: 'Send {{3}}' },
  ],
};

describe('mapPayloadText', () => {
  it('fills every text and keeps ids and the image', () => {
    const filled = mapPayloadText(buttons, (t) => fillNumbered(t, { 1: 'Ravi', 2: 'Mahesh', 3: 'details' }));
    expect(filled).toEqual({
      ...buttons,
      body: 'Hi Ravi, this is Mahesh.',
      footer: 'From Mahesh',
      header: undefined,
      buttons: [
        { id: 'yes', title: "I'm interested" },
        { id: 'more', title: 'Send details' },
      ],
    });
  });

  it('reaches list rows too', () => {
    const list: InteractiveMessagePayload = {
      kind: 'list',
      body: 'Pick a plan in {{1}}',
      button_label: 'Plans',
      sections: [{ title: '{{1}} plans', rows: [{ id: 'a', title: 'Basic', description: 'for {{1}}' }] }],
    };
    expect(numberedVariables(...payloadTexts(list))).toEqual([1]);
    const filled = mapPayloadText(list, (t) => fillNumbered(t, { 1: 'Vizag' }));
    expect(payloadTexts(filled).join(' | ')).toBe('Pick a plan in Vizag | Plans | Vizag plans | Basic | for Vizag');
  });

  it('collects the texts that carry fill-ins', () => {
    expect(numberedVariables(...payloadTexts(buttons))).toEqual([1, 2, 3]);
  });
});
