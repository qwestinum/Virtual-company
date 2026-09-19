/**
 * S25 — Compte rendu d'entretien et commentaire du recruteur.
 * Spec : docs/specs/compte-rendu-entretien.md (arbitrages §14).
 *
 * LOT 2 — le verdict MOTIVÉ, sur routes réelles :
 *   1. un verdict ne se pose QU'EN attente de verdict (409 ailleurs) ;
 *   2. le commentaire est FACULTATIF (arbitrage du 19/09/2026) : sans lui, le
 *      verdict se pose, aucune ligne de commentaire n'est écrite, et le marqueur
 *      n'en désigne aucune ;
 *   3. `/api/journal` refuse le marqueur de verdict (409) — la règle n'est pas
 *      une convention d'écran ;
 *   4. verdict motivé : le commentaire est au dossier avec son auteur (session
 *      serveur), le marqueur porte son IDENTIFIANT et jamais son texte ;
 *   5. un second verdict sur un dossier décidé : 409 ;
 *   6. RÉTRO-COMPATIBILITÉ : un dossier décidé AVANT la règle (marqueur sans
 *      commentaire) n'est jamais bloqué — « Corriger la décision » reste
 *      possible, sans commentaire, et le dialog dit honnêtement qu'aucun
 *      commentaire n'avait été enregistré ;
 *   7. le dialog de correction d'un dossier MOTIVÉ montre le commentaire et
 *      son auteur ; la frise du dossier le porte.
 *
 * LOT 3 — le compte rendu rédigé à la main :
 *   8. pas d'entretien réalisé ⇒ rien à rendre compte (409, rien écrit) ;
 *   9. un BROUILLON n'est pas au dossier (absent de la frise) ;
 *  10. valider pose l'auteur de la session et la date ; la frise porte la
 *      mention ; le journal ne porte aucune rubrique ;
 *  11. un compte rendu validé ne redevient pas brouillon (409), il se modifie
 *      en étant validé de nouveau.
 *
 * LOT 4 — l'import de transcription (modèle simulé) :
 *  12. plusieurs locuteurs : le serveur demande qui est le candidat (422) SANS
 *      rien envoyer au modèle ni écrire ;
 *  13. proposition : brouillon « établi à partir d'une transcription »,
 *      citation inventée RETIRÉE, passages hors cadre comptés ;
 *  14. LA PREUVE : après la génération, le témoin de la transcription n'est
 *      NULLE PART — aucune table du schéma, journal compris, ni console, ni
 *      réponse ;
 *  15. échec de génération (le modèle lève en CITANT le texte) : rien écrit,
 *      message générique, et toujours aucun témoin nulle part ;
 *  16. réglage éteint : 403, le bouton disparaît de la vue.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const authState: { user: { id: string; email: string } | null } = { user: null };

// Le setup global fige `getApiUser` à `null` : on rebranche l'export pour
// prouver que l'AUTEUR du commentaire vient de la session serveur.
vi.mock('@/lib/auth/require-api-user', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/require-api-user')>(
    '@/lib/auth/require-api-user',
  );
  return { ...actual, getApiUser: async () => authState.user };
});

import { POST as analyzeCv } from '@/app/api/cv-analyzer/route';
import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { GET as getCorrectionContext } from '@/app/api/candidatures/[id]/correction-context/route';
import { POST as correctDecision } from '@/app/api/candidatures/[id]/correct-decision/route';
import { POST as postJournal } from '@/app/api/journal/route';
import {
  GET as getInterviewReport,
  PUT as putInterviewReport,
} from '@/app/api/candidatures/[id]/interview-report/route';
import { POST as importTranscriptRoute } from '@/app/api/candidatures/[id]/interview-report/transcript/route';
import { GET as getAudit } from '@/app/api/reporting/audit/candidates/[id]/route';
import { getAppSettings, patchAppSettings } from '@/lib/db/repos/app-settings';
import { DEFAULT_INTERVIEW_CONFIG } from '@/types/interview-settings';

import {
  TRANSCRIPT_CANARY,
  TRANSCRIPT_FAILURE_MARKER,
  TRANSCRIPT_FIXTURE_VTT,
} from './fixtures/llm-fixtures';
import { scanDatabaseFor } from './helpers/trace-scan';
import type { DecisionCorrectionContext } from '@/types/decision-correction';

import {
  call,
  callWithId,
  cvAnalyzerForm,
  testCampaignPayload,
  testScoringSheet,
} from './helpers/api';
import { cleanAll, db, newTestCampaignId, readRows } from './helpers/db';
import { analysisIdOf, postVerdict, REGRESSION_VERDICT_COMMENT } from './helpers/verdict';

const camp = newTestCampaignId('s25');
const SARAH = { id: '00000000-0000-4000-8000-0000000025ab', email: 'sarah@treg.local' };
const motivatedUid = `treg_s25_motive_${Date.now().toString(36)}`;
const legacyUid = `treg_s25_legacy_${Date.now().toString(36)}`;
const bareUid = `treg_s25_sans_${Date.now().toString(36)}`;
const reportUid = `treg_s25_cr_${Date.now().toString(36)}`;
const importUid = `treg_s25_import_${Date.now().toString(36)}`;
const failUid = `treg_s25_echec_${Date.now().toString(36)}`;

function transcriptForm(content: string, candidateSpeaker?: string): FormData {
  const form = new FormData();
  form.append('file', new File([content], 'entretien.vtt', { type: 'text/vtt' }));
  if (candidateSpeaker) form.append('candidateSpeaker', candidateSpeaker);
  return form;
}

/** Appelle la route en capturant TOUT ce qui part en console. */
async function importWithConsole(uid: string, form: FormData) {
  const lines: string[] = [];
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (a instanceof Error ? `${a.name} ${a.message}` : String(a))).join(' '));
    }),
  );
  try {
    const res = await callWithId(importTranscriptRoute, await analysisIdOf(uid), { method: 'POST', form });
    return { res, console: lines.join('\n') };
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

const REPORT_TOPICS = 'Parcours en recette bancaire, souhait de rejoindre une équipe produit.';

function reportSections(body: string) {
  return { version: 2, body };
}

async function putReport(uid: string, topics: string, action: 'draft' | 'verify') {
  return callWithId(putInterviewReport, await analysisIdOf(uid), {
    method: 'PUT',
    body: { sections: reportSections(topics), action },
  });
}

async function timelineOf(uid: string) {
  const res = await callWithId(getAudit, await analysisIdOf(uid));
  expect(res.status).toBe(200);
  return res.json.timeline as { key: string; detail: string | null }[];
}

async function analyze(taskId: string): Promise<void> {
  const res = await call(analyzeCv, {
    method: 'POST',
    form: cvAnalyzerForm({
      profile: 'fort',
      campaignId: camp,
      sheet: testScoringSheet(camp),
      thresholdLow: 30,
      thresholdHigh: 75,
      taskId,
    }),
  });
  expect(res.status).toBe(200);
}

async function markInterview(uid: string): Promise<void> {
  const res = await call(postJournal, {
    method: 'POST',
    body: {
      action: 'candidate_interview_marked',
      campaignId: camp,
      actor: 'user',
      payload: { uid, candidate: 'Victor Fort', status: 'realized' },
    },
  });
  expect(res.status).toBe(204);
}

async function verdictMarkers(uid: string) {
  const rows = await readRows<{ payload: Record<string, unknown> }>('journal', {
    action: 'candidate_validation_marked',
    campaign_id: camp,
  });
  return rows.filter((r) => r.payload.uid === uid);
}

async function contextFor(uid: string): Promise<DecisionCorrectionContext> {
  const res = await callWithId(getCorrectionContext, await analysisIdOf(uid));
  expect(res.status).toBe(200);
  return res.json as unknown as DecisionCorrectionContext;
}

beforeAll(async () => {
  await cleanAll();
  authState.user = SARAH;
  const created = await call(putCampaign, {
    method: 'PUT',
    body: testCampaignPayload({ id: camp, status: 'active' }),
  });
  expect(created.status).toBe(200);
  await analyze(motivatedUid);
  await analyze(legacyUid);
  await analyze(bareUid);
  await analyze(reportUid);
  await analyze(importUid);
  await analyze(failUid);
});

afterAll(async () => {
  authState.user = null;
  await cleanAll();
});

describe('S25.1 — un verdict ne se pose qu’en attente de verdict', () => {
  it('candidature seulement invitée : 409, rien écrit', async () => {
    const res = await postVerdict(motivatedUid, 'validated');
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('not_awaiting_verdict');
    expect(await verdictMarkers(motivatedUid)).toHaveLength(0);
  });
});

describe('S25.2 — le commentaire est facultatif', () => {
  beforeAll(async () => {
    await markInterview(motivatedUid);
    await markInterview(bareUid);
  });

  it('verdict SANS commentaire : 200, aucune ligne de commentaire, marqueur sans commentId', async () => {
    const res = await postVerdict(bareUid, 'rejected', '');
    expect(res.status).toBe(200);
    expect(res.json.commentId).toBeNull();
    expect(
      await readRows('verdict_comments', { analysis_id: await analysisIdOf(bareUid) }),
    ).toHaveLength(0);
    const markers = await verdictMarkers(bareUid);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.payload).not.toHaveProperty('commentId');
  });

  it('le dossier le dit honnêtement : aucun commentaire', async () => {
    const ctx = await contextFor(bareUid);
    expect(ctx.verdictComment).toBeNull();
  });
});

