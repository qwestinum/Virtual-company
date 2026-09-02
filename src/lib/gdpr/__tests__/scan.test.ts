/**
 * Les parcours de purge — et LE piège qu'ils existent pour fermer.
 *
 * Défaut observé en recette le 02/09/2026 : `ids.length > 0 ? [{ op: 'in', … }]
 * : []` produisait, dans le cas vide, une requête SANS AUCUN FILTRE. PostgREST
 * rendait alors toute la table : la résolution d'UN candidat rapatriait
 * l'intégralité du vivier, dont les adresses élargissaient ensuite le périmètre
 * de proche en proche — et la purge aurait supprimé tous les dossiers.
 *
 * « Rien à chercher » doit vouloir dire « rien », jamais « tout ».
 */
import { describe, expect, it } from 'vitest';

import { escapeLike, isMissingTable, pageAllByText } from '@/lib/gdpr/scan';

/** Client factice : il COMPTE les requêtes réellement parties vers la base. */
function spyClient() {
  const calls: { table: string }[] = [];
  const client = {
    from(table: string) {
      calls.push({ table });
      const builder = {
        select: () => builder,
        order: () => builder,
        limit: () => builder,
        eq: () => builder,
        in: () => builder,
        ilike: () => builder,
        is: () => builder,
        not: () => builder,
        gt: () => builder,
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: [{ id: 'ligne-de-toute-la-table' }], error: null }),
      };
      return builder;
    },
  };
  return { client, calls };
}

describe('liste d’identifiants vide', () => {
  it('ne part PAS en base et ne rend rien', async () => {
    const { client, calls } = spyClient();
    const rows = await pageAllByText(
      client as unknown as Parameters<typeof pageAllByText>[0],
      'vivier_candidates',
      'id',
      'id',
      [{ op: 'in', col: 'id', values: [] }],
    );
    expect(rows).toEqual([]);
    // Le point décisif : AUCUNE requête n'est partie. Une requête sans filtre
    // aurait rendu toute la table, et la purge l'aurait prise pour sa cible.
    expect(calls).toEqual([]);
  });

  it('interroge bien la base quand la liste n’est pas vide', async () => {
    const { client, calls } = spyClient();
    const rows = await pageAllByText(
      client as unknown as Parameters<typeof pageAllByText>[0],
      'vivier_candidates',
      'id',
      'id',
      [{ op: 'in', col: 'id', values: ['a'] }],
    );
    expect(rows).toHaveLength(1);
    expect(calls).toEqual([{ table: 'vivier_candidates' }]);
  });
});

describe('escapeLike', () => {
  it('neutralise les jokers d’une adresse', () => {
    // Une adresse contenant `_` (courant) matcherait sinon n'importe quel
    // caractère — une purge qui élargit sa cible toute seule.
    expect(escapeLike('jean_dupont@exemple.fr')).toBe('jean\\_dupont@exemple.fr');
    expect(escapeLike('a%b')).toBe('a\\%b');
  });
});

describe('isMissingTable', () => {
  it('ne tolère QUE la table absente', () => {
    expect(isMissingTable({ code: '42P01' })).toBe(true);
    expect(isMissingTable({ code: 'PGRST205' })).toBe(true);
    // Une colonne mal nommée est une FAUTE du code de purge : elle doit
    // remonter, pas passer pour « environnement en retard d'une migration ».
    expect(isMissingTable({ code: '42703' })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
});
