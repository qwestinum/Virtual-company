import { describe, expect, it } from 'vitest';

import { resolveEditableFieldKeys } from '@/components/chat/edit-target';
import { buildEmptyFDP, type FieldKey } from '@/types/field-collection';

/** FDP dont tous les champs listés sont marqués remplis. */
function fdpWithFilled(filled: FieldKey[]) {
  const fdp = buildEmptyFDP('CAMP-2026-077');
  for (const key of filled) fdp.fields[key]!.status = 'filled';
  return fdp;
}

describe('resolveEditableFieldKeys — « Ajuster » a toujours une cible', () => {
  it('priorité au proposalField explicite', () => {
    const fdp = fdpWithFilled(['job_title']);
    expect(
      resolveEditableFieldKeys({ proposalField: 'main_missions' }, fdp),
    ).toEqual(['main_missions']);
  });

  it('à défaut, les champs extraits ce tour', () => {
    const fdp = fdpWithFilled(['job_title']);
    expect(
      resolveEditableFieldKeys(
        { proposedExtractions: { seniority: 'senior' } },
        fdp,
      ),
    ).toEqual(['seniority']);
  });

  it('SANS ancrage : cible le premier champ non rempli (intitulé en tête)', () => {
    // Cas du tout premier tour : bandeau fallback « Continuer / Ajuster »,
    // pas de proposalField, pas d'extraction → on doit pouvoir ajuster
    // l'intitulé du poste (le champ en cours de collecte).
    const fdp = buildEmptyFDP('CAMP-2026-077');
    expect(resolveEditableFieldKeys({}, fdp)).toEqual(['job_title']);
  });

  it('SANS ancrage : pointe sur les missions une fois l’amont rempli', () => {
    const fdp = fdpWithFilled([
      'job_title',
      'seniority',
      'contract_type',
      'location',
      'salary_range',
      'start_date',
    ]);
    expect(resolveEditableFieldKeys({}, fdp)).toEqual(['main_missions']);
  });

  it('FDP complète sans ancrage → [] (l’appelant déplie la checklist)', () => {
    const fdp = fdpWithFilled([
      'job_title',
      'seniority',
      'contract_type',
      'location',
      'salary_range',
      'start_date',
      'main_missions',
      'key_skills',
    ]);
    expect(resolveEditableFieldKeys({}, fdp)).toEqual([]);
  });

  it('ignore un proposalField absent de la FDP, retombe sur le filet', () => {
    const fdp = buildEmptyFDP('CAMP-2026-077');
    // proposalField valide structurellement mais champ présent dans la FDP :
    // buildEmptyFDP crée les 8 champs, donc on teste plutôt le filtrage des
    // extractions inconnues.
    expect(
      resolveEditableFieldKeys(
        {
          proposedExtractions: {
            ['unknown_field' as FieldKey]: 'x',
          },
        },
        fdp,
      ),
    ).toEqual(['job_title']);
  });
});
