import { describe, expect, it } from 'vitest';

import { fillPlaceholders } from './placeholders';

describe('fillPlaceholders', () => {
  it('fills {name} and {first_name}', () => {
    expect(fillPlaceholders('Hi {name}!', { name: 'Ravi Kumar' })).toBe('Hi Ravi Kumar!');
    expect(fillPlaceholders('Hi {first_name}, thanks', { name: 'Ravi Kumar' })).toBe(
      'Hi Ravi, thanks'
    );
  });

  it('ignores case in the placeholder', () => {
    expect(fillPlaceholders('Hi {Name}', { name: 'Ravi' })).toBe('Hi Ravi');
  });

  it('leaves text without placeholders alone', () => {
    expect(fillPlaceholders('Thanks for waiting.', { name: 'Ravi' })).toBe('Thanks for waiting.');
  });

  it('drops the placeholder tidily when the name is unknown', () => {
    expect(fillPlaceholders('Hi {name}, thank you!', null)).toBe('Hi, thank you!');
    expect(fillPlaceholders('Thanks, {name}. Pricing depends', { name: '' })).toBe(
      'Thanks. Pricing depends'
    );
    expect(fillPlaceholders('Thank you for contacting us, {name}!', {})).toBe(
      'Thank you for contacting us!'
    );
    expect(fillPlaceholders('{name} - your quote is ready', null)).toBe('- your quote is ready');
  });

  it('treats a phone number as no name', () => {
    expect(fillPlaceholders('Hi {name}, welcome', { name: '919876543210' })).toBe('Hi, welcome');
    expect(fillPlaceholders('Hi {name}', { name: '+91 98765 43210' })).toBe('Hi');
  });
});
