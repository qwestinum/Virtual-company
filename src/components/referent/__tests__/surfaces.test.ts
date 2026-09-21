/**
 * Garde STRUCTURELLE des surfaces qui portent la mention du référent.
 *
 * Deux invariants qu'aucun test de logique pure ne peut tenir, faute de rendu
 * dans ce projet (vitest tourne en environnement `node`) — et qui sont
 * précisément ceux dont la violation serait SILENCIEUSE :
 *
 *  1. LES ALERTES NE SONT JAMAIS FILTRÉES. Le bandeau des cibles orphelines et
 *     le compte des rendez-vous passés non pointés se calculent sur
 *     l'ENSEMBLE. Un filtre de confort qui masquerait des dossiers en
 *     souffrance ferait perdre au signal sa fonction — et rien à l'écran ne
 *     dirait que le compte a rétréci.
 *
 *  2. LES TROIS SURFACES DISENT QUI EST RESPONSABLE. Validations, entretiens,
 *     fiche candidature (panneau ET page) : la même mention, par le même
 *     composant. Un écran qui la tait redevient celui où l'on ne sait pas à
 *     qui s'adresser.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(join(process.cwd(), 'src', relative), 'utf8');

describe('les alertes échappent au filtre', () => {
  const source = read('components/interviews/InterviewsWorkspace.tsx');

  it('le bandeau des cibles orphelines est nourri du pipeline COMPLET', () => {
    expect(source).toContain('<InterviewSignals orphans={pipeline.orphans} />');
  });

  /**
   * ⚠️ On cherche la VALEUR passée, pas une syntaxe. Ces assertions lisaient
   * `alert: pipeline.counts.toPoint` — la forme d'un littéral d'objet — et
   * sont tombées le jour où les onglets sont devenus des tuiles et les clés
   * des props JSX (`alert={…}`). L'invariant n'avait pas bougé d'un pouce ;
   * seule son écriture. Une garde attachée à la ponctuation crie au loup sur
   * un changement de forme, et finit par être désarmée.
   */
  const passe = (prop: string, valeur: string) =>
    new RegExp(`${prop}\\s*[:=]\\s*\\{?\\s*${valeur.replace(/\./g, '\\.')}`).test(source);

  it('le badge « à pointer » lit le compteur du pipeline, pas la liste filtrée', () => {
    expect(passe('alert', 'pipeline.counts.toPoint'), 'alert ← pipeline.counts.toPoint').toBe(true);
  });

  it('les listes affichées, ELLES, sont bien filtrées', () => {
    // Sans quoi le filtre ne servirait à rien — l'invariant ci-dessus n'a de
    // sens que si le filtre agit réellement quelque part.
    expect(source).toContain('const awaiting = filter(pipeline.awaiting);');
    expect(source).toContain('const scheduled = filter(pipeline.scheduled);');
    expect(source).toContain('const verdictRows = filter(pipeline.verdict);');
  });

  it('les totaux des onglets restent ceux du pipeline (affichage « n sur N »)', () => {
    expect(passe('total', 'pipeline.counts.scheduled')).toBe(true);
    expect(passe('total', 'pipeline.counts.awaiting')).toBe(true);
    expect(passe('total', 'pipeline.counts.verdict')).toBe(true);
  });
});

describe('toutes les surfaces nomment le référent', () => {
  const SURFACES = [
    'components/validations/ValidationCard.tsx',
    'components/interviews/AwaitingList.tsx',
    'components/interviews/ScheduledList.tsx',
    'components/candidatures/CandidaturePanel.tsx',
    'components/candidatures/CandidatureFullPage.tsx',
  ];

  it.each(SURFACES)('%s rend <ReferentMention>', (file) => {
    const source = read(file);
    expect(source).toContain(
      "from '@/components/referent/ReferentMention'",
    );
    expect(source).toContain('<ReferentMention');
  });

  it('seul l’onglet « Programmés » affiche un référent supplanté', () => {
    // La divergence n'a de sens que sur un rendez-vous DÉJÀ PRIS : ailleurs,
    // le référent de la campagne est la seule vérité et il n'y a rien à
    // opposer. L'afficher sur une ligne en attente inventerait un conflit.
    expect(read('components/interviews/ScheduledList.tsx')).toContain(
      'supersededBy={row.supersededBy}',
    );
    for (const file of SURFACES.filter(
      (f) => !f.endsWith('ScheduledList.tsx'),
    )) {
      expect(read(file)).not.toContain('supersededBy');
    }
  });
});