describe('S25.3 — le journal générique refuse le verdict', () => {
  it('candidate_validation_marked par /api/journal : 409, rien écrit', async () => {
    const res = await call(postJournal, {
      method: 'POST',
      body: {
        action: 'candidate_validation_marked',
        campaignId: camp,
        actor: 'user',
        payload: { uid: motivatedUid, candidate: 'Victor Fort', status: 'validated' },
      },
    });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('use_verdict_route');
    expect(await verdictMarkers(motivatedUid)).toHaveLength(0);
  });
});

describe('S25.4 — verdict motivé', () => {
  it('200 : commentaire au dossier, auteur de la SESSION, marqueur qui le désigne', async () => {
    const res = await postVerdict(motivatedUid, 'validated');
    expect(res.status).toBe(200);
    const commentId = res.json.commentId as string;

    const [row] = await readRows<{
      id: string;
      body: string;
      verdict: string;
      author_user_id: string | null;
      author_email: string | null;
    }>('verdict_comments', { analysis_id: await analysisIdOf(motivatedUid) });
    expect(row).toMatchObject({
      id: commentId,
      body: REGRESSION_VERDICT_COMMENT,
      verdict: 'validated',
      author_user_id: SARAH.id,
      author_email: SARAH.email,
    });

    const markers = await verdictMarkers(motivatedUid);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.payload).toMatchObject({ status: 'validated', commentId, actorEmail: SARAH.email });
  });

  it('le TEXTE du commentaire n’est nulle part dans le journal de la campagne', async () => {
    const all = await readRows<{ payload: Record<string, unknown> }>('journal', { campaign_id: camp });
    expect(JSON.stringify(all)).not.toContain('attentes du poste confirmées');
  });

  it('un commentaire ne se réécrit pas (ajout seul, tenu par la base)', async () => {
    const { error } = await db()
      .from('verdict_comments')
      .update({ body: 'réécrit après coup' })
      .eq('analysis_id', await analysisIdOf(motivatedUid));
    expect(error).not.toBeNull();
  });
});

