/**
 * Prompts système du Job Writer (Session 4).
 *
 * L'agent reçoit une FDP qualifiée (FDPInProgress) et produit une
 * annonce publique structurée en JSON. La sortie est convertie en
 * Markdown téléchargeable côté serveur (cf. lib/agents/job-writer-render.ts).
 *
 * Contrainte : le ton est professionnel chaleureux (cohérent avec la
 * voix Manager), inclusif, en français, sans emoji. Pas de promesses
 * non factuelles (cf. spec §4.3 : "n'invente jamais d'avantages").
 */

import { FIELD_LABELS, type FDPInProgress } from '@/types/field-collection';

export function buildJobAdSystemPrompt(): string {
  return [
    "Tu es le Job Writer du département RH virtuel QWESTINUM. Tu transformes une fiche de poste validée en annonce publique attractive, sincère et inclusive.",
    '',
    "Contraintes :",
    '- Français exclusif, sans emoji.',
    "- N'invente AUCUN avantage absent de la fiche (pas de tickets restaurant, pas de mutuelle, pas de jours RTT si non mentionnés).",
    "- Reprends fidèlement intitulé, séniorité, contrat, localisation, fourchette salariale, date de prise de poste, missions et compétences fournies.",
    "- Style : professionnel chaleureux, écriture inclusive (formes neutres ou doublets brefs).",
    "- Structure du body Markdown : un paragraphe d'accroche (2-3 phrases), une section ## Missions (bullets), une section ## Profil recherché (bullets), une section ## Conditions (contrat, localisation, fourchette, prise de poste, en bullets), une phrase de clôture ouvrant à la candidature.",
    "- 250 à 450 mots dans le body.",
    "- Tags : 4 à 8 mots-clés courts (1-3 mots chacun) pertinents pour les jobboards (ex. 'Comptabilité', 'Senior', 'Paris', 'CDI', 'IFRS').",
    '',
    "Sortie : JSON UNIQUEMENT, exactement ce schéma :",
    '{',
    '  "title": "<titre court de l\'annonce, ex. \\"Comptable senior — Paris (CDI)\\">",',
    '  "body": "<corps de l\'annonce en Markdown, sans entête title>",',
    '  "tags": ["<tag1>", "<tag2>", ...]',
    '}',
  ].join('\n');
}

export function buildJobAdUserPrompt(fdp: FDPInProgress): string {
  const lines: string[] = ['Voici la fiche de poste validée :', ''];
  for (const [key, field] of Object.entries(fdp.fields)) {
    const label = FIELD_LABELS[field.key] ?? key;
    const value = formatFieldValue(field.value);
    lines.push(`- ${label} : ${value}`);
  }
  lines.push('', 'Rédige l\'annonce publique au format JSON demandé.');
  return lines.join('\n');
}

function formatFieldValue(value: unknown): string {
  if (value === undefined || value === null) return '∅';
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
