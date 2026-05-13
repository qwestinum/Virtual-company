import { describe, expect, it } from 'vitest';

import {
  journalToActivityFeed,
  journalToAgentMetrics,
  journalToCampaignMetric,
  journalToCandidatesList,
  journalToGlobalKPIs,
} from '@/lib/dashboard/derive-metrics';
import type { JournalEntry } from '@/lib/db/repos/journal';

function entry(over: Partial<JournalEntry>): JournalEntry {
  return {
    id: 1,
    campaignId: null,
    actor: 'imap_poller',
    action: 'imap_cv_received',
    payload: {},
    createdAt: '2026-05-12T10:00:00.000Z',
    ...over,
  };
}

describe('journalToGlobalKPIs', () => {
  it('renvoie des zéros sur un journal vide', () => {
    expect(journalToGlobalKPIs([])).toEqual({
      cvReceived: 0,
      shortlisted: 0,
      interviews: 0,
      go: 0,
      conversion: 0,
      costEstimate: 0,
    });
  });

  it('compte CV reçus, shortlist via candidats au-dessus du seuil', () => {
    const rows = [
      entry({ id: 1, action: 'imap_cv_received' }),
      entry({ id: 2, action: 'imap_cv_received' }),
      entry({ id: 3, action: 'imap_cv_received' }),
      // Un candidat shortlisté (au-dessus du seuil), avec uid.
      entry({
        id: 4,
        action: 'imap_cv_analyzed',
        payload: { uid: 'u1', candidate: 'A', score: 85, aboveThreshold: true },
      }),
      entry({
        id: 5,
        action: 'imap_cv_analyzed',
        payload: { uid: 'u2', candidate: 'B', score: 50, aboveThreshold: false },
      }),
    ];
    const kpis = journalToGlobalKPIs(rows);
    expect(kpis.cvReceived).toBe(3);
    // un candidat shortlisté, pas encore validé → shortlisted=1, go=0
    expect(kpis.shortlisted).toBe(1);
    expect(kpis.go).toBe(0);
    expect(kpis.conversion).toBe(0);
  });

  it('protège la division par zéro pour la conversion', () => {
    const kpis = journalToGlobalKPIs([
      entry({
        action: 'imap_cv_analyzed',
        payload: { uid: 'u1', aboveThreshold: true },
      }),
    ]);
    // pas de CV reçu → conversion = 0
    expect(kpis.cvReceived).toBe(0);
    expect(kpis.conversion).toBe(0);
  });

  it('compte les entretiens via candidate_interview_marked', () => {
    const rows = [
      entry({
        action: 'imap_cv_analyzed',
        payload: { uid: 'u1', candidate: 'A', score: 80, aboveThreshold: true },
      }),
      entry({
        action: 'candidate_interview_marked',
        payload: { uid: 'u1', status: 'realized' },
        createdAt: '2026-05-12T11:00:00.000Z',
      }),
      // Second candidat marqué « manqué » → ne compte pas.
      entry({
        action: 'imap_cv_analyzed',
        payload: { uid: 'u2', candidate: 'B', score: 80, aboveThreshold: true },
      }),
      entry({
        action: 'candidate_interview_marked',
        payload: { uid: 'u2', status: 'missed' },
      }),
    ];
    const kpis = journalToGlobalKPIs(rows);
    expect(kpis.interviews).toBe(1);
  });

  it('alimente le KPI GO uniquement via candidate_validation_marked', () => {
    const rows = [
      entry({
        action: 'imap_cv_analyzed',
        payload: { uid: 'u1', candidate: 'A', score: 85, aboveThreshold: true },
      }),
      entry({
        action: 'candidate_interview_marked',
        payload: { uid: 'u1', status: 'realized' },
      }),
      entry({
        action: 'candidate_validation_marked',
        payload: { uid: 'u1', status: 'validated' },
      }),
    ];
    const kpis = journalToGlobalKPIs(rows);
    expect(kpis.go).toBe(1);
  });

  it('accumule un coût estimé non-nul', () => {
    const rows = [
      entry({ action: 'imap_cv_analyzed', payload: { aboveThreshold: true } }),
      entry({ action: 'imap_outreach_mail', payload: { status: 'sent' } }),
    ];
    expect(journalToGlobalKPIs(rows).costEstimate).toBeGreaterThan(0);
  });
});

