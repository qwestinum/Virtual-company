/**
 * Prompts du proposeur de fiche de poste (création directe d'une campagne).
 *
 * À partir du seul intitulé du poste (et éventuellement de quelques champs déjà
 * saisis), le LLM propose une valeur CONCRÈTE et PLAUSIBLE pour chaque champ
 * manquant de la fiche — l'équivalent batch du « MODE PROPOSITION » du chat
 * Manager (cf. manager-prompts.ts), pour donner au DRH une fiche de départ
 * ajustable plutôt qu'un formulaire vierge.
 *
 * Le LLM ne sort PAS l'intitulé (fixé par le DRH) et respecte les énums.
 */

import { FIELD_LABELS, type FieldKey } from '@/types/field-collection';

export function buildFdpProposalSystemPrompt(): string {
  return [
    "Tu es le Manager RH virtuel QWESTINUM. À partir d'un intitulé de poste, tu proposes une fiche de poste de DÉPART : une valeur concrète et plausible pour chaque champ, que le donneur d'ordre ajustera ensuite.",
    '',
    '── PRINCIPE ──',
    "Propose des valeurs RÉALISTES pour le marché français, cohérentes avec l'intitulé et le niveau de séniorité. Ne reste jamais vague (« à définir », « selon profil ») : propose une valeur exploitable que le DRH pourra corriger.",
    "N'invente pas de contexte d'entreprise spécifique (nom, secteur précis) si l'intitulé ne le donne pas — reste générique mais concret.",
    '',
    '── CHAMPS À PROPOSER ──',
    '- "seniority" : EXACTEMENT une de ces valeurs — "junior", "confirmé", "senior".',
    '- "contract_type" : EXACTEMENT une de ces valeurs — "CDI", "CDD", "freelance", "stage". Défaut raisonnable : "CDI".',
    '- "location" : une ville/zone plausible (ex. "Paris", "Lyon", "Télétravail partiel").',
    '- "salary_range" : une FOURCHETTE brute annuelle cohérente avec le poste et la séniorité (ex. "45-55K bruts annuels").',
    '- "start_date" : une date cible plausible exprimée simplement (ex. "Dès que possible", "1er septembre 2026").',
    '- "main_missions" : une LISTE de 3 à 6 missions principales concrètes (chaînes courtes).',
    '- "key_skills" : une LISTE de 3 à 6 compétences clés concrètes (chaînes courtes).',
    "Ne propose PAS \"job_title\" (il est fixé par le donneur d'ordre).",
    '',
    '── EXEMPLE ──',
    'Intitulé : "Comptable senior".',
    'Sortie attendue :',
    '{',
    '  "fields": {',
    '    "seniority": "senior",',
    '    "contract_type": "CDI",',
    '    "location": "Paris",',
    '    "salary_range": "50-65K bruts annuels",',
    '    "start_date": "Dès que possible",',
    '    "main_missions": ["Tenue de la comptabilité générale", "Clôtures mensuelles et annuelles", "Déclarations fiscales", "Supervision des comptables juniors"],',
    '    "key_skills": ["Maîtrise des normes IFRS", "Consolidation", "ERP (SAP/Oracle)", "Excel avancé", "Anglais professionnel"]',
    '  }',
    '}',
    '',
    '── FORMAT DE SORTIE STRICT (JSON UNIQUEMENT) ──',
    '{ "fields": { "seniority": "…", "contract_type": "…", "location": "…", "salary_range": "…", "start_date": "…", "main_missions": ["…"], "key_skills": ["…"] } }',
  ].join('\n');
}

/**
 * Construit le prompt utilisateur : l'intitulé + les champs déjà renseignés (pour
 * que la proposition reste cohérente avec ce que le DRH a déjà saisi).
 */
export function buildFdpProposalUserPrompt(
  jobTitle: string,
  known?: Partial<Record<FieldKey, unknown>>,
): string {
  const lines: string[] = [`Intitulé du poste : ${jobTitle}`];
  const knownEntries = Object.entries(known ?? {}).filter(
    ([key, value]) =>
      key !== 'job_title' && value != null && formatValue(value) !== '',
  );
  if (knownEntries.length > 0) {
    lines.push('', 'Champs déjà renseignés (à respecter, ne pas contredire) :');
    for (const [key, value] of knownEntries) {
      const label = FIELD_LABELS[key as FieldKey] ?? key;
      lines.push(`- ${label} : ${formatValue(value)}`);
    }
  }
  lines.push(
    '',
    'Propose les champs manquants de la fiche au format JSON demandé.',
  );
  return lines.join('\n');
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'string') return value.trim();
  return String(value);
}
