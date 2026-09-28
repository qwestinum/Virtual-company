import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildCardAwaiting,
  buildCardCounters,
  buildCardSources,
  conversionLine,
} from '@/lib/campagnes/card-detail';
import { CANDIDATE_STAGE_LABELS } from '@/lib/reporting/candidate-stage';

const CAMP = 'CAMP-2026-221';

describe('① compteurs — l’ENTONNOIR : chaque candidature passée par une étape la compte', () => {
  // CAMP-2026-221 après clôture : deux retenus, l'un recruté, l'autre non
  // sélectionné — la carte affichait « Retenu 0 » (bug du 28/09/2026).
  const trajectory = { recues: 2, a_valider: 1, invite: 2, entretien_fait: 2, retenu: 2, recrute: 1 };
  const tiles = () => buildCardCounters(CAMP, trajectory);

  it('Reçues · À valider · Invité · Entretien fait · Retenu · Recruté — et rien d’autre', () => {
    expect(tiles().map((t) => t.label)).toEqual([
      'Reçues',
      'À valider',
      'Invité',
      'Entretien fait',
      'Retenu',
      'Recruté',
    ]);
    for (const absent of ['rdv_pris', 'proposition_refus', 'ecarte', 'non_retenu', 'sans_suite']) {
      expect(tiles().some((t) => t.key === absent), absent).toBe(false);
    }
  });

  it('un recruté a été retenu : « Retenu 2 », « Recruté 1 »', () => {
    expect(tiles().find((t) => t.key === 'retenu')!.count).toBe(2);
    expect(tiles().find((t) => t.key === 'recrute')!.count).toBe(1);
  });

  it('chaque compteur ouvre les candidatures qu’il compte (filtre de parcours), avec le mot de l’étape', () => {
    const parcours = { a_valider: 'validation', invite: 'invitation', entretien_fait: 'entretien', retenu: 'retenu', recrute: 'recrute' } as const;
    for (const item of tiles().slice(1)) {
      const step = item.key as keyof typeof parcours;
      expect(item.label).toBe(CANDIDATE_STAGE_LABELS[step]);
      expect(item.count).toBe(trajectory[step]);
      expect(item.href).toBe(`/candidatures?campagne=CAMP-2026-221&parcours=${parcours[step]}`);
      expect(item.definition.length, step).toBeGreaterThan(10);
    }
  });

  it('« Reçues » reste un TOTAL cliquable, tous statuts confondus', () => {
    const recues = tiles()[0]!;
    expect(recues.count).toBe(2);
    expect(recues.href).toBe('/candidatures?campagne=CAMP-2026-221');
  });

  it('aucun compteur ne mène à Entretiens', () => {
    for (const item of tiles()) expect(item.href, item.key).not.toContain('/entretiens');
  });

  it('chaque tuile porte son icône et sa couleur', () => {
    for (const item of tiles()) {
      expect(item.icon.length, item.key).toBeGreaterThan(0);
      expect(item.color, item.key).toMatch(/^var\(--dash-/);
    }
  });

  it('le taux de conversion solde l’entonnoir : recrutés / reçues', () => {
    expect(conversionLine(trajectory)).toBe('Taux de conversion : 50 % — 1 recruté sur 2 candidatures reçues');
    expect(conversionLine({ ...trajectory, recues: 0, recrute: 0 })).toBeNull();
  });
});

describe('② ce qui attend — deux files, deux lignes', () => {
  const vide = { aValider: 0, aValiderOldestDays: null, propositionsRefus: 0, entretiensAConfirmer: 0 };

  it('rien en attente ⇒ aucune ligne (le bloc disparaît)', () => {
    expect(buildCardAwaiting(CAMP, vide)).toEqual([]);
  });

  it('« N à arbitrer » dit l’ancienneté quand elle existe, et se tait sinon', () => {
    const [ligne] = buildCardAwaiting(CAMP, { ...vide, aValider: 2, aValiderOldestDays: 9 });
    expect(ligne!.text).toBe('2 à arbitrer — la plus ancienne depuis 9 jours');
    const [aujourdhui] = buildCardAwaiting(CAMP, { ...vide, aValider: 1, aValiderOldestDays: 0 });
    expect(aujourdhui!.text).toBe('1 à arbitrer');
  });

  it('les propositions de refus ont LEUR ligne, distincte de l’arbitrage', () => {
    const lignes = buildCardAwaiting(CAMP, { ...vide, aValider: 1, propositionsRefus: 4 });
    expect(lignes.map((l) => l.text)).toEqual([
      '1 à arbitrer',
      '4 propositions de refus à passer en revue',
    ]);
    expect(lignes[1]!.href).toBe('/candidatures?campagne=CAMP-2026-221&statut=proposition_refus');
  });

  it('les entretiens à confirmer restent visibles avec les deux files', () => {
    const lignes = buildCardAwaiting(CAMP, {
      aValider: 5,
      aValiderOldestDays: 3,
      propositionsRefus: 2,
      entretiensAConfirmer: 4,
    });
    expect(lignes).toHaveLength(3);
    expect(lignes[2]!.href).toBe('/entretiens?campagne=CAMP-2026-221&section=a_pointer');
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