describe('journalToAgentMetrics', () => {
  it('renvoie une ligne par agent demandé avec successRate=100 quand pas d activité', () => {
    const out = journalToAgentMetrics(
      [],
      ['agent.cv-analyzer', 'agent.mail-composer'],
    );
    expect(out).toEqual([
      {
        agentId: 'agent.cv-analyzer',
        taskCount: 0,
        avgDurationMs: null,
        successRate: 100,
        costEstimate: 0,
      },
      {
        agentId: 'agent.mail-composer',
        taskCount: 0,
        avgDurationMs: null,
        successRate: 100,
        costEstimate: 0,
      },
    ]);
  });

  it('attribue imap_cv_analyzed au CV Analyzer', () => {
    const rows = [
      entry({ action: 'imap_cv_analyzed', payload: { aboveThreshold: true } }),
      entry({ action: 'imap_cv_analyzed', payload: { aboveThreshold: false } }),
    ];
    const out = journalToAgentMetrics(rows, ['agent.cv-analyzer']);
    expect(out[0].taskCount).toBe(2);
    expect(out[0].successRate).toBe(100);
  });

  it('pénalise le taux de succès en cas d échec d envoi', () => {
    const rows = [
      entry({ action: 'imap_outreach_mail', payload: { status: 'sent' } }),
      entry({ action: 'imap_outreach_mail', payload: { status: 'send_failed' } }),
      entry({ action: 'imap_outreach_mail', payload: { status: 'sent' } }),
      entry({ action: 'imap_outreach_mail', payload: { status: 'sent' } }),
    ];
    const out = journalToAgentMetrics(rows, ['agent.mail-composer']);
    expect(out[0].taskCount).toBe(4);
    expect(out[0].successRate).toBe(75); // 3/4
  });
});

describe('journalToCampaignMetric', () => {
  it('filtre strictement par campagne', () => {
    const rows = [
      entry({ campaignId: 'CAMP-A', action: 'imap_cv_received' }),
      entry({ campaignId: 'CAMP-B', action: 'imap_cv_received' }),
      entry({
        campaignId: 'CAMP-A',
        action: 'imap_cv_analyzed',
        payload: { aboveThreshold: true, score: 80 },
      }),
    ];
    const m = journalToCampaignMetric(rows, 'CAMP-A');
    expect(m.candidates).toBe(1);
    expect(m.shortlisted).toBe(1);
    expect(m.avgScore).toBe(80);
  });

  it('moyenne les scores quand plusieurs CV analysés', () => {
    const rows = [
      entry({
        campaignId: 'CAMP-A',
        action: 'imap_cv_analyzed',
        payload: { score: 80 },
      }),
      entry({
        campaignId: 'CAMP-A',
        action: 'imap_cv_analyzed',
        payload: { score: 60 },
      }),
    ];
    expect(journalToCampaignMetric(rows, 'CAMP-A').avgScore).toBe(70);
  });
});

