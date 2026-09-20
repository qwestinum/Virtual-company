import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildCardAwaiting,
  buildCardCounters,
  buildCardSources,
} from '@/lib/campagnes/card-detail';
import {
  CANDIDATE_STAGE_LABELS,
  emptyStageCounts,
} from '@/lib/reporting/candidate-stage';

const CAMP = 'CAMP-2026-221';

describe('① compteurs — option A : des ÉTAPES, jamais des trajectoires', () => {
  const counts = {
    ...emptyStageCounts(),
    a_valider: 2,
    invite: 0,
    rdv_pris: 1,
    retenu: 1,
  };

  it('chaque compteur porte LE MÊME MOT que la puce vers laquelle il mène', () => {
    // C'est la règle de l'option A. « Invités 2 » menant à une liste « Invité »
    // VIDE est pire que deux mots différents : mesuré sur CAMP-2026-221, la
    // carte affichait 2 quand la puce affichait 0.
    const items = buildCardCounters(CAMP, 12, counts);
    for (const item of items.slice(1)) {
      const stage = item.key as keyof typeof CANDIDATE_STAGE_LABELS;
      expect(item.label).toBe(CANDIDATE_STAGE_LABELS[stage]);
      expect(item.count).toBe(counts[stage]);
    }
  });

  it('« Reçues » reste un TOTAL cliquable, tous statuts confondus', () => {
    const recues = buildCardCounters(CAMP, 12, counts)[0]!;
    expect(recues.label).toBe('Reçues');
    expect(recues.count).toBe(12);
    expect(recues.href).toBe('/candidatures?campagne=CAMP-2026-221');
    // Sans filtre de statut : c'est ce qui en fait un total.
    expect(recues.href).not.toContain('statut=');
  });

  it('« RDV pris » mène à Entretiens — c’est là que le rendez-vous se traite', () => {
    const items = buildCardCounters(CAMP, 12, counts);
    const rdv = items.find((i) => i.key === 'rdv_pris')!;
    expect(rdv.href).toBe('/entretiens?campagne=CAMP-2026-221');
  });

  it('les autres étapes mènent à Candidatures, filtrées sur la campagne', () => {
    const items = buildCardCounters(CAMP, 12, counts);
    expect(items.find((i) => i.key === 'a_valider')!.href).toBe(
      '/candidatures?campagne=CAMP-2026-221&statut=a_valider',
    );
    expect(items.find((i) => i.key === 'retenu')!.href).toBe(
      '/candidatures?campagne=CAMP-2026-221&statut=retenu',
    );
  });

  it('un compteur à zéro reste affiché : il informe', () => {
    const invite = buildCardCounters(CAMP, 12, counts).find((i) => i.key === 'invite')!;
    expect(invite.count).toBe(0);
  });
});

describe('② ce qui attend — DEUX LIGNES au maximum', () => {
  it('rien en attente ⇒ aucune ligne (le bloc disparaît)', () => {
    expect(
      buildCardAwaiting(CAMP, {
        aValider: 0,
        aValiderOldestDays: null,
        entretiensAConfirmer: 0,
      }),
    ).toEqual([]);
  });

  it('dit l’ancienneté quand elle existe, et se tait sinon', () => {
    const [ligne] = buildCardAwaiting(CAMP, {
      aValider: 2,
      aValiderOldestDays: 9,
      entretiensAConfirmer: 0,
    });
    expect(ligne!.text).toBe('2 candidatures à valider — la plus ancienne depuis 9 jours');

    const [aujourdhui] = buildCardAwaiting(CAMP, {
      aValider: 1,
      aValiderOldestDays: 0,
      entretiensAConfirmer: 0,
    });
    // « depuis 0 jour » ne veut rien dire : on n'écrit rien.
    expect(aujourdhui!.text).toBe('1 candidature à valider');
  });

  it('jamais plus de deux lignes', () => {
    const lignes = buildCardAwaiting(CAMP, {
      aValider: 5,
      aValiderOldestDays: 3,
      entretiensAConfirmer: 4,
    });
    expect(lignes).toHaveLength(2);
    expect(lignes[1]!.href).toBe(
      '/entretiens?campagne=CAMP-2026-221&section=a_pointer',
    );
  });
});

