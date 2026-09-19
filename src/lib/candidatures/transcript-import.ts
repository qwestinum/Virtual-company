/**
 * Import d'une transcription d'entretien → compte rendu PROPOSÉ (brouillon).
 * SERVEUR. Spec : docs/specs/compte-rendu-entretien.md §5, §14.3, §14.4.
 *
 * ─── ORQA NE CONSERVE AUCUNE TRANSCRIPTION ────────────────────────────────
 * La transcription est un intrant JETABLE. Elle vit dans des variables locales
 * de cette fonction, le temps d'UN appel au modèle et des contrôles, puis sort
 * de portée — en cas de succès comme d'échec. Concrètement :
 *   - aucun fichier temporaire (le fichier reste en mémoire : `File`) ;
 *   - aucune écriture avant la fin des contrôles — un échec n'écrit RIEN ;
 *   - le journal ne porte que des compteurs, jamais un extrait ;
 *   - les erreurs ne sont JAMAIS recopiées (`err.message` de `JSON.parse` ou de
 *     Zod cite le texte fautif) : on consigne la CLASSE d'erreur, rien d'autre ;
 *   - la réponse ne rend que le compte rendu proposé (citations courtes
 *     vérifiées) et les noms des locuteurs quand il faut désigner le candidat.
 * Hors ORQA, et c'est dit au DPO (§14.4) : le texte transite par le
 * fournisseur de modèle, qui peut le conserver jusqu'à 30 jours, comme les CV.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { extractCVText } from '@/lib/agents/cv-extract';
import { structureTranscript } from '@/lib/agents/interview-report-structuring';
import { interviewHappened, loadCriterionPrompts } from '@/lib/candidatures/interview-report';
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { getInterviewReport, saveInterviewReport } from '@/lib/db/repos/interview-reports';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { normalizeTranscript } from '@/lib/transcript/normalize';
import { checkAndRender, type StructuringStats } from '@/lib/transcript/structure';
import type { HumanDecider } from '@/types/hitl';
import { importStillPossible, type InterviewReport } from '@/types/interview-report';
import type { CandidateAnalysisSummary } from '@/types/reporting';

export const INTERVIEW_REPORT_GENERATED_ACTION = 'interview_report_generated';
/** Très au-dessus d'une heure de VTT, sous la limite de corps Vercel (4,5 Mo). */
export const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
/** ~50 000 tokens, environ trois heures d'entretien. Au-delà : refus, jamais de troncature. */
export const MAX_TRANSCRIPT_CHARS = 200_000;

const TEXT_EXT = /\.(vtt|srt|txt)$/iu;
const DOC_EXT = /\.(docx|pdf)$/iu;

export type TranscriptImportOutcome =
  | { status: 'proposed'; report: InterviewReport; stats: StructuringStats }
  | { status: 'choose_speaker'; speakers: string[] }
  | {
      status:
        | 'disabled'
        | 'interview_not_realized'
        | 'report_exists'
        | 'unsupported_format'
        | 'too_large'
        | 'too_long'
        | 'empty'
        | 'too_much_quoted'
        | 'generation_failed';
    };

/** Réglage de l'installation. Illisible ⇒ ÉTEINT (fail-closed : c'est un choix DPO). */
async function importEnabled(): Promise<boolean> {
  try {
    const settings = await getAppSettings();
    return settings?.interviewConfig.transcriptImportEnabled ?? true;
  } catch {
    return false;
  }
}

async function readTranscriptText(file: File): Promise<string | null> {
  const name = file.name.toLowerCase();
  if (TEXT_EXT.test(name) || file.type.startsWith('text/')) return file.text();
  if (DOC_EXT.test(name)) return (await extractCVText(file)).text;
  return null;
}

export async function importTranscript(args: {
  analysis: Pick<CandidateAnalysisSummary, 'id' | 'uid' | 'campaignId'>;
  file: File;
  candidateSpeaker: string | null;
  actor: HumanDecider | null;
}): Promise<TranscriptImportOutcome> {
  const { analysis, file, actor } = args;
  if (!(await importEnabled())) return { status: 'disabled' };
  if (file.size > MAX_TRANSCRIPT_BYTES) return { status: 'too_large' };
  if (!(await interviewHappened(analysis))) return { status: 'interview_not_realized' };
  // Une proposition ne recouvre jamais un texte écrit ni un compte rendu
  // validé : on ne jette pas le travail de quelqu'un. Un brouillon VIDE, lui,
  // ne contient rien à perdre (« Enregistrer le brouillon » cliqué à vide).
  if (!importStillPossible(await getInterviewReport(analysis.id))) {
    return { status: 'report_exists' };
  }

  let raw: string | null;
  try {
    raw = await readTranscriptText(file);
  } catch {
    return { status: 'unsupported_format' };
  }
  if (raw === null) return { status: 'unsupported_format' };

  const transcript = normalizeTranscript(raw);
  if (transcript.plainText.trim() === '') return { status: 'empty' };
  if (transcript.plainText.length > MAX_TRANSCRIPT_CHARS) return { status: 'too_long' };

  // Le modèle ne devine pas qui est le candidat : s'il y a plusieurs
  // locuteurs, l'humain le désigne. Rien n'a été envoyé ni écrit.
  const candidateSpeaker =
    args.candidateSpeaker && transcript.speakers.includes(args.candidateSpeaker)
      ? args.candidateSpeaker
      : null;
  if (transcript.speakers.length >= 2 && candidateSpeaker === null) {
    return { status: 'choose_speaker', speakers: transcript.speakers };
  }

  const criteria = await loadCriterionPrompts(analysis.campaignId);
  let structured: Awaited<ReturnType<typeof structureTranscript>>;
  try {
    structured = await structureTranscript({ transcript, criteria, candidateSpeaker });
  } catch (err) {
    // La CLASSE seule : un message de `JSON.parse`/Zod cite le texte fautif.
    console.error('[transcript-import] génération non aboutie', err instanceof Error ? err.name : 'unknown');
    return { status: 'generation_failed' };
  }

  const checked = checkAndRender(structured.output, transcript, criteria);
  if (!checked.ok) return { status: checked.reason };

  const saved = await saveInterviewReport({
    analysisId: analysis.id,
    uid: analysis.uid,
    campaignId: analysis.campaignId,
    source: 'transcript',
    sections: checked.sections,
    action: 'draft',
    actor,
    generatedModel: structured.model,
    omittedCount: checked.stats.omittedCount,
  });
  if (saved.status !== 'saved') return { status: 'report_exists' };

  await appendJournalEntry({
    action: INTERVIEW_REPORT_GENERATED_ACTION,
    campaignId: analysis.campaignId,
    actor: 'user',
    // Des COMPTEURS, jamais un extrait.
    payload: {
      uid: analysis.uid,
      analysisId: analysis.id,
      reportId: saved.report.id,
      transcriptChars: transcript.plainText.length,
      turns: transcript.turns.length,
      speakers: transcript.speakers.length,
      quotesKept: checked.stats.kept,
      quotesRemoved: checked.stats.removedUnproven,
      flagged: checked.stats.flagged,
      omittedCount: checked.stats.omittedCount,
      model: structured.model,
      durationMs: structured.durationMs,
      actorUserId: actor?.userId ?? null,
      actorEmail: actor?.email ?? null,
    },
  }).catch((err) =>
    console.error('[transcript-import] trace de journal non écrite', err instanceof Error ? err.name : 'unknown'),
  );

  return { status: 'proposed', report: saved.report, stats: checked.stats };
}
