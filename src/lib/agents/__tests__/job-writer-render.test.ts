import { describe, expect, it } from 'vitest';

import {
  renderJobAdMarkdown,
  withVivierRgpdMention,
} from '@/lib/agents/job-writer-render';
import type { JobAdResult } from '@/types/job-writer';

const AD: JobAdResult = {
  title: 'Comptable senior — Paris (CDI)',
  body: 'Nous recherchons un comptable.\n\n## Missions\n- Tenue de la compta',
  tags: ['Comptabilité', 'Paris'],
};

describe('withVivierRgpdMention', () => {
  it('appose la mention RGPD (conservation + suppression à [contact]) au corps', () => {
    const ad = withVivierRgpdMention(AD, 'rgpd@acme.com');
    expect(ad.body).toContain('vivier de candidatures');
    expect(ad.body).toContain('suppression à tout moment');
    expect(ad.body).toContain('rgpd@acme.com');
    // Le contenu original est préservé.
    expect(ad.body).toContain('## Missions');
  });

  it('la mention apparaît dans le markdown rendu', () => {
    const markdown = renderJobAdMarkdown(withVivierRgpdMention(AD, 'rgpd@acme.com'));
    expect(markdown).toContain('vivier de candidatures');
  });

  it('contact vide ⇒ repli générique (mention toujours présente)', () => {
    const ad = withVivierRgpdMention(AD, '');
    expect(ad.body).toContain('vivier de candidatures');
    expect(ad.body).toContain('notre service recrutement');
  });
});
