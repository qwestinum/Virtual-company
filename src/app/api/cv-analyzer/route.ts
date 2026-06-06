import { NextResponse } from 'next/server';

import { CVExtractError, extractCVText } from '@/lib/agents/cv-extract';
import { analyzeCVApplication } from '@/lib/agents/server/cv-application-analyze';
import { resolveCandidateEmail } from '@/lib/agents/candidate-email';
import { ScoringError } from '@/lib/scoring';
import { AIProviderError } from '@/lib/ai/errors';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import {
  CVAnalysisCriteriaSchema,
  type CVApplication,
  DEFAULT_CV_THRESHOLD,
} from '@/types/cv-analysis';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Sécurité — limites sur l'upload CV.
 *   - MAX_BYTES : protège le serveur d'un upload massif (DoS via PDF
 *     de plusieurs centaines de Mo). 15 Mo couvre 95% des CV PDF
 *     réels sans pénaliser les profils avec portfolio intégré.
 *   - ACCEPTED_MIME : on accepte uniquement les formats raisonnables.
 *     Le prefix-match (startsWith) tolère les variantes type
 *     "application/pdf; charset=utf-8".
 */
const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED_MIME = [
  'application/pdf',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

export async function POST(request: Request): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Form data invalide.',
      },
      { status: 400 },
    );
  }

  const file = form.get('cv');
  const criteriaRaw = form.get('criteria');
  const thresholdRaw = form.get('threshold');
  const taskIdRaw = form.get('taskId');
  const campaignIdRaw = form.get('campaignId');

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Champ "cv" manquant.' },
      { status: 400 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json(
      { error: 'empty_cv', message: 'Le fichier CV est vide.' },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: 'cv_too_large',
        message: `Le CV dépasse la limite de ${Math.round(MAX_BYTES / (1024 * 1024))} Mo.`,
      },
      { status: 413 },
    );
  }
  if (file.type && !ACCEPTED_MIME.some((m) => file.type.startsWith(m))) {
    return NextResponse.json(
      {
        error: 'unsupported_mime',
        message: `Type de fichier non supporté : ${file.type}. Utilisez PDF, DOCX ou texte.`,
      },
      { status: 415 },
    );
  }

  let criteria;
  try {
    const parsed = criteriaRaw ? JSON.parse(String(criteriaRaw)) : {};
    criteria = CVAnalysisCriteriaSchema.parse(parsed);
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Critères invalides.',
      },
      { status: 400 },
    );
  }

  const threshold = (() => {
    const n = thresholdRaw ? Number(thresholdRaw) : NaN;
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
    return DEFAULT_CV_THRESHOLD;
  })();

  const taskId =
    typeof taskIdRaw === 'string' && taskIdRaw.length > 0
      ? taskIdRaw
      : `task_${Date.now().toString(36)}`;
  const campaignId =
    typeof campaignIdRaw === 'string' && campaignIdRaw.length > 0
      ? campaignIdRaw
      : undefined;

  // Garde « fiche de scoring obligatoire » (C6). Le nouveau pipeline score les
  // CV via une grille validée — pas d'analyse sans fiche. Le client
  // (dispatchCVBatch) joint `scoringSheet` quand elle est validée pour la
  // campagne ; en son absence on refuse proprement (le DRH doit valider la fiche).
  const sheet = criteria.scoringSheet;
  if (!sheet) {
    return NextResponse.json(
      {
        error: 'no_scoring_sheet',
        message:
          'Aucune fiche de scoring validée pour cette campagne — validez-la avant de lancer l’analyse des CV.',
      },
      { status: 422 },
    );
  }

  try {
    const extracted = await extractCVText(file);
    // Pipeline extraction → scoring (code) → narration. Le LLM ne note jamais.
    const { application, metrics } = await analyzeCVApplication({
      cvText: extracted.text,
      fileName: extracted.fileName,
      sheet,
      source: 'manual',
      receivedAt: new Date().toISOString(),
      acceptanceThreshold: threshold,
    });

    // L'email est déjà résolu déterministe dans analyzeCVApplication ; on
    // recalcule le STATUT de résolution pour le journal (compat dashboard).
    const emailResolution = resolveCandidateEmail(
      extracted.text,
      application.candidate.email,
    );

    // Trace le candidat dans le journal d'audit pour qu'il soit
    // comptabilisé au dashboard, comme un CV reçu par email. Sans ça,
    // les CV uploadés via le chat n'apparaissaient nulle part dans les
    // métriques (seul le poller IMAP journalisait). Best-effort : un
    // échec de journalisation ne casse pas la réponse d'analyse.
    await journalChatCV({
      uid: taskId,
      campaignId,
      emailStatus: emailResolution.status,
      fileName: extracted.fileName,
      application,
    });

    return NextResponse.json({
      application,
      threshold,
      metrics,
    });
  } catch (err) {
    if (err instanceof CVExtractError) {
      // pdf_engine_unavailable = défaillance serveur (polyfill PDF
      // manquant) → 503. Les autres = fichier client invalide → 422.
      const status = err.code === 'pdf_engine_unavailable' ? 503 : 422;
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status },
      );
    }
    if (err instanceof ScoringError) {
      // Fiche non scorable (aucun critère exploitable) → erreur métier client.
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 422 },
      );
    }
    if (err instanceof AIProviderError) {
      const status = err.code === 'config_missing' ? 500 : 502;
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status },
      );
    }
    return NextResponse.json(
      {
        error: 'unexpected_error',
        message: err instanceof Error ? err.message : 'Unexpected error.',
      },
      { status: 500 },
    );
  }
}

/**
 * Journalise un CV analysé via le chat avec les MÊMES actions que le
 * poller IMAP (`imap_cv_received` + `imap_cv_analyzed`), pour que le
 * dashboard le comptabilise sans changement de la dérivation des
 * métriques. Le champ `source: 'chat'` distingue l'origine si besoin.
 *
 * Note dette : le préfixe `imap_` est trompeur pour un upload chat —
 * conservé sciemment pour ne pas réécrire derive-metrics ni perdre
 * l'historique. Voir docs/BACKLOG.md.
 *
 * `uid` = taskId (unique par CV du lot, cf. manager-flow runCVBatch) :
 * c'est la clé d'unicité côté `journalToCandidatesList`.
 */
async function journalChatCV(args: {
  uid: string;
  campaignId: string | undefined;
  fileName: string;
  emailStatus: string;
  application: CVApplication;
}): Promise<void> {
  const { uid, campaignId, fileName, emailStatus, application } = args;
  const { candidate, scoringResult } = application;
  const base = {
    uid,
    fileName,
    candidate: candidate.fullName,
    source: 'chat' as const,
  };
  try {
    await appendJournalEntry({
      action: 'imap_cv_received',
      actor: 'manager-chat',
      campaignId: campaignId ?? null,
      payload: base,
    });
    await appendJournalEntry({
      action: 'imap_cv_analyzed',
      actor: 'manager-chat',
      campaignId: campaignId ?? null,
      payload: {
        ...base,
        email: candidate.email,
        emailStatus,
        // Compat dashboard : score = totalScore, aboveThreshold = statut accepted.
        score: scoringResult.totalScore,
        aboveThreshold: scoringResult.status === 'accepted',
      },
    });
  } catch (err) {
    // Pas de persistance configurée (démo locale) → silencieux. Toute
    // autre erreur est loggée serveur sans casser l'analyse.
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[cv-analyzer] journal candidate failed', err);
    }
  }
}
