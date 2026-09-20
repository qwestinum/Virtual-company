import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * GARDES STRUCTURELLES du geste de réparation en lot.
 *
 * Aucune de ces trois règles ne peut être tenue par un test de valeurs : elles
 * portent sur ce que le code N'APPELLE PAS, ou sur le fait que deux endroits
 * lisent la MÊME source. On lit donc les fichiers.
 */

const lire = (p: string): string =>
  readFileSync(resolve(process.cwd(), p), 'utf-8');

const SIGNAUX = 'src/lib/notifications/business-signals.ts';
const ROUTE = 'src/app/api/validations/requeue/route.ts';
const SCAN = 'src/lib/hitl/orphan-scan.ts';

describe('le compteur et le geste lisent la même sélection', () => {
  it('le signal n’a plus sa propre sélection : il appelle orphan-scan', () => {
    // Un bouton qui répare onze dossiers pendant que le compteur en annonce
    // douze est pire que pas de bouton : plus rien n'est croyable.
    const src = lire(SIGNAUX);
    expect(src).toContain("from '@/lib/hitl/orphan-scan'");
    expect(src).toContain('listAwaitingWithoutRow()');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // Plus aucune énumération des zones d'attente à la main dans le signal.
    expect(code).not.toContain("['gray', 'proposed_reject']");
  });

  it('la route de lot lit la même sélection, jamais une liste du client', () => {
    const src = lire(ROUTE);
    expect(src).toContain("from '@/lib/hitl/orphan-scan'");
    expect(src).toContain('listAwaitingWithoutRow()');
    // Le corps accepté ne porte PAS d'identifiants : le serveur recalcule.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toContain('analysisIds');
    expect(code).toContain('z.literal(true)');
  });
});

describe('la réparation n’envoie RIEN', () => {
  it.each([SCAN, ROUTE])('%s n’importe aucun émetteur', (chemin) => {
    // Remettre en file, c'est demander un clic humain — exactement le
    // contraire d'envoyer. La conformité RGPD du 18/08/2026 tient là-dessus.
    const src = lire(chemin);
    for (const emetteur of [
      'sendEmail',
      'dispatchCandidateOutreach',
      'gateCandidateOutreach',
      'mail-composer',
      'lib/email',
    ]) {
      expect(src, `${chemin} importe ${emetteur}`).not.toContain(emetteur);
    }
  });

  it('le bouton de l’écran n’importe aucun émetteur non plus', () => {
    const src = lire('src/components/today/RequeueOrphansButton.tsx');
    expect(src).not.toContain('sendEmail');
    expect(src).toContain("{ all: true }");
  });
});

describe('le lot est séquentiel et ne s’arrête pas au premier échec', () => {
  it('chaque candidature passe par le chemin UNITAIRE', () => {
    const src = lire(ROUTE);
    // Pas de seconde implémentation de la remise en file : le lot boucle sur
    // celle qui existe, avec ses gardes et son écrivain.
    expect(src).toContain('requeueValidationForAnalysis(analyse.id');
    expect(src).toMatch(/for \(const analyse of orphelines\)/);
  });

  it('un échec est COMPTÉ, pas propagé', () => {
    const src = lire(ROUTE);
    expect(src).toContain('failed += 1');
    // Le bilan distingue les trois issues : annoncer « c'est réparé » quand
    // deux dossiers ont résisté ferait chercher longtemps.
    expect(src).toContain('alreadyQueued');
  });
});

describe('un seul geste initié depuis l’accueil', () => {
  it('l’en-tête ne porte QUE « Nouvelle campagne »', () => {
    // Un second bouton dans l'en-tête, et plus aucun des deux ne se voit.
    const src = lire('src/components/today/TodayHeader.tsx');
    expect(src).toContain('AddCampaignButton');
    expect(src).not.toContain('TodayPrimary');
  });

  it('c’est le composant EXISTANT, pas une copie', () => {
    const src = lire('src/components/today/TodayHeader.tsx');
    expect(src).toContain("from '@/components/campagnes/AddCampaignButton'");
    // Et la page Campagnes lit le même.
    expect(lire('src/components/campagnes/CampaignsList.tsx')).toContain(
      "from './AddCampaignButton'",
    );
  });
});