describe('③ trouver des candidats — fermé sur un brouillon, et DIT', () => {
  const etats = {
    annonce: 'Aucune annonce diffusée.',
    vivier: 'Aucun profil du vivier retenu pour l’instant.',
    approches: 'Aucune approche préparée.',
  };

  it('une campagne ACTIVE ouvre les trois portes', () => {
    const sources = buildCardSources(CAMP, {
      isDraft: false,
      sourcingEnabled: true,
      ...etats,
    });
    expect(sources).toHaveLength(3);
    for (const s of sources) {
      expect(s.href, s.key).not.toBeNull();
      expect(s.reason, s.key).toBeNull();
    }
  });

  it('un BROUILLON les ferme toutes les trois, avec la raison', () => {
    // Diffuser depuis un brouillon fait arriver des candidatures que le chemin
    // email n'analysera pas : il ne traite que les campagnes actives.
    const sources = buildCardSources(CAMP, {
      isDraft: true,
      sourcingEnabled: true,
      ...etats,
    });
    for (const s of sources) {
      expect(s.href, s.key).toBeNull();
      // Un bouton grisé sans un mot ne déplace pas le besoin, il le supprime.
      expect(s.reason, s.key).toContain('Activez la campagne');
    }
  });

  it('module Sourcing éteint : l’entrée est fermée, et on dit pourquoi', () => {
    const approches = buildCardSources(CAMP, {
      isDraft: false,
      sourcingEnabled: false,
      ...etats,
    }).find((s) => s.key === 'approches')!;
    expect(approches.href).toBeNull();
    expect(approches.reason).toContain('pas activée');
  });

  it('l’état n’est JAMAIS vide : « rien » se dit', () => {
    for (const draft of [true, false]) {
      for (const s of buildCardSources(CAMP, {
        isDraft: draft,
        sourcingEnabled: true,
        ...etats,
      })) {
        expect(s.state.length, s.key).toBeGreaterThan(0);
      }
    }
  });
});

// ── Gardes STRUCTURELLES ────────────────────────────────────────────────────

const lire = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf-8');

describe('la lecture du détail ne part QU’AU DÉPLIAGE', () => {
  it('la carte ne monte le détail que si elle est ouverte', () => {
    // Une liste de quinze campagnes ne doit déclencher AUCUNE requête.
    const src = lire('src/components/campagnes/CampaignCard.tsx');
    expect(src).toMatch(/\{expanded \? \(\s*<CampaignCardDetail/);
  });

  it('le hook lui-même refuse de lire quand c’est fermé', () => {
    // Deux ceintures : si un jour la carte montait le détail en permanence,
    // le hook ne lirait toujours rien.
    const src = lire('src/components/campagnes/useCampaignCardDetail.ts');
    expect(src).toContain('if (!enabled) return;');
  });
});

describe('les taux ont quitté la carte', () => {
  it('plus de taux ni de conversion dans la carte', () => {
    // Ce sont des mesures de performance : leur place est Pilotage, pas
    // l'écran où l'on vient faire avancer des dossiers.
    const src = lire('src/components/campagnes/CampaignCard.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const mot of ['conversion', 'Conversion', 'goRate', 'Taux']) {
      expect(src, mot).not.toContain(mot);
    }
  });

  it('la carte ne compte plus aucune TRAJECTOIRE', () => {
    const src = lire('src/components/campagnes/CampaignCard.tsx');
    expect(src).not.toContain('everInvited');
    expect(src).not.toContain('everInterviewed');
    expect(src).not.toContain('shortlisted');
  });
});
