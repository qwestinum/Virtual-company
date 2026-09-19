/**
 * POST /api/candidatures/[id]/interview-report/transcript — propose un compte
 * rendu (brouillon) à partir d'une transcription importée.
 * Spec : docs/specs/compte-rendu-entretien.md §5, §14.
 *
 * Multipart : `file` (.vtt .srt .txt .docx .pdf, 2 Mo), `candidateSpeaker`
 * (facultatif — requis quand la transcription a plusieurs locuteurs).
 *
 * ⚠️ ORQA NE CONSERVE AUCUNE TRANSCRIPTION : elle est lue en mémoire le temps
 * d'un appel au modèle, puis abandonnée — y compris en cas d'échec, où RIEN
 * n'est écrit. Les messages d'erreur sont génériques : jamais `err.message`.
 *
 *   200 { report, stats }               — brouillon proposé, à vérifier
 *   422 { error: 'choose_speaker', speakers } — désigner le candidat, renvoyer
 *   403 transcript_import_disabled       — réglage de l'installation
 *   409 interview_not_realized | report_exists
 *   413 too_large | too_long
 *   400 unsupported_format | empty | too_much_quoted
 *   502 generation_failed                — réimporter
 */
import { NextResponse } from 'next/server';

import { getApiUser } from '@/lib/auth/require-api-user';
import { importTranscript } from '@/lib/candidatures/transcript-import';
import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';
// 2 tentatives × 25 s au plus pour le modèle (STRUCTURING_BUDGET), plus la
// lecture et l'écriture : sous l'enveloppe de 60 s.
export const maxDuration = 60;

const MESSAGES: Record<string, string> = {
  transcript_import_disabled: 'L’import de transcription est désactivé pour cette installation.',
  interview_not_realized: 'L’entretien n’est pas marqué « réalisé » : il n’y a pas encore de compte rendu à proposer.',
  report_exists: 'Un compte rendu existe déjà pour cet entretien : modifiez-le plutôt que d’en importer un autre.',
  too_large: 'Fichier trop volumineux (2 Mo au plus).',
  too_long: 'Transcription trop longue pour être traitée d’un seul tenant (environ trois heures au plus).',
  unsupported_format: 'Format non reconnu. Formats acceptés : .vtt, .srt, .txt, .docx, .pdf.',
  empty: 'La transcription ne contient aucun texte exploitable.',
  too_much_quoted: 'La proposition reprenait trop largement la transcription : elle n’a pas été retenue. Rédigez le compte rendu, ou réimportez.',
  generation_failed: 'La génération n’a pas abouti. Rien n’a été enregistré. Réimportez la transcription.',
};

function refusal(error: string, status: number): NextResponse {
  return NextResponse.json({ error, message: MESSAGES[error] ?? 'Import impossible.' }, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refusal('unsupported_format', 400);
  }
  const file = form.get('file');
  if (!(file instanceof File)) return refusal('unsupported_format', 400);
  const speaker = form.get('candidateSpeaker');

  const userP = getApiUser();
  void userP.catch(() => undefined);
  try {
    const analysis = await getCandidateAnalysis(id);
    if (!analysis) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const user = await userP;
    const outcome = await importTranscript({
      analysis,
      file,
      candidateSpeaker: typeof speaker === 'string' && speaker !== '' ? speaker : null,
      actor: user ? { userId: user.id, email: user.email ?? null } : null,
    });
    switch (outcome.status) {
      case 'proposed':
        return NextResponse.json({ report: outcome.report, stats: outcome.stats });
      case 'choose_speaker':
        return NextResponse.json({ error: 'choose_speaker', speakers: outcome.speakers }, { status: 422 });
      case 'disabled':
        return refusal('transcript_import_disabled', 403);
      case 'interview_not_realized':
      case 'report_exists':
        return refusal(outcome.status, 409);
      case 'too_large':
      case 'too_long':
        return refusal(outcome.status, 413);
      case 'unsupported_format':
      case 'empty':
      case 'too_much_quoted':
        return refusal(outcome.status, 400);
      case 'generation_failed':
        return refusal(outcome.status, 502);
      default: {
        const never: never = outcome;
        throw new Error(`Issue non traitée : ${JSON.stringify(never)}`);
      }
    }
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    // Jamais `err.message` : il pourrait citer le texte en cours de traitement.
    console.error('[transcript-import] échec', err instanceof Error ? err.name : 'unknown');
    return refusal('generation_failed', 500);
  }
}
