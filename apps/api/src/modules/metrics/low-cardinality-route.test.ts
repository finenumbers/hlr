import { describe, expect, it } from 'vitest';

import { lowCardinalityRoute } from './metrics.service';

describe('lowCardinalityRoute', () => {
  it('collapses cuid/uuid/numeric segments', () => {
    expect(lowCardinalityRoute('/v1/checks/clxxxxxxxxxxxxxxxxxx')).toBe(
      '/v1/checks/:id',
    );
    expect(
      lowCardinalityRoute('/v1/jobs/550e8400-e29b-41d4-a716-446655440000/items'),
    ).toBe('/v1/jobs/:id/items');
    expect(lowCardinalityRoute('/v1/jobs/42')).toBe('/v1/jobs/:id');
  });
});
