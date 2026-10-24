import { describe, expect, it } from 'vitest';

import { fillNumbered, fillPlaceholders, hasUnfilledVariables, numberedVariables } from './placeholders';

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

describe('numbered variables', () => {
  it('lists each number once, in order', () => {
    expect(numberedVariables('Hi {{1}}, from {{2}} in {{3}}. {{1}}!', 'Rs. {{4}}')).toEqual([1, 2, 3, 4]);
    expect(numberedVariables('no variables', null)).toEqual([]);
  });

  it('fills the given numbers and leaves the rest', () => {
    expect(fillNumbered('Hi {{1}}, I am {{2}}.', { 1: 'Ravi', 2: '' })).toBe('Hi Ravi, I am {{2}}.');
    expect(fillNumbered('{{ 1 }} and {{1}}', { 1: 'x' })).toBe('x and x');
  });

  it('fills Telugu text the same way', () => {
    expect(fillNumbered('నమస్కారం {{1}} గారు', { 1: 'రవి' })).toBe('నమస్కారం రవి గారు');
  });

  it('spots leftover variables', () => {
    expect(hasUnfilledVariables('Rs. {{4}}')).toBe(true);
    expect(hasUnfilledVariables('Rs. 15,000')).toBe(false);
  });
});
