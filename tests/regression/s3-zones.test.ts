/**
 * S3 — Traitement candidature : ZONES de décision et cohérence (jamais de
 * score exact — verdicts LLM mockés fixes, on asserte la DÉCISION + des
 * fourchettes larges).
 *
 * Parcours réel : upload PDF via POST /api/cv-analyzer (extraction PDF réelle,
 * scoring réel — seuls les verdicts sont fixés), puis mise en file de
 * validation par POST /api/validations pour un gris (c'est le geste du client
 * chat, reproduit à l'identique).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as analyzeCv } from '@/app/api/cv-analyzer/route';
import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { POST as postValidation } from '@/app/api/validations/route';
import { cvApplicationToMailCandidate } from '@/types/mail-candidate';
import type { CVApplication } from '@/types/cv-analysis';

import { call, cvAnalyzerForm, testCampaignPayload, testScoringSheet } from './helpers/api';
import { cleanAll, newTestCampaignId, readRow, readRows } from './helpers/db';
import { sentEmails, resetSentEmails } from './helpers/mocks';

const camp = newTestCampaignId('s3');
const LOW = 30;
const HIGH = 75;

type AnalyzeJson = {
  application: CVApplication;
  thresholdLow: number;
  thresholdHigh: number;
  cvArtifactId: string | null;
};

async function analyze(
  profile: 'fort' | 'faible' | 'moyen',
  taskId: string,
  thresholds?: { low: number; high: number },
): Promise<AnalyzeJson> {
  const res = await call(analyzeCv, {
    method: 'POST',
    form: cvAnalyzerForm({
      profile,
      campaignId: camp,
      sheet: testScoringSheet(camp),
      thresholdLow: thresholds?.low ?? LOW,
      thresholdHigh: thresholds?.high ?? HIGH,
      taskId,
    }),
  });
  expect(res.status).toBe(200);
  return res.json as unknown as AnalyzeJson;
}

beforeAll(async () => {
  await cleanAll();
  resetSentEmails();
  const res = await call(putCampaign, {
    method: 'PUT',
    body: testCampaignPayload({
      id: camp,
      status: 'active',
      thresholdLow: LOW,
      thresholdHigh: HIGH,
    }),
  });
  expect(res.status).toBe(200);
});
afterAll(async () => {
  await cleanAll();
});

describe('S3 — zones de décision', () => {
  it('CV clairement FORT → auto_accept (score en fourchette haute, jamais asserté exactement)', async () => {
    const taskId = `treg_s3_fort_${Date.now().toString(36)}`;
    const { application } = await analyze('fort', taskId);

    expect(application.scoringResult.decisionZone).toBe('auto_accept');
    expect(application.scoringResult.status).toBe('accepted');
    expect(application.scoringResult.totalScore).toBeGreaterThanOrEqual(70);

    const row = await readRow<{ decision_zone: string; decided_by: string; status: string; campaign_id: string }>(
      'candidate_analyses',
      taskId,
    );
    expect(row.decision_zone).toBe('auto_accept');
    expect(row.decided_by).toBe('auto');
    expect(row.status).toBe('accepted');
    expect(row.campaign_id).toBe(camp);

    // Journal tracé (réception + analyse), rattaché à la campagne.
    const journal = await readRows<{ action: string; payload: { uid?: string } }>(
      'journal',
      { campaign_id: camp, action: 'imap_cv_analyzed' },
    );
    expect(journal.some((j) => j.payload.uid === taskId)).toBe(true);
  });

  it('CV clairement FAIBLE (rédhibitoire raté) → proposed_reject, AUCUN mail', async () => {
    const taskId = `treg_s3_faible_${Date.now().toString(36)}`;
    const { application } = await analyze('faible', taskId);

    // Conformité RGPD : sous le seuil bas, on PROPOSE le refus — on ne l'envoie
    // pas. `auto_reject` ne doit plus jamais être produite.
    expect(application.scoringResult.decisionZone).toBe('proposed_reject');
    expect(application.scoringResult.status).toBe('rejected');
    expect(application.scoringResult.totalScore).toBeLessThanOrEqual(40);
    // Le rédhibitoire raté doit être tracé comme échec dur.
    expect(application.scoringResult.hardFailures.length).toBeGreaterThan(0);

    const row = await readRow<{ decision_zone: string; decided_by: string }>(
      'candidate_analyses',
      taskId,
    );
    expect(row.decision_zone).toBe('proposed_reject');
    expect(row.decided_by).toBe('auto');
    // Le statut binaire est provisoire, comme pour un gris : rien n'est parti.
    expect(sentEmails).toHaveLength(0);
  });

  it('CV MOYEN → zone grise, pending_validation créée, AUCUN mail parti', async () => {
    const taskId = `treg_s3_moyen_${Date.now().toString(36)}`;
    const { application } = await analyze('moyen', taskId);

    expect(application.scoringResult.decisionZone).toBe('gray');
    const score = application.scoringResult.totalScore;
    expect(score).toBeGreaterThanOrEqual(LOW);
    expect(score).toBeLessThan(HIGH);

    const row = await readRow<{ decision_zone: string; decided_by: string; status: string }>(
      'candidate_analyses',
      taskId,
    );
    expect(row.decision_zone).toBe('gray');
    expect(row.decided_by).toBe('auto');
    // Statut binaire provisoire d'un gris : 'rejected' — la vérité est la zone.
    expect(row.status).toBe('rejected');

    // Le client met le gris en file de validation (geste reproduit).
    const enqueue = await call(postValidation, {
      method: 'POST',
      body: {
        id: `val_treg_${taskId}`,
        campaignId: camp,
        candidateName: application.candidate.fullName,
        candidateEmail: application.candidate.email,
        score,
        decision: 'reject',
        payload: {
          uid: taskId,
          candidate: cvApplicationToMailCandidate(application),
          jobTitle: 'Testeur Logiciel TREG',
        },
      },
    });
    expect(enqueue.status).toBe(200);

    const pending = await readRow<{ status: string; cv_artifact_id: string | null }>(
      'pending_validations',
      `val_treg_${taskId}`,
    );
    expect(pending.status).toBe('pending');

    // Zone grise ⇒ RIEN ne part tant qu'un humain n'a pas tranché.
    expect(sentEmails).toHaveLength(0);
  });

  it('déplacement de poignée : baisser le seuil haut → le CV moyen bascule en auto_accept', async () => {
    // 1. Score observé du CV moyen avec les poignées d'origine.
    const probeId = `treg_s3_probe_${Date.now().toString(36)}`;
    const probe = await analyze('moyen', probeId);
    const score = probe.application.scoringResult.totalScore;
    expect(probe.application.scoringResult.decisionZone).toBe('gray');

    // 2. Le DRH baisse la poignée haute SOUS le score du candidat (persistée).
    const newHigh = score; // zone: totalScore >= high ⇒ auto_accept
    const updated = await call(putCampaign, {
      method: 'PUT',
      body: testCampaignPayload({
        id: camp,
        status: 'active',
        thresholdLow: 10,
        thresholdHigh: newHigh,
      }),
    });
    expect(updated.status).toBe(200);
    const row = await readRow<{ threshold_high: number }>('campaigns', camp);
    expect(row.threshold_high).toBe(newHigh);

    // 3. Le même CV re-injecté suit les nouvelles poignées.
    const taskId = `treg_s3_moved_${Date.now().toString(36)}`;
    const moved = await analyze('moyen', taskId, { low: 10, high: newHigh });
    expect(moved.application.scoringResult.decisionZone).toBe('auto_accept');
    expect(moved.application.scoringResult.totalScore).toBe(score); // même CV, mêmes verdicts fixes

    const analysis = await readRow<{ decision_zone: string }>('candidate_analyses', taskId);
    expect(analysis.decision_zone).toBe('auto_accept');
  });

  it('aucun mail (mocké) n’est parti pendant tout le scénario', () => {
    expect(sentEmails).toHaveLength(0);
  });
});
