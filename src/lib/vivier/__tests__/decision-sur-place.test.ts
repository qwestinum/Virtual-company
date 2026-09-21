import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * LA FILE DIFFÉRÉE A DISPARU — gardes structurelles.
 *
 * Aucune de ces règles ne tient par un test de valeurs : elles portent sur ce
 * qui n'existe PLUS, et sur l'endroit où une décision se prend. On lit donc
 * l'arborescence et les fichiers.
 */

const lire = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf-8');
const existe = (p: string): boolean => existsSync(resolve(process.cwd(), p));

describe('la décision se prend DANS la campagne', () => {
  it('le panneau vivier de la campagne monte la liste de décision', () => {
    // Sur 12 propositions générées en production, 8 n'avaient jamais été
    // tranchées dans la file différée — dont deux depuis deux mois. Une file
    // qu'on ne visite pas n'est pas une file d'attente, c'est un oubli.
    const src = lire('src/components/vivier/VivierPreselectionPanel.tsx');
    expect(src).toContain("from './VivierValidationList'");
    expect(src).toContain('<VivierValidationList');
  });

  it('elle ne reçoit QUE ce qui attend une décision', () => {
    // Mélanger tranchées et non tranchées obligerait à lire l'état de chaque
    // ligne pour savoir laquelle appelle un geste.
    const src = lire('src/components/vivier/VivierPreselectionPanel.tsx');
    expect(src).toContain("e.state === 'identified'");
    expect(src).toContain("e.state !== 'identified'");
  });

  it('le CHEMIN de décision n’a pas changé', () => {
    // Même composant, même endpoint par campagne : le lot déplace un écran,
    // il ne réécrit pas une règle métier.
    const src = lire('src/components/vivier/VivierValidationList.tsx');
    expect(src).toContain('/vivier-preselection/decisions');
  });
});

describe('la file différée n’existe plus', () => {
  it('son écran est supprimé', () => {
    expect(existe('src/app/(workspace)/campagnes/vivier/page.tsx')).toBe(false);
    expect(existe('src/components/vivier/VivierValidationsWorklist.tsx')).toBe(false);
  });

  it('plus aucun composant ne la monte', () => {
    const chemins = [
      'src/components/workspace/WorkspaceChrome.tsx',
      'src/components/workspace/WorkspaceNav.tsx',
    ];
    for (const c of chemins) {
      expect(lire(c), c).not.toContain('VivierValidationsWorklist');
    }
  });

  it('son ancienne adresse mène aux campagnes, jamais à un 404', () => {
    // Des liens partagés la portent encore : elle ne rend jamais 404.
    const src = lire('src/lib/navigation/legacy-routes.ts');
    expect(src).toContain("'/validations-vivier'");
    expect(src).toMatch(/'\/validations-vivier':\s*\{\s*\n\s*to:\s*'\/campagnes'/);
  });
});

describe('le bouton qui nomme un geste dépose devant ce geste', () => {
  /**
   * ⚠️ CE TEST NE PROUVE PAS QUE LA PORTE S'OUVRE. Il a longtemps prétendu le
   * faire, en vérifiant que la chaîne « ouvrir=vivier » figurait dans le lien
   * et que les mots du câblage apparaissaient dans les fichiers — les deux
   * étaient vrais pendant que la porte ne menait nulle part. Le clic est dans
   * S29 (`tests/e2e/`), et c'est LUI le verdict.
   *
   * Ce qui reste ici est l'invariant STRUCTUREL, celui qu'un clic ne dit pas :
   * la porte mène à un écran DÉDIÉ, pas à la feuille d'édition — un accordéon
   * de neuf blocs pour trancher trois profils n'est pas « déposer devant le
   * geste ».
   */
  it('« Chercher dans le vivier » mène à un écran à elle, pas à l’accordéon', () => {
    const detail = lire('src/lib/campagnes/card-detail.ts');
    expect(detail).toContain('/vivier');
    expect(detail).not.toContain('ouvrir=vivier');
    // L'écran existe, et il monte le panneau de présélection.
    expect(lire('src/components/campagnes/CampaignVivierScreen.tsx')).toContain(
      'VivierPreselectionPanel',
    );
  });

  it('une section inconnue venue de l’URL n’ouvre RIEN au hasard', () => {
    const src = lire('src/components/campagnes/CampaignsScreen.tsx');
    expect(src).toContain('SECTIONS_OUVRABLES');
  });
});
