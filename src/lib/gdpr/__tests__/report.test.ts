/**
 * Le rapport de confirmation — le livrable.
 *
 * Deux exigences non négociables :
 *   · il ne nomme JAMAIS la personne (il est identifié par la référence de la
 *     demande — la correspondance appartient au responsable de traitement) ;
 *   · il dit ce qui n'a PAS été fait, et par qui ça doit l'être. Un rapport
 *     qui laisse croire à une couverture complète alors que le message
 *     d'origine dort dans une boîte de réception ne vaut rien.
 */
import { describe, expect, it } from 'vitest';

import {
  assertNoLeakedIdentity,
  renderErasureReport,
  ReportLeakError,
  type ReportInput,
} from '@/lib/gdpr/report';
import { EMPTY_ERASURE_COUNTS } from '@/types/gdpr';

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    requestRef: 'courriel DRH du 27/08/2026',
    receivedAt: '2026-08-27T09:00:00.000Z',
    executedAt: '2026-09-02T14:00:00.000Z',
    environmentLabel: 'environnement obkruafjsbynwbayzuvy',
    counts: {
      ...EMPTY_ERASURE_COUNTS,
      analyses: 3,
      storageFilesDeleted: 7,
      storageFilesRewritten: 1,
      journalEntries: 42,
      unmatchedRows: 2,
      vivierDossiers: 1,
    },
    alreadyErased: { ...EMPTY_ERASURE_COUNTS },
    storage: [],
    purgedAnalyses: false,
    backupRetentionDays: null,
    dryRun: false,
    verification: 'clean',
    ...over,
  };
}

describe('renderErasureReport', () => {
  it('ne contient ni nom ni adresse — la référence suffit', () => {
    const out = renderErasureReport(input());
    expect(out).toContain('courriel DRH du 27/08/2026');
    expect(out).toMatch(/ne mentionne\s+ni le nom ni l’adresse/u);
  });

  it('détaille les volumes par catégorie', () => {
    const out = renderErasureReport(input());
    expect(out).toContain('| CV, rapports d’analyse et messages (fichiers) | 7 |');
    expect(out).toContain('| Dossiers de vivier (CV, index de recherche, propositions) | 1 |');
  });

  it('explique la pseudonymisation du journal par la PREUVE, pas par la technique', () => {
    const out = renderErasureReport(input());
    expect(out).toContain('42 entrée(s)');
    expect(out).toContain('démontrer');
    expect(out).toContain('supprimer la preuve de l’effacement');
  });

  it('explique le vidage des candidatures et son motif comptable', () => {
    const out = renderErasureReport(input());
    expect(out).toContain('ligne statistique anonyme');
    expect(out).toContain('bilans de campagne déjà');
  });

  it('mentionne le garde-fou anti-résurrection sans jargon', () => {
    const out = renderErasureReport(input());
    expect(out).toContain('recrée la ');
    expect(out).toContain('Aucune liste d’opposition');
  });

  it('n’INVENTE PAS de délai de sauvegarde quand il est inconnu', () => {
    const out = renderErasureReport(input({ backupRetentionDays: null }));
    expect(out).toContain('à confirmer auprès de');
    expect(out).not.toMatch(/\b7 jours\b/u);
  });

  it('annonce le délai quand il est fourni', () => {
    const out = renderErasureReport(input({ backupRetentionDays: 7 }));
    expect(out).toContain('**7 jours**');
  });

  it('liste ce qui reste à faire hors du système, avec le responsable', () => {
    const out = renderErasureReport(input());
    expect(out).toContain('Boîte de réception surveillée');
    expect(out).toContain('Prestataire d’envoi de courriels');
    expect(out).toContain('Poste de l’opérateur');
  });

  it('signale les fichiers laissés en attente de vérification', () => {
    const out = renderErasureReport(
      input({
        storage: [{ path: 'campagnes/C/cv-dupont.pdf', action: 'review', why: 'homonyme ?' }],
      }),
    );
    expect(out).toContain('attente de vérification');
    expect(out).toContain('homonyme');
  });

  it('un constat ne PRÉTEND PAS qu’un contrôle a déjà eu lieu', () => {
    // Aucune vérification ne tourne en mode constat : le rapport doit parler
    // au futur, sinon il affirme une garantie qu'il n'a pas donnée.
    expect(renderErasureReport(input({ dryRun: true }))).toContain(
      'un contrôle automatique vérifie',
    );
    expect(renderErasureReport(input())).toContain('a vérifié');
  });

  it('un constat DIT qu’il n’a rien modifié', () => {
    const out = renderErasureReport(input({ dryRun: true }));
    expect(out).toContain('Constat préalable');
    expect(out).toContain('Aucune donnée ');
    expect(out).toContain('n’a été modifiée');
  });

  it('un rejeu explique les éléments déjà traités', () => {
    const out = renderErasureReport(
      input({ alreadyErased: { ...EMPTY_ERASURE_COUNTS, journalEntries: 5 } }),
    );
    expect(out).toContain('déjà traités');
    expect(out).toContain('5 élément(s)');
  });
});

