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

  it('TOUS les compteurs ouvrent Candidatures avec la puce du même mot', () => {
    // SANS EXCEPTION — « Invité » et « RDV pris » compris : leurs puces
    // existent là. Un compteur qui changerait d'écran selon l'étape
    // obligerait à deviner où l'on va avant de cliquer.
    const items = buildCardCounters(CAMP, 12, counts);
    for (const item of items) {
      expect(item.href, item.key).toMatch(/^\/candidatures\?campagne=CAMP-2026-221/);
    }
    expect(items.find((i) => i.key === 'invite')!.href).toBe(
      '/candidatures?campagne=CAMP-2026-221&statut=invite',
    );
    expect(items.find((i) => i.key === 'rdv_pris')!.href).toBe(
      '/candidatures?campagne=CAMP-2026-221&statut=rdv_pris',
    );
    expect(items.find((i) => i.key === 'retenu')!.href).toBe(
      '/candidatures?campagne=CAMP-2026-221&statut=retenu',
    );
  });

  it('aucun compteur ne mène à Entretiens', () => {
    // Entretiens se rejoint par « ce qui attend », et par là seulement.
    for (const item of buildCardCounters(CAMP, 12, counts)) {
      expect(item.href, item.key).not.toContain('/entretiens');
    }
  });

  it('chaque tuile porte son icône et sa couleur — celles de la carte existante', () => {
    for (const item of buildCardCounters(CAMP, 12, counts)) {
      expect(item.icon.length, item.key).toBeGreaterThan(0);
      expect(item.color, item.key).toMatch(/^var\(--dash-/);
    }
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

describe('latence — ce qui arrive avec la liste, ce qui attend le dépliage', () => {
  it('les compteurs arrivent AVEC la liste, en UN appel groupé', () => {
    // Les charger au dépliage faisait apparaître les chiffres après les
    // cartes, sur un écran dont c'est la première information.
    const liste = lire('src/components/campagnes/CampaignsList.tsx');
    expect(liste).toContain('useCampaignsCounters(');
    const hook = lire('src/components/campagnes/useCampaignsCounters.ts');
    expect(hook).toContain('/api/campaigns/counters?campaignIds=');
  });

  it('la carte ne LIT rien : elle reçoit ses compteurs', () => {
    const src = lire('src/components/campagnes/CampaignCardDetail.tsx');
    expect(src).toContain('counters: CampaignCardCounters | null');
    // Aucune lecture de compteurs dans le composant de carte.
    expect(src).not.toContain('/api/campaigns/counters');
  });

  it('seuls les trois états de sourcing attendent le dépliage', () => {
    const hook = lire('src/components/campagnes/useCampaignCardDetail.ts');
    expect(hook).toContain('if (!enabled) return;');
    // Et la route ne rend plus que ça.
    const route = lire('src/app/api/campaigns/[id]/card/route.ts');
    expect(route).not.toContain('computeStageCounts');
  });

  it('le squelette a la MÊME hauteur que la tuile pleine', () => {
    // Un écran qui se réorganise sous le curseur fait rater le clic déjà visé.
    const src = lire('src/components/campagnes/CampaignStatTile.tsx');
    expect(src).toContain('CampaignSourceTileSkeleton');
    expect(src).toContain('MÊME HAUTEUR');
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
