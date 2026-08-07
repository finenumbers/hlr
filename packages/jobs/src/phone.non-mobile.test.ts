import { describe, expect, it } from 'vitest';

import { countNonMobilePhones } from './phone.js';

describe('countNonMobilePhones', () => {
  it('counts Novosibirsk geographic numbers as non-mobile', () => {
    expect(countNonMobilePhones(['+73832001034', '+73832001052'])).toBe(2);
  });

  it('does not count typical RU mobiles', () => {
    expect(countNonMobilePhones(['+79991234567', '+79161234567'])).toBe(0);
  });
});