// ─── Le livrable ne porte que des compteurs ────────────────────────────────

describe('le rapport ne peut pas nommer un tiers', () => {
  it('« périmètre vide » ne se dit pas « contrôle effectué »', () => {
    // Le rejeu du 02/09/2026 : rien à effacer, donc rien à contrôler. Écrire
    // « un contrôle automatique a vérifié » serait une affirmation fausse dans
    // un document qui sert de preuve.
    const md = renderErasureReport(
      input({ counts: { ...EMPTY_ERASURE_COUNTS }, verification: 'not_run' }),
    );
    expect(md).toContain('sans objet');
    expect(md).not.toContain('a vérifié qu’aucun chemin');
  });

  it('un contrôle en échec porte l’avertissement EN TÊTE', () => {
    const md = renderErasureReport(input({ verification: 'residues' }));
    expect(md.split('\n').slice(0, 6).join('\n')).toContain('NE PAS TRANSMETTRE');
  });

  it('aucun nom de tiers ne peut y entrer : le rendu ne reçoit que des nombres', () => {
    // La garde structurelle — `ReportInput` n'a aucun champ où déposer un
    // constat. Le rendu d'un périmètre chargé ne contient donc aucun des noms
    // que le contrôle a pu croiser en base.
    const md = renderErasureReport(input());
    for (const tiers of ['Abdelilah', 'Kossivi', 'Rikhard', '@']) {
      expect(md.includes(tiers)).toBe(false);
    }
  });
});

describe('assertNoLeakedIdentity', () => {
  const clean = renderErasureReport(input());

  it('laisse passer un rapport qui ne porte que des compteurs', () => {
    expect(() =>
      assertNoLeakedIdentity(clean, ['Yvan Bisseg', 'yvan.bisseg@exemple.fr']),
    ).not.toThrow();
  });

  it('REFUSE un rapport où un extrait relevé par le contrôle s’est glissé', () => {
    const leaked = `${clean}\n\nRésidu : candidate_analyses#42 — Abdelilah Badaj`;
    expect(() => assertNoLeakedIdentity(leaked, ['Abdelilah Badaj'])).toThrow(ReportLeakError);
  });

  it('ignore les fragments trop courts, qui collisionneraient avec la prose', () => {
    // « Luc » figure dans « inclus », « exclusivement »… Un fragment de trois
    // lettres n'identifie personne et bloquerait des exécutions légitimes.
    expect(() => assertNoLeakedIdentity(clean, ['Luc'])).not.toThrow();
  });

  it('ne se déclenche pas sur la référence de la demande, qui est la phrase du client', () => {
    const md = renderErasureReport(input({ requestRef: 'demande de Yvan Bisseg du 27/08' }));
    expect(() =>
      assertNoLeakedIdentity(md, ['Yvan Bisseg'], ['demande de Yvan Bisseg du 27/08']),
    ).not.toThrow();
    // Sans l'exemption, la même garde mord : c'est bien la même règle.
    expect(() => assertNoLeakedIdentity(md, ['Yvan Bisseg'])).toThrow(ReportLeakError);
  });
});
