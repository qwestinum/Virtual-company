import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  candidaturesHref,
  DEFAULT_WORKSPACE_PATH,
  interviewsHref,
  readCandidaturesFilter,
  readInterviewsFilter,
  signalHref,
  WORKSPACE_ENTRIES,
  workspaceEntryForPath,
} from '@/lib/navigation/workspace-routes';
import {
  LEGACY_ROUTES,
  legacyRedirectFor,
  legacyTarget,
  type LegacyPath,
} from '@/lib/navigation/legacy-routes';

describe('les cinq entrées', () => {
  it('sont cinq, dans l’ordre du travail, et Réglages n’en est pas une', () => {
    expect(WORKSPACE_ENTRIES.map((e) => e.id)).toEqual([
      'aujourdhui',
      'campagnes',
      'candidatures',
      'entretiens',
      'pilotage',
    ]);
    expect(WORKSPACE_ENTRIES.map((e) => e.href)).not.toContain('/settings');
  });

  it('l’entrée par défaut existe bien dans la barre', () => {
    expect(WORKSPACE_ENTRIES.map((e) => e.href)).toContain(
      DEFAULT_WORKSPACE_PATH,
    );
  });

  it('une sous-route reste sous son entrée', () => {
    // Une barre qui s'éteint dès qu'on descend d'un cran ferait croire qu'on a
    // quitté la section.
    expect(workspaceEntryForPath('/candidatures/validation')).toBe('candidatures');
    expect(workspaceEntryForPath('/campagnes/vivier')).toBe('campagnes');
    expect(workspaceEntryForPath('/campagnes/sourcing')).toBe('campagnes');
  });

  it('un chemin hors workspace n’allume aucune entrée', () => {
    expect(workspaceEntryForPath('/settings')).toBeNull();
    expect(workspaceEntryForPath('/app')).toBeNull();
    // Piège de préfixe : ce n'est pas une sous-route de /campagnes.
    expect(workspaceEntryForPath('/campagnes-archive')).toBeNull();
  });
});

describe('filtres portés par l’URL', () => {
  it('n’écrit que les paramètres réellement posés', () => {
    expect(candidaturesHref()).toBe('/candidatures');
    expect(candidaturesHref({ stage: 'a_valider' })).toBe(
      '/candidatures?statut=a_valider',
    );
    expect(
      candidaturesHref({ campaignId: 'CAMP-2026-221', stage: 'retenu' }),
    ).toBe('/candidatures?campagne=CAMP-2026-221&statut=retenu');
    expect(interviewsHref({ section: 'a_pointer' })).toBe(
      '/entretiens?section=a_pointer',
    );
  });

  it('aller-retour : ce qu’on écrit est ce qu’on relit', () => {
    for (const filter of [
      { campaignId: 'CAMP-2026-221', stage: 'a_valider' as const, parcours: null },
      { campaignId: null, stage: 'retenu' as const, parcours: null },
      { campaignId: 'CAMP-2026-991', stage: null, parcours: 'invitation' as const },
    ]) {
      const href = candidaturesHref(filter);
      const read = readCandidaturesFilter(
        new URLSearchParams(href.split('?')[1] ?? ''),
      );
      expect(read).toEqual(filter);
    }
  });

  it('une valeur inconnue est IGNORÉE, jamais une erreur', () => {
    // Un lien vieilli ou une adresse tapée de travers doit rendre l'écran non
    // filtré — pas une page cassée, et surtout pas une liste vide inexpliquée.
    const read = readCandidaturesFilter(
      new URLSearchParams('statut=zone_grise&parcours=telepathie'),
    );
    expect(read.stage).toBeNull();
    expect(read.parcours).toBeNull();
  });

  it('une section d’entretien inconnue retombe sur « aucune »', () => {
    expect(readInterviewsFilter(new URLSearchParams('section=demain')).section)
      .toBeNull();
  });
});

describe('cible d’un signal métier', () => {
  it('le signal de file mène là où sa population a déménagé', () => {
    expect(signalHref({ tab: 'validations' })).toBe(
      '/candidatures?statut=a_valider',
    );
  });

  it('porte le filtre du signal, jamais la liste complète', () => {
    expect(signalHref({ tab: 'candidatures', stage: 'entretien_fait' })).toBe(
      '/candidatures?statut=entretien_fait',
    );
    expect(signalHref({ tab: 'entretiens', section: 'a_pointer' })).toBe(
      '/entretiens?section=a_pointer',
    );
  });

  it('une destination hors workspace est rendue telle quelle', () => {
    expect(signalHref({ route: '/settings' })).toBe('/settings');
  });
});

describe('anciennes adresses', () => {
  it('chacune mène à sa nouvelle place, filtre compris', () => {
    expect(legacyTarget('/rh/recrutement')).toBe('/aujourdhui');
    expect(legacyTarget('/validations')).toBe('/candidatures?statut=a_valider');
    expect(legacyTarget('/validations-vivier')).toBe('/campagnes/vivier');
    expect(legacyTarget('/reporting')).toBe('/pilotage');
    expect(legacyTarget('/candidatures-apercu')).toBe('/candidatures');
  });

  it('la correspondance est EXACTE (on n’invente pas de destination)', () => {
    expect(legacyRedirectFor('/validations')).not.toBeNull();
    expect(legacyRedirectFor('/validations/1234')).toBeNull();
    expect(legacyRedirectFor('/inconnu')).toBeNull();
  });

  it('aucune cible ne renvoie vers une autre ancienne adresse', () => {
    // Un aller-retour entre deux redirections, c'est une boucle : le
    // navigateur abandonne et l'utilisateur voit une erreur, pas un écran.
    for (const { to } of Object.values(LEGACY_ROUTES)) {
      expect(legacyRedirectFor(to.split('?')[0]!)).toBeNull();
    }
  });

  it('chaque cible mène à un écran qui EXISTE', () => {
    // Garde structurelle : aucun test de logique ne peut attraper une
    // redirection vers une route jamais créée — elle compile, et ne se voit
    // qu'à l'exécution, sur un 404.
    const pageFor = (href: string): string => {
      const path = href.split('?')[0]!;
      return resolve(process.cwd(), `src/app/(workspace)${path}/page.tsx`);
    };
    for (const { to } of Object.values(LEGACY_ROUTES)) {
      expect(existsSync(pageFor(to)), `écran manquant pour ${to}`).toBe(true);
    }
  });

  it('chaque entrée de la barre mène à un écran qui EXISTE', () => {
    for (const entry of WORKSPACE_ENTRIES) {
      const page = resolve(
        process.cwd(),
        `src/app/(workspace)${entry.href}/page.tsx`,
      );
      expect(existsSync(page), `écran manquant pour ${entry.href}`).toBe(true);
    }
  });

  it('chaque ancienne adresse a encore sa page, qui LIT le tableau', () => {
    // Si la page disparaissait, l'adresse rendrait 404 — exactement ce que ce
    // module promet d'empêcher.
    for (const from of Object.keys(LEGACY_ROUTES) as LegacyPath[]) {
      const page = resolve(process.cwd(), `src/app${from}/page.tsx`);
      expect(existsSync(page), `page manquante pour ${from}`).toBe(true);
      const src = readFileSync(page, 'utf-8');
      expect(src).toContain(`legacyTarget('${from}')`);
    }
  });
});
