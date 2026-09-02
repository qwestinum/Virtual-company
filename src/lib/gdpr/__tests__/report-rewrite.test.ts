/**
 * Réécriture d'un rapport GROUPÉ.
 *
 * Le défaut à ne jamais commettre : supprimer un rapport de lot parce qu'il
 * contient le candidat, et effacer du même geste l'analyse de trois autres
 * personnes — qui n'ont rien demandé, et à qui cette analyse doit toujours
 * l'explication de la décision les concernant.
 */
import { describe, expect, it } from 'vitest';

import { buildFingerprint } from '@/lib/gdpr/payload-pseudonymize';
import { stripCandidateSections } from '@/lib/gdpr/report-rewrite';

const MARKER = '[effacé — demande RGPD test]';

const fp = buildFingerprint({
  emails: ['jean.dupont@exemple.fr'],
  names: ['Jean Dupont'],
  phones: [],
});

const REPORT = [
  '# Analyse de 3 CV — CAMP-2026-051',
  '',
  'Reçus : 3 · Retenus : 2',
  '',
  '---',
  '',
  '## Jean Dupont — 72/100 — Retenu',
  'Fichier : `CV-Jean-Dupont.pdf`',
  'Email : jean.dupont@exemple.fr',
  '',
  '### Évaluation par critère',
  '- ✅ Consultant MOA — satisfait · « Consultant SI & AMOA »',
  '',
  '## Marie Martin — 81/100 — Retenu',
  'Fichier : `CV-Martin.pdf`',
  'Email : marie.martin@exemple.fr',
  '',
  '### Évaluation par critère',
  '- ✅ Consultant MOA — satisfait · « MOA depuis 2018 »',
  '',
  '## Ana Ruiz — 41/100 — Écarté',
  'Email : ana.ruiz@exemple.fr',
  '',
].join('\n');

describe('stripCandidateSections', () => {
  it('retire la section du candidat et GARDE celles des autres', () => {
    const out = stripCandidateSections(REPORT, fp, MARKER);
    expect(out.removed).toBe(1);
    expect(out.remaining).toBe(2);
    expect(out.content).not.toContain('Jean');
    expect(out.content).not.toContain('jean.dupont@exemple.fr');
    expect(out.content).not.toContain('Consultant SI & AMOA');
    expect(out.content).toContain('Marie Martin — 81/100');
    expect(out.content).toContain('MOA depuis 2018');
    expect(out.content).toContain('Ana Ruiz');
  });

  it('conserve l’en-tête du lot — ses compteurs restent vrais', () => {
    const out = stripCandidateSections(REPORT, fp, MARKER);
    expect(out.content).toContain('Reçus : 3 · Retenus : 2');
  });

  it('coupe sur les titres de niveau 2, jamais sur les sous-titres', () => {
    // `### Évaluation par critère` appartient à la section du candidat : s'il
    // faisait frontière, l'évaluation de Jean — citations du CV comprises —
    // survivrait à son effacement. Le rapport en compte deux (Jean, Marie) :
    // il n'en reste qu'un, et c'est celui de Marie.
    const out = stripCandidateSections(REPORT, fp, MARKER);
    expect(out.content.match(/^### /gmu)?.length).toBe(1);
    expect(out.content).toContain('MOA depuis 2018');
    expect(out.content).not.toContain('Consultant SI & AMOA');
  });

  it('signale un rapport devenu vide — l’appelant supprime le fichier', () => {
    const solo = ['# Analyse', '', '## Jean Dupont — 72/100', 'jean.dupont@exemple.fr'].join('\n');
    const out = stripCandidateSections(solo, fp, MARKER);
    expect(out.remaining).toBe(0);
  });

  it('caviarde le candidat s’il est nommé dans l’en-tête', () => {
    const withHead = REPORT.replace('Reçus : 3', 'Dont Jean Dupont · Reçus : 3');
    const out = stripCandidateSections(withHead, fp, MARKER);
    expect(out.content).not.toContain('Jean');
    expect(out.content).toContain('Reçus : 3');
  });
});
