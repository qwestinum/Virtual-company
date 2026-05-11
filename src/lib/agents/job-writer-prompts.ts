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
import type { PublicationChannel } from '@/types/publication-channel';

/**
 * Directives de ton/format par réseau. Sert à adapter le rendu de
 * l'annonce sans modifier la structure de sortie JSON. Chaque entrée
 * est ajoutée au prompt système entre les contraintes communes et
 * le schéma de sortie.
 */
const CHANNEL_INSTRUCTIONS: Record<PublicationChannel, string> = {
  linkedin: [
    '── ADAPTATION RÉSEAU — LinkedIn ──',
    "Ton plus engageant et personnel : tu t'adresses à la personne lectrice (« vous »).",
    "Accroche en 2-3 phrases qui donnent envie de poursuivre — pose un enjeu concret du poste, pas juste l'entreprise.",
    "Tags adaptés à LinkedIn (mots-clés métier + 1-2 hashtags-friendly, ex. 'Recrutement', 'Comptabilité').",
    "Évite le jargon RH générique (« opportunité unique », « équipe dynamique »).",
  ].join('\n'),
  indeed: [
    '── ADAPTATION RÉSEAU — Indeed ──',
    "Ton factuel et structuré, orienté ATS (Applicant Tracking System).",
    "L'accroche reste courte (1-2 phrases) — Indeed met en avant les détails structurés.",
    "Insiste sur les mots-clés métier dans le body ET les tags (skills, technologies, certifications).",
    "Conditions très lisibles en bullets nets (contrat, lieu, fourchette, date).",
  ].join('\n'),
  welcome_to_the_jungle: [
    '── ADAPTATION RÉSEAU — Welcome to the Jungle ──',
    "Ton storytelling : tu racontes le poste comme une histoire, avec le contexte de l'équipe et l'impact attendu.",
    "Accroche immersive (3-4 phrases) qui plante le décor — équipe, mission, ambition.",
    "Section ## Missions reformulée en « Ce que vous ferez au quotidien ».",
    "Section ## Profil recherché reformulée en « Ce qu'on espère trouver chez vous ».",
    "Section ## Conditions inchangée mais courte.",
    "Tags axés culture + métier (ex. 'Startup', 'Remote-friendly', 'Comptabilité').",
  ].join('\n'),
  apec: [
    '── ADAPTATION RÉSEAU — APEC ──',
    "Ton formel et professionnel, langage cadre. Vouvoiement strict.",
    "Accroche courte et neutre (2 phrases) sur l'entreprise et la fonction.",
    "Insiste sur l'expérience requise, le niveau de responsabilité, le périmètre managérial le cas échéant.",
    "Tags orientés famille de métier APEC (ex. 'Cadre confirmé', 'Comptabilité-Finance', 'Paris').",
  ].join('\n'),
  france_travail: [
    '── ADAPTATION RÉSEAU — France Travail ──',
    "Ton neutre, accessible, sans jargon. Phrases courtes.",
    "Évite les anglicismes inutiles — privilégie les équivalents français quand ils existent.",
    "Mentionne explicitement les pré-requis (diplôme, années d'expérience, permis le cas échéant).",
    "Tags grand public (ex. 'CDI', 'Comptable', 'Île-de-France').",
  ].join('\n'),
  generic: [
    '── ADAPTATION RÉSEAU — Annonce générique multi-réseaux ──',
    "Ton équilibré : suffisamment chaleureux pour LinkedIn/WTTJ et suffisamment structuré pour Indeed/APEC/France Travail.",
    "Reste neutre dans le vocabulaire — pas de hashtag, pas de storytelling poussé.",
    "Structure classique sans transformation des titres de section.",
  ].join('\n'),
};

export function buildJobAdSystemPrompt(
  channel: PublicationChannel = 'generic',
): string {
  return [
    "Tu es le Job Writer du département RH virtuel QWESTINUM. Tu transformes une fiche de poste validée en annonce publique attractive, sincère et inclusive.",
    '',
    "Contraintes communes :",
    '- Français exclusif, sans emoji.',
    "- N'invente AUCUN avantage absent de la fiche (pas de tickets restaurant, pas de mutuelle, pas de jours RTT si non mentionnés).",
    "- Reprends fidèlement intitulé, séniorité, contrat, localisation, fourchette salariale, date de prise de poste, missions et compétences fournies.",
    "- Style : professionnel chaleureux, écriture inclusive (formes neutres ou doublets brefs).",
    "- Structure du body Markdown : un paragraphe d'accroche (2-3 phrases), une section ## Missions (bullets), une section ## Profil recherché (bullets), une section ## Conditions (contrat, localisation, fourchette, prise de poste, en bullets), une phrase de clôture ouvrant à la candidature.",
    "- 250 à 450 mots dans le body.",
    "- Tags : 4 à 8 mots-clés courts (1-3 mots chacun) pertinents pour les jobboards (ex. 'Comptabilité', 'Senior', 'Paris', 'CDI', 'IFRS').",
    '',
    CHANNEL_INSTRUCTIONS[channel],
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
