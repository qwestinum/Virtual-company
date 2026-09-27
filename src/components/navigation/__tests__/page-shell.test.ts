import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * UN GABARIT, ET PAS DEUX.
 *
 * ⚠️ Ce test ne dit PAS que les écrans s'alignent — ça, c'est S32, qui mesure
 * les boîtes dans un navigateur. Il dit ce qu'un clic ne voit pas : qu'aucun
 * écran ne s'est REFAIT un conteneur à lui. C'est précisément la façon dont la
 * rupture est revenue la première fois : chaque écran écrivait ses propres
 * marges, toutes différentes, et rien ne les confrontait.
 *
 * Mesuré avant correction (fenêtre 1440 × 900) : conteneur de 1400 px sur
 * Campagnes, 896 px sur Entretiens, Réglages et Sourcing, pleine largeur sur
 * Candidatures ; titre de page de x = 28 à x = 296 ; et Pilotage sans titre.
 */

const RACINE = process.cwd();
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf-8');

/**
 * Les écrans qui PORTENT une page. Une route qui se contente de déléguer à un
 * de ces composants n'y figure pas : elle n'a pas de cadre à poser, et l'y
 * inscrire ferait croire à une garde qu'elle n'a pas besoin d'avoir.
 */
const ECRANS = [
  'src/components/today/TodayBoardView.tsx',
  'src/components/campagnes/CampaignsWorkspace.tsx',
  'src/components/candidatures/CandidaturesWorkspace.tsx',
  'src/components/interviews/InterviewsWorkspace.tsx',
  'src/components/sourcing/SourcingWorkspace.tsx',
  'src/components/campagnes/assistant/CampaignAssistantScreen.tsx',
  'src/components/campagnes/CampaignFocusScreen.tsx',
  // Pilotage ne monte PAS le gabarit à la route : sa barre d'outils dépend
  // d'un état client, et elle doit se ranger dans la zone de tête. C'est donc
  // le sous-écran qui le monte, via `PilotageShell`.
  'src/components/reporting/PilotageShell.tsx',
  'src/components/reporting/CampaignReportList.tsx',
];

/** Retire les commentaires : ce fichier-ci en cite, et les écrans aussi. */
const sansCommentaires = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('aucun écran ne se refait un conteneur', () => {
  it('chacun monte le gabarit', () => {
    for (const f of ECRANS) {
      // `PilotageShell` compte : il ne fait que nommer le gabarit avec le
      // titre de l'écran, il n'en redessine aucune valeur (vérifié plus bas).
      expect(lire(f), f).toMatch(/PageShell|PilotageShell/);
    }
  });

  it('aucun ne pose de largeur de PAGE ni de centrage', () => {
    const fautifs: string[] = [];
    for (const f of ECRANS) {
      const src = sansCommentaires(lire(f));
      // `maxWidth: 980` sur une CARTE est du contenu, pas un cadre de page :
      // ce qu'on traque, c'est le trio qui fabrique un conteneur de page.
      if (/margin:\s*'0 auto'/.test(src)) fautifs.push(`${f} — margin: '0 auto'`);
      if (/\bmx-auto\b/.test(src)) fautifs.push(`${f} — mx-auto`);
      if (/max-w-(4xl|5xl|6xl|7xl|screen)/.test(src)) fautifs.push(`${f} — max-w-*`);
      // Marges de page écrites à la main (le gabarit les porte).
      if (/padding:\s*'24px 28px/.test(src)) fautifs.push(`${f} — padding de page`);
      if (/\bpx-6 py-6\b/.test(src)) fautifs.push(`${f} — px-6 py-6`);
    }
    expect(fautifs, fautifs.join('\n')).toEqual([]);
  });

  it('le gabarit est le SEUL à porter les valeurs', () => {
    const shell = lire('src/components/navigation/PageShell.tsx');
    expect(shell).toContain('const LARGEUR_MAX = 1400');
    expect(shell).toContain("margin: '0 auto'");
    // Le fond vient du workspace : un écran qui peint le sien rompt la
    // continuité au moment précis où l'on change d'onglet.
    expect(shell).toContain("background: 'transparent'");
  });

  it('aucun écran ne peint son propre fond de page', () => {
    // Candidatures posait `bg-orqa-brume` (un bleu-gris à elle) : la page
    // changeait de COULEUR en plus de changer de largeur. Cette palette
    // n'existe plus, la garde reste : un écran ne peint pas son fond.
    for (const f of ECRANS) {
      const src = sansCommentaires(lire(f));
      expect(src, `${f} peint un fond de page`).not.toMatch(
        /className="[^"]*\bh-full\b[^"]*\bbg-/,
      );
    }
  });
});