describe('S25.5 — un dossier décidé n’attend plus de verdict', () => {
  it('second verdict : 409', async () => {
    const res = await postVerdict(motivatedUid, 'rejected');
    expect(res.status).toBe(409);
    expect(res.json.stage).toBe('retenu');
  });
});

describe('S25.6 — rétro-compatibilité : l’historique n’est jamais bloqué', () => {
  beforeAll(async () => {
    // Un verdict posé AVANT la règle : le marqueur d'époque, sans commentaire,
    // écrit en direct (plus aucune route ne sait le poser ainsi).
    await markInterview(legacyUid);
    const { error } = await db().from('journal').insert({
      action: 'candidate_validation_marked',
      campaign_id: camp,
      actor: 'user',
      payload: { uid: legacyUid, candidate: 'Victor Fort', status: 'validated' },
    });
    expect(error).toBeNull();
  });

  it('le dialog dit qu’aucun commentaire n’avait été enregistré — sans rien inventer', async () => {
    const ctx = await contextFor(legacyUid);
    expect(ctx.current).toEqual({ kind: 'final_verdict', value: 'validated' });
    expect(ctx.verdictComment).toBeNull();
    expect(ctx.decidedBy).toBeNull();
  });

  it('« Corriger la décision » reste possible, SANS commentaire', async () => {
    const res = await callWithId(correctDecision, await analysisIdOf(legacyUid), {
      method: 'POST',
      body: { target: 'verdict_rejected' },
    });
    expect(res.status).toBe(200);
    expect(res.json.nextStage).toBe('non_retenu');
  });
});