describe('journalToCandidatesList', () => {
  it('reste en `invited` tant que le DRH n a pas cliqué « Entretien réalisé »', () => {
    // Cas typique : CV reçu, accepté, invite + brief envoyés par le
    // serveur mais aucune action DRH côté UI. Le candidat n'est PAS
    // encore en entretien (bug v6 — brief auto faisait passer en
    // interview_done à tort).
    const rows = [
      entry({
        id: 1,
        action: 'imap_cv_analyzed',
        payload: {
          uid: 'u1',
          candidate: 'Marie Laurent',
          score: 92,
          aboveThreshold: true,
        },
      }),
      entry({
        id: 2,
        action: 'imap_outreach_mail',
        payload: {
          uid: 'u1',
          mode: 'invite',
          status: 'sent',
          candidate: 'Marie Laurent',
        },
      }),
      entry({
        id: 3,
        action: 'imap_outreach_brief',
        payload: { uid: 'u1', status: 'sent', candidate: 'Marie Laurent' },
      }),
    ];
    const list = journalToCandidatesList(rows);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Marie Laurent');
    expect(list[0].score).toBe(92);
    expect(list[0].status).toBe('invited');
    expect(list[0].recommendation).toBe('go');
  });

  it('passe en interview_done seulement après le clic « Entretien réalisé »', () => {
    const rows = [
      entry({
        action: 'imap_cv_analyzed',
        payload: {
          uid: 'u2',
          candidate: 'Thomas D.',
          score: 88,
          aboveThreshold: true,
        },
      }),
      entry({
        action: 'imap_outreach_brief',
        payload: { uid: 'u2', status: 'sent' },
      }),
      entry({
        action: 'candidate_interview_marked',
        payload: { uid: 'u2', status: 'realized' },
      }),
    ];
    const list = journalToCandidatesList(rows);
    expect(list[0].status).toBe('interview_done');
    expect(list[0].interviewMarked).toBe('realized');
  });

  it('garde status=interview_done même si la validation finale est « Non validé »', () => {
    // Sinon le candidat sort du compteur Entretiens côté liste, mais
    // reste compté côté KPI campagne — incohérence v6 corrigée.
    const rows = [
      entry({
        action: 'imap_cv_analyzed',
        payload: {
          uid: 'u3',
          candidate: 'Sara L.',
          score: 80,
          aboveThreshold: true,
        },
      }),
      entry({
        action: 'candidate_interview_marked',
        payload: { uid: 'u3', status: 'realized' },
      }),
      entry({
        action: 'candidate_validation_marked',
        payload: { uid: 'u3', status: 'rejected' },
      }),
    ];
    const list = journalToCandidatesList(rows);
    expect(list[0].status).toBe('interview_done');
    expect(list[0].validationMarked).toBe('rejected');
  });

  it('marque un refus envoyé comme rejected', () => {
    const rows = [
      entry({
        action: 'imap_cv_analyzed',
        payload: {
          uid: 'u9',
          candidate: 'Test User',
          score: 40,
          aboveThreshold: false,
        },
      }),
      entry({
        action: 'imap_outreach_mail',
        payload: {
          uid: 'u9',
          mode: 'reject',
          status: 'sent',
        },
      }),
    ];
    const list = journalToCandidatesList(rows);
    expect(list[0].status).toBe('rejected');
    expect(list[0].recommendation).toBeNull();
  });

  it('ignore les analyses sans uid pour ne pas mélanger les candidats', () => {
    const rows = [
      entry({
        action: 'imap_cv_analyzed',
        payload: { candidate: 'No UID', score: 70 },
      }),
    ];
    expect(journalToCandidatesList(rows)).toHaveLength(0);
  });
});

describe('journalToActivityFeed', () => {
  it('traduit les actions IMAP en messages métier', () => {
    const rows = [
      entry({
        id: 10,
        action: 'imap_cv_analyzed',
        payload: { candidate: 'Marie L.', score: 92, aboveThreshold: true },
        createdAt: '2026-05-12T14:32:00.000Z',
      }),
      entry({
        id: 11,
        action: 'imap_outreach_mail',
        payload: { candidate: 'Sarah C.', mode: 'invite', status: 'sent' },
      }),
    ];
    const feed = journalToActivityFeed(rows);
    expect(feed).toHaveLength(2);
    expect(feed[0].message).toContain('Marie L.');
    expect(feed[0].message).toContain('92%');
    expect(feed[0].iconKey).toBe('cv');
    expect(feed[1].message).toContain('Sarah C.');
  });

  it('filtre les actions techniques sans intérêt métier', () => {
    const rows = [
      entry({ action: 'imap_parse_failed' }),
      entry({ action: 'imap_email_no_cv' }),
    ];
    expect(journalToActivityFeed(rows)).toEqual([]);
  });

  it('respecte la limite', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      entry({
        id: i,
        action: 'imap_cv_analyzed',
        payload: { candidate: `C${i}`, score: 80, aboveThreshold: true },
      }),
    );
    expect(journalToActivityFeed(rows, 5)).toHaveLength(5);
  });
});
