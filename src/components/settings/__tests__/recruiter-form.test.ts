import { describe, expect, it } from 'vitest';

import { displayNameFromEmail } from '@/components/settings/RecruiterForm';

describe('displayNameFromEmail', () => {
  it('capitalise les segments du local-part', () => {
    expect(displayNameFromEmail('jane.doe@corp.fr')).toBe('Jane Doe');
    expect(displayNameFromEmail('marc-antoine_du@x.io')).toBe('Marc Antoine Du');
    expect(displayNameFromEmail('admin@x.io')).toBe('Admin');
  });
});