describe('S25.7 — le dossier raconte la décision', () => {
  it('le dialog de correction montre le commentaire et son auteur', async () => {
    const ctx = await contextFor(motivatedUid);
    expect(ctx.verdictComment).toMatchObject({
      body: REGRESSION_VERDICT_COMMENT,
      authorEmail: SARAH.email,
      writtenFor: 'validated',
      matchesCurrent: true,
    });
    expect(ctx.decidedBy).toBe(SARAH.email);
  });

  it('la frise porte le commentaire sur « Retenu définitivement »', async () => {
    const res = await callWithId(getAudit, await analysisIdOf(motivatedUid));
    expect(res.status).toBe(200);
    const timeline = res.json.timeline as { key: string; detail: string | null }[];
    const final = timeline.find((e) => e.key === 'final_validated');
    expect(final?.detail).toBe(`« ${REGRESSION_VERDICT_COMMENT} » — ${SARAH.email}`);
  });
});

describe('S25.8 — le compte rendu suppose un entretien réalisé', () => {
  it('avant l’entretien : la vue dit « non rédigeable » et l’écriture est refusée', async () => {
    const view = await callWithId(getInterviewReport, await analysisIdOf(reportUid));
    expect(view.status).toBe(200);
    expect(view.json).toMatchObject({ report: null, writable: false });
    const res = await putReport(reportUid, REPORT_TOPICS, 'draft');
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('interview_not_realized');
    expect(await readRows('interview_reports', { analysis_id: await analysisIdOf(reportUid) })).toHaveLength(0);
  });
});

describe('S25.9 — un brouillon n’est pas au dossier', () => {
  beforeAll(async () => {
    await markInterview(reportUid);
  });

  it('brouillon enregistré, absent de la frise', async () => {
    const res = await putReport(reportUid, REPORT_TOPICS, 'draft');
    expect(res.status).toBe(200);
    expect((res.json.report as { status: string }).status).toBe('draft');
    expect((await timelineOf(reportUid)).some((e) => e.key === 'interview_report')).toBe(false);
  });
});

describe('S25.10 — valider, c’est signer', () => {
  it('auteur de la session, date, mention dans la frise', async () => {
    const res = await putReport(reportUid, REPORT_TOPICS, 'verify');
    expect(res.status).toBe(200);
    const [row] = await readRows<{
      status: string;
      source: string;
      verified_by_user_id: string | null;
      verified_by_email: string | null;
      verified_at: string | null;
    }>('interview_reports', { analysis_id: await analysisIdOf(reportUid) });
    expect(row).toMatchObject({
      status: 'verified',
      source: 'manual',
      verified_by_user_id: SARAH.id,
      verified_by_email: SARAH.email,
    });
    expect(row!.verified_at).not.toBeNull();
    const event = (await timelineOf(reportUid)).find((e) => e.key === 'interview_report');
    expect(event?.detail).toMatch(/^Rédigé et validé par sarah@treg\.local le /);
  });

  it('le journal ne porte aucune rubrique', async () => {
    const all = await readRows<{ action: string; payload: Record<string, unknown> }>('journal', {
      campaign_id: camp,
    });
    expect(all.some((e) => e.action === 'interview_report_saved')).toBe(true);
    expect(JSON.stringify(all)).not.toContain('recette bancaire');
  });
});

describe('S25.11 — un compte rendu validé se modifie en étant RE-validé', () => {
  it('repasser en brouillon : 409', async () => {
    const res = await putReport(reportUid, `${REPORT_TOPICS} Ajout.`, 'draft');
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('already_verified');
  });

  it('modifier et valider de nouveau : 200, le texte suit', async () => {
    const res = await putReport(reportUid, `${REPORT_TOPICS} Ajout.`, 'verify');
    expect(res.status).toBe(200);
    const [row] = await readRows<{ sections: { version: number; body: string } }>('interview_reports', {
      analysis_id: await analysisIdOf(reportUid),
    });
    expect(row!.sections).toEqual({ version: 2, body: `${REPORT_TOPICS} Ajout.` });
  });
});

describe('S25.12 — plusieurs locuteurs : l’humain désigne le candidat', () => {
  beforeAll(async () => {
    await markInterview(importUid);
    await markInterview(failUid);
  });

  it('422 avec les locuteurs, rien écrit', async () => {
    const { res } = await importWithConsole(importUid, transcriptForm(TRANSCRIPT_FIXTURE_VTT));
    expect(res.status).toBe(422);
    expect(res.json.speakers).toEqual(['Sami Recruteur', 'Victor Candidat']);
    expect(await readRows('interview_reports', { analysis_id: await analysisIdOf(importUid) })).toHaveLength(0);
  });
});

