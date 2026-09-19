/**
 * Structuration d'une transcription d'entretien en compte rendu — UN appel au
 * modèle. SERVEUR UNIQUEMENT. Spec : docs/specs/compte-rendu-entretien.md §5.3.
 *
 * Le modèle RESTITUE et ORGANISE ; il ne juge jamais. Les garanties ne reposent
 * pas sur sa bonne volonté : le schéma de sortie n'a aucun champ où poser un
 * score (`StructuringOutputSchema`, strict), et chaque citation est ensuite
 * vérifiée mot pour mot (`checkAndRender`).
 *
 * Fournisseur : le même routage que l'analyse des CV (`CV_ANALYZER_PROVIDER`) —
 * c'est ce qui rend vraie la phrase « le texte transite par le fournisseur de
 * modèle, comme les CV » (§14.4).
 *
 * Budget de temps : 2 tentatives de validation (D4) × 25 s, sans réessai de
 * transport, sous une route bornée à 60 s. Une coupure ne laisse rien derrière
 * elle : aucune écriture ne précède l'appel.
 */

import { chatCompleteJson } from '@/lib/ai/provider';
import { renderTurns, type NormalizedTranscript } from '@/lib/transcript/normalize';
import {
  MAX_QUOTE_CHARS,
  MIN_QUOTE_CHARS,
  StructuringOutputSchema,
  type StructuringOutput,
} from '@/lib/transcript/structure';
import type { ReportCriterionPrompt } from '@/types/interview-report';

/** Sous-chaîne STABLE du prompt système (routage du mock de régression). */
export const STRUCTURING_SYSTEM_MARKER =
  "Tu structures le compte rendu d'un entretien de recrutement";

export const STRUCTURING_BUDGET = {
  maxAttempts: 2,
  timeoutMs: 25_000,
  maxTransportRetries: 0,
} as const;

export function buildStructuringMessages(args: {
  transcript: NormalizedTranscript;
  criteria: ReportCriterionPrompt[];
  candidateSpeaker: string | null;
}): { role: 'system' | 'user'; content: string }[] {
  const { transcript, criteria, candidateSpeaker } = args;
  const who =
    candidateSpeaker !== null
      ? `Le candidat est le locuteur « ${candidateSpeaker} ». Les autres locuteurs sont les recruteurs.`
      : transcript.speakers.length === 0
        ? "La transcription n'identifie pas les locuteurs : n'attribue AUCUN propos (speaker = null), dis « au cours de l'échange »."
        : `Un seul locuteur est identifié (« ${transcript.speakers[0]} ») : n'infère pas qui est le candidat.`;

  const system = [
    `${STRUCTURING_SYSTEM_MARKER} à partir de sa transcription. Tu RESTITUES et tu ORGANISES ; tu ne JUGES JAMAIS.`,
    '',
    'Règles, toutes obligatoires :',
    '1. Aucun avis, aucune note, aucun score, aucune recommandation, aucun adjectif appréciatif qui ne soit pas une citation. Jamais « bon profil », « candidat solide », « excellent », « à retenir ».',
    `2. Chaque élément porte : \`text\` — une restitution NEUTRE au style indirect (« Le candidat indique… », « Le recruteur demande… ») ; \`quote\` — une citation COPIÉE MOT POUR MOT de la transcription, de ${MIN_QUOTE_CHARS} à ${MAX_QUOTE_CHARS} caractères, qui prouve la restitution ; \`speaker\` — le locuteur tel qu'écrit dans la transcription, ou null ; \`at\` — l'horodatage du tour tel qu'écrit, ou null. Une citation qui n'est pas mot pour mot sera SUPPRIMÉE.`,
    '3. Rubriques : `topics` = sujets abordés ; `criteria` = pour CHAQUE critère fourni (même identifiant), `addressed` vrai si le sujet a été abordé, avec ce que le candidat en a dit, faux sinon — jamais « non satisfait » ; `highlights` = ce que le CANDIDAT a lui-même mis en avant ; `reservations` = les réserves EXPRIMÉES pendant l’entretien, par la personne qui les a exprimées ; `followUps` = les points restés sans réponse, à vérifier lors d’un prochain échange.',
    '4. EXCLUS tout passage sans lien direct avec le poste : santé, handicap, grossesse, situation familiale, origine, religion, opinions politiques ou syndicales, vie privée. Ne les restitue pas, ne les cite pas ; compte-les dans `omittedCount`.',
    `5. ${who}`,
    '6. Une rubrique sans matière reste vide. N’invente rien, ne complète rien.',
    'Réponds UNIQUEMENT en JSON strictement conforme au schéma demandé.',
  ].join('\n');

  const criteriaBlock =
    criteria.length > 0
      ? criteria.map((c) => `- ${c.criterionId} — ${c.label}`).join('\n')
      : '(aucun critère fourni : laisse `criteria` vide)';

  const user = [
    'Critères de la campagne (libellés seuls) :',
    criteriaBlock,
    '',
    'Transcription :',
    renderTurns(transcript.turns),
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export async function structureTranscript(args: {
  transcript: NormalizedTranscript;
  criteria: ReportCriterionPrompt[];
  candidateSpeaker: string | null;
}): Promise<{ output: StructuringOutput; model: string; durationMs: number }> {
  const result = await chatCompleteJson(buildStructuringMessages(args), StructuringOutputSchema, {
    ...STRUCTURING_BUDGET,
    temperature: 0,
    maxTokens: 4000,
  });
  return { output: result.data, model: result.raw.model, durationMs: result.raw.durationMs };
}
