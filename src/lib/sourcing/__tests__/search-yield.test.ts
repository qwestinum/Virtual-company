import { describe, expect, it } from 'vitest';

import { ExaResultSchema } from '@/lib/sourcing/exa-schema';
import {
  describeSearchYield,
  isAnomalousYield,
  malformedFieldLabels,
  yieldFromRunPayload,
} from '@/lib/sourcing/search-yield';

describe('bilan d’une recherche (25/09/2026)', () => {
  it('l’incident du 24/09 (89 illisibles sur 99) est anormal ; le régime normal (0-3 %) ne l’est pas', () => {
    expect(isAnomalousYield({ returned: 99, unusable: 89, hidden: 0, kept: 10 })).toBe(true);
    expect(isAnomalousYield({ returned: 99, unusable: 3, hidden: 0, kept: 96 })).toBe(false);
    expect(isAnomalousYield({ returned: 100, unusable: 30, hidden: 0, kept: 70 })).toBe(true);
    // Sous 10 résultats, une proportion ne veut rien dire.
    expect(isAnomalousYield({ returned: 4, unusable: 3, hidden: 0, kept: 1 })).toBe(false);
  });

  it('le texte donne le compte entier, singulier compris', () => {
    expect(describeSearchYield({ returned: 99, unusable: 89, hidden: 0, kept: 10 })).toBe(
      '99 profils renvoyés par le moteur, 89 illisibles, 10 affichés.',
    );
    expect(describeSearchYield({ returned: 1, unusable: 0, hidden: 0, kept: 1 })).toBe('1 profil renvoyé par le moteur, 1 affiché.');
    expect(describeSearchYield({ returned: 12, unusable: 1, hidden: 1, kept: 10 })).toBe(
      '12 profils renvoyés par le moteur, 1 illisible, 1 déjà vu ou écarté, 10 affichés.',
    );
  });

  it('relit l’entrée de journal telle qu’elle est écrite ; incomplète ⇒ null, on ne devine pas', () => {
    const payload = {
      returned: 100,
      unusable: 89,
      skipped: { alreadySeen: 2, excluded: 0, opposed: 0, duplicates: 0 },
    };
    expect(yieldFromRunPayload(payload, 9)).toEqual({ returned: 100, unusable: 89, hidden: 2, kept: 9 });
    expect(yieldFromRunPayload(null, 9)).toBeNull();
    expect(yieldFromRunPayload({ returned: 100 }, 9)).toBeNull();
  });

  it('les champs fautifs se nomment par leur chemin, sans aucune valeur', () => {
    const r = ExaResultSchema.safeParse({ url: 42, title: 'Jeanne Martin', entities: [{ properties: { name: 7 } }] });
    expect(r.success).toBe(false);
    const labels = malformedFieldLabels(r.error!.issues);
    expect(labels).toContain('url: invalid_type');
    expect(labels.some((l) => l.startsWith('entities.#.properties.name'))).toBe(true);
    expect(labels.join(' ')).not.toMatch(/Jeanne|Martin|42|7/);
  });
});