describe('S25.13–14 — proposition, et AUCUNE trace de la transcription', () => {
  const since = new Date(Date.now() - 60_000).toISOString();
  let consoleOut = '';
  let responseBody = '';

  it('brouillon proposé : source transcription, citation inventée retirée, hors cadre compté', async () => {
    const { res, console: out } = await importWithConsole(
      importUid,
      transcriptForm(TRANSCRIPT_FIXTURE_VTT, 'Victor Candidat'),
    );
    consoleOut = out;
    responseBody = JSON.stringify(res.json);
    expect(res.status).toBe(200);
    expect(res.json.stats).toEqual({ kept: 3, removedUnproven: 1, flagged: 0, omittedCount: 1 });
    const report = res.json.report as { status: string; source: string; sections: { body: string } };
    expect(report).toMatchObject({ status: 'draft', source: 'transcript' });
    // UN seul texte, organisé par intertitres (spec §18).
    expect(report.sections.body).toContain('Ce que le candidat a mis en avant\n- ');
    expect(report.sections.body).toContain('« J’ai piloté la recette de bout en bout »');
    // La citation INVENTÉE a été retirée (le libellé d'un critère de la fiche
    // de test peut, lui, parler de SQL : on vise la citation, pas le mot).
    expect(report.sections.body).not.toContain('je pratique SQL tous les jours');
  });

  it('le témoin n’est dans AUCUNE table du schéma — journal compris', async () => {
    const scan = await scanDatabaseFor(TRANSCRIPT_CANARY, since);
    expect(scan.scanned).toEqual(expect.arrayContaining(['interview_reports', 'journal', 'verdict_comments']));
    expect(scan.hits).toEqual([]);
  }, 180_000);

  it('ni dans la console, ni dans la réponse', () => {
    expect(consoleOut).not.toContain(TRANSCRIPT_CANARY);
    expect(responseBody).not.toContain(TRANSCRIPT_CANARY);
  });

  it('le journal ne porte que des compteurs', async () => {
    const [entry] = (
      await readRows<{ payload: Record<string, unknown> }>('journal', {
        action: 'interview_report_generated',
        campaign_id: camp,
      })
    ).filter((e) => e.payload.uid === importUid);
    expect(entry?.payload).toMatchObject({ quotesKept: 3, quotesRemoved: 1, omittedCount: 1, model: 'mock-regression' });
    expect(JSON.stringify(entry)).not.toMatch(/recette|paiements/u);
  });
});

describe('S25.15 — échec de génération : rien écrit, rien qui fuite', () => {
  const since = new Date(Date.now() - 60_000).toISOString();

  it('502 générique, aucun compte rendu, aucun témoin en console ni en réponse', async () => {
    const failing = TRANSCRIPT_FIXTURE_VTT.replace('Parlez-moi', `${TRANSCRIPT_FAILURE_MARKER} Parlez-moi`);
    const { res, console: out } = await importWithConsole(failUid, transcriptForm(failing, 'Victor Candidat'));
    expect(res.status).toBe(502);
    expect(res.json.message).toBe(
      'La génération n’a pas abouti. Rien n’a été enregistré. Réimportez la transcription.',
    );
    expect(JSON.stringify(res.json)).not.toContain(TRANSCRIPT_CANARY);
    // Le modèle simulé a levé en CITANT la transcription : rien n'en sort.
    expect(out).not.toContain(TRANSCRIPT_CANARY);
    expect(out).not.toContain('paiements instantanés');
    expect(await readRows('interview_reports', { analysis_id: await analysisIdOf(failUid) })).toHaveLength(0);
  });

  it('toujours aucun témoin dans la base', async () => {
    expect((await scanDatabaseFor(TRANSCRIPT_CANARY, since)).hits).toEqual([]);
  }, 180_000);
});

describe('S25.16 — réglage éteint', () => {
  it('403, et la vue retire le bouton ; le réglage est restauré', async () => {
    const before = await getAppSettings();
    const config = before?.interviewConfig ?? DEFAULT_INTERVIEW_CONFIG;
    await patchAppSettings({ interviewConfig: { ...config, transcriptImportEnabled: false } });
    try {
      const view = await callWithId(getInterviewReport, await analysisIdOf(failUid));
      expect(view.json.transcriptImportEnabled).toBe(false);
      const { res } = await importWithConsole(failUid, transcriptForm(TRANSCRIPT_FIXTURE_VTT, 'Victor Candidat'));
      expect(res.status).toBe(403);
    } finally {
      await patchAppSettings({ interviewConfig: config });
    }
  });
});
