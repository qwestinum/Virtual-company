import { describe, expect, it } from 'vitest';

import {
  type CampaignPrefill,
  CampaignPrefillSchema,
  normalizeContractType,
  normalizeRawPrefill,
  normalizeSeniority,
  normalizeSuggestableLevel,
  prefillSourceByField,
  prefillToFDP,
  prefillToSuggestedCriteria,
  RawCampaignPrefillSchema,
  SUGGESTABLE_LEVELS,
} from '@/types/campaign-prefill';
import {
  countUntreatedSuggestions,
  criterionBehavior,
  DEFAULT_WEIGHTS,
} from '@/types/scoring';

describe('SUGGESTABLE_LEVELS', () => {
  it('ne contient QUE des niveaux non éliminatoires (SOFT_WEIGHTED)', () => {
    // Garde-fou : aucune suggestion IA ne peut porter un flag éliminatoire
    // (redhibitoire/obligatoire = knockout/cap, saisie 100% humaine).
    for (const level of SUGGESTABLE_LEVELS) {
      expect(criterionBehavior(level)).toBe('SOFT_WEIGHTED');
    }
  });
});

function emptyText() {
  return { value: null, extraitSource: null };
}
function emptyList() {
  return { value: null, extraitSource: null };
}

function makePrefill(overrides: Partial<CampaignPrefill> = {}): CampaignPrefill {
  return {
    jobTitle: emptyText(),
    contractType: emptyText(),
    location: emptyText(),
    salaryRange: emptyText(),
    seniority: emptyText(),
    startDate: emptyText(),
    mainMissions: emptyList(),
    keySkills: emptyList(),
    suggestedCriteria: [],
    ...overrides,
  };
}

describe('normalizeSeniority', () => {
  it('mappe les phrasings courants vers les options exactes', () => {
    expect(normalizeSeniority('Junior')).toBe('junior');
    expect(normalizeSeniority('profil débutant')).toBe('junior');
    expect(normalizeSeniority('expérimenté')).toBe('senior');
    expect(normalizeSeniority('Lead developer')).toBe('senior');
    expect(normalizeSeniority('confirmé')).toBe('confirmé');
    expect(normalizeSeniority('intermédiaire')).toBe('confirmé');
  });
  it('renvoie null quand rien de confiant (jamais de valeur non sélectionnable)', () => {
    expect(normalizeSeniority(null)).toBeNull();
    expect(normalizeSeniority('   ')).toBeNull();
    expect(normalizeSeniority('peu importe')).toBeNull();
  });
});

describe('normalizeContractType', () => {
  it('mappe vers les options exactes', () => {
    expect(normalizeContractType('CDI')).toBe('CDI');
    expect(normalizeContractType('un CDD de 6 mois')).toBe('CDD');
    expect(normalizeContractType('mission freelance')).toBe('freelance');
    expect(normalizeContractType('portage salarial')).toBe('freelance');
    expect(normalizeContractType('stage de fin d’études')).toBe('stage');
    // Options ajoutées (match exact) : reconnues désormais.
    expect(normalizeContractType('alternance')).toBe('alternance');
    expect(normalizeContractType('intérim')).toBe('intérim');
  });
  it('renvoie null si non reconnu', () => {
    expect(normalizeContractType(null)).toBeNull();
    expect(normalizeContractType('bénévolat')).toBeNull();
  });
});

describe('prefillToFDP', () => {
  it('remplit les champs présents et laisse les absents vides', () => {
    const prefill = makePrefill({
      jobTitle: { value: 'Comptable', extraitSource: 'Poste : Comptable' },
      location: { value: 'Lyon', extraitSource: null },
      mainMissions: { value: ['Saisie', '  ', 'Clôture'], extraitSource: null },
      contractType: { value: 'CDI 39h', extraitSource: null },
      seniority: { value: 'temps plein', extraitSource: null },
    });
    const fdp = prefillToFDP(prefill, 'CAMP-0001');

    expect(fdp.campaignId).toBe('CAMP-0001');
    expect(fdp.fields.job_title.status).toBe('filled');
    expect(fdp.fields.job_title.value).toBe('Comptable');
    expect(fdp.fields.location.value).toBe('Lyon');
    // Liste nettoyée (vides retirés).
    expect(fdp.fields.main_missions.value).toEqual(['Saisie', 'Clôture']);
    // Contrat normalisé, écrit en LISTE à 1 élément (champ multi-valeur).
    expect(fdp.fields.contract_type.value).toEqual(['CDI']);
    // Séniorité non reconnue → champ laissé vide (non sélectionnable évité).
    expect(fdp.fields.seniority.status).toBe('empty');
    // Champs absents : vides.
    expect(fdp.fields.salary_range.status).toBe('empty');
    expect(fdp.fields.key_skills.status).toBe('empty');
    // Aucune validation auto.
    expect(fdp.isValidated).toBe(false);
  });

  it('ignore les valeurs vides ou whitespace', () => {
    const prefill = makePrefill({
      jobTitle: { value: '   ', extraitSource: null },
      keySkills: { value: ['', '  '], extraitSource: null },
    });
    const fdp = prefillToFDP(prefill, 'CAMP-0002');
    expect(fdp.fields.job_title.status).toBe('empty');
    expect(fdp.fields.key_skills.status).toBe('empty');
  });
});

describe('prefillToSuggestedCriteria', () => {
  it('construit des critères suggere:true avec poids dérivé du niveau', () => {
    const prefill = makePrefill({
      suggestedCriteria: [
        { label: 'Management', level: 'critique', extraitSource: 'encadre 5 pers.' },
        { label: 'Anglais', level: 'souhaitable', extraitSource: null },
      ],
    });
    const criteria = prefillToSuggestedCriteria(prefill);
    expect(criteria).toHaveLength(2);
    expect(criteria[0]).toMatchObject({
      id: 'sugg-1',
      label: 'Management',
      level: 'critique',
      weight: DEFAULT_WEIGHTS.critique,
      suggere: true,
    });
    expect(criteria[1].suggere).toBe(true);
    // Le garde-fou compte bien 2 suggestions non traitées.
    expect(
      countUntreatedSuggestions({
        campaignId: 'CAMP-0003',
        criteria,
        isValidated: false,
      }),
    ).toBe(2);
  });

  it('liste vide → aucun critère, aucun blocage', () => {
    expect(prefillToSuggestedCriteria(makePrefill())).toEqual([]);
  });
});

describe('normalizeSuggestableLevel', () => {
  it('mappe les formulations libres vers les niveaux suggérables', () => {
    expect(normalizeSuggestableLevel('critique')).toBe('critique');
    expect(normalizeSuggestableLevel('Très important')).toBe('tres_important');
    expect(normalizeSuggestableLevel('tres important')).toBe('tres_important');
    expect(normalizeSuggestableLevel('élevé')).toBe('tres_important');
    expect(normalizeSuggestableLevel('Important')).toBe('important');
    expect(normalizeSuggestableLevel('moyen')).toBe('important');
    expect(normalizeSuggestableLevel('souhaitable')).toBe('souhaitable');
    expect(normalizeSuggestableLevel('nice to have')).toBe('souhaitable');
  });
  it('hisse les formulations éliminatoires au plus haut suggérable (jamais éliminatoire)', () => {
    expect(normalizeSuggestableLevel('obligatoire')).toBe('critique');
    expect(normalizeSuggestableLevel('rédhibitoire')).toBe('critique');
    expect(normalizeSuggestableLevel('impératif')).toBe('critique');
    expect(normalizeSuggestableLevel('must have')).toBe('critique');
  });
  it('inconnu / vide → null (écarté, jamais inventé)', () => {
    expect(normalizeSuggestableLevel('')).toBeNull();
    expect(normalizeSuggestableLevel('bleu')).toBeNull();
  });
});

describe('normalizeRawPrefill (tolérance LLM)', () => {
  it('accepte une sortie partielle / niveaux hors enum et produit un CampaignPrefill valide', () => {
    // Champs omis, niveaux en langage libre, un critère sans label → filtré.
    const raw = RawCampaignPrefillSchema.parse({
      jobTitle: { value: 'Comptable', extraitSource: 'Poste : Comptable' },
      // contractType, location, etc. OMIS → défauts vides
      suggestedCriteria: [
        { label: 'Management', level: 'très important', extraitSource: 'encadre 5' },
        { label: 'Rigueur', level: 'obligatoire', extraitSource: null }, // → critique
        { label: '', level: 'critique', extraitSource: null }, // label vide → écarté
        { label: 'X', level: 'bleu', extraitSource: null }, // niveau inconnu → écarté
      ],
    });
    const prefill = normalizeRawPrefill(raw);
    // Sortie conforme au schéma STRICT.
    expect(CampaignPrefillSchema.safeParse(prefill).success).toBe(true);
    expect(prefill.jobTitle.value).toBe('Comptable');
    expect(prefill.contractType.value).toBeNull();
    expect(prefill.suggestedCriteria).toHaveLength(2);
    expect(prefill.suggestedCriteria[0]).toMatchObject({
      label: 'Management',
      level: 'tres_important',
    });
    expect(prefill.suggestedCriteria[1]).toMatchObject({
      label: 'Rigueur',
      level: 'critique',
    });
  });

  it('objet quasi vide → tous champs nuls, aucune suggestion', () => {
    const raw = RawCampaignPrefillSchema.parse({});
    const prefill = normalizeRawPrefill(raw);
    expect(CampaignPrefillSchema.safeParse(prefill).success).toBe(true);
    expect(prefill.jobTitle.value).toBeNull();
    expect(prefill.suggestedCriteria).toEqual([]);
  });
});

describe('prefillSourceByField', () => {
  it('capte les extraits source non vides par champ', () => {
    const prefill = makePrefill({
      jobTitle: { value: 'Comptable', extraitSource: 'Poste : Comptable' },
      location: { value: 'Lyon', extraitSource: '   ' },
    });
    const sources = prefillSourceByField(prefill);
    expect(sources.job_title).toBe('Poste : Comptable');
    // Source whitespace ignorée.
    expect(sources.location).toBeUndefined();
  });
});
