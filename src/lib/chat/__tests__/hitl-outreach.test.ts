/**
 * E2E déterministe du gating HITL 3 zones dans `dispatchPostAnalysisOutreach`.
 *
 * Vérifie le cœur du cycle : la ZONE du candidat (auto_reject / gray /
 * auto_accept, calculée par scoreCandidat) décide. `gray` → file (brouillon,
 * aucun envoi) ; zones auto → envoi réel (+ brief pour un accept). `fetch` est
 * mocké et on inspecte les endpoints réellement appelés.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchPostAnalysisOutreach } from '@/lib/chat/manager-flow';
import { sendValidation } from '@/lib/hitl/send-validation';
import type { DecisionZone, PendingValidation } from '@/types/hitl';
import type { CVApplication, CVBatchSummary } from '@/types/cv-analysis';
import type { MailCandidate } from '@/types/mail-candidate';

type Call = { url: string; body: Record<string, unknown> | undefined };

let calls: Call[] = [];
/** Force le statut d'envoi du mail-composer (override) — null = 'sent'. */
let mailComposerStatus: string | null = null;

function jsonResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  } as Response);
}

function mockFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  const body =
    typeof init?.body === 'string'
      ? (JSON.parse(init.body) as Record<string, unknown>)
      : undefined;
  calls.push({ url, body });

  if (url === '/api/mail-composer') {
    return jsonResponse({
      status: body?.draft ? 'draft' : (mailComposerStatus ?? 'sent'),
      fileName: 'mail.md',
      publicUrl: 'https://x/mail.md',
      subject: 'Objet',
      html: '<p>Corps</p>',
      sentTo: 'c@x.fr',
      error: null,
    });
  }
  if (url === '/api/scheduler') {
    return jsonResponse({
      status: 'sent',
      fileName: 'brief.md',
      publicUrl: 'https://x/brief.md',
      error: null,
    });
  }
  // Finalisation d'une validation : /api/validations/<id>/send
  if (/\/api\/validations\/[^/]+\/send$/.test(url)) {
    return jsonResponse({ validation: { status: 'sent' } });
  }
  // Switch (PATCH) : /api/validations/<id> — renvoie la validation à jour (echo).
  if (/\/api\/validations\/[^/]+$/.test(url)) {
    return jsonResponse({
      validation: {
        id: 'val-1',
        decision: body?.decision,
        confirmed: body?.confirmed,
        payload: body?.payload,
      },
    });
  }
  // /api/validations (create) et autres
  return jsonResponse({});
}

function makeCV(zone: DecisionZone, name: string): CVApplication {
  const status = zone === 'auto_accept' ? 'accepted' : 'rejected';
  const totalScore = zone === 'auto_accept' ? 82 : zone === 'gray' ? 60 : 30;
  return {
    candidate: {
      fullName: name,
      email: `${name.toLowerCase()}@x.fr`,
      phone: null,
      detectedLanguage: 'fr',
      fileName: `${name}.pdf`,
      source: 'chat',
      receivedAt: '2026-06-08T10:00:00.000Z',
      rightToWork: null,
      location: null,
      photoPresent: false,
    },
    scoringResult: {
      totalScore,
      status,
      decisionZone: zone,
      breakdown: [],
      criteriaVersion: 'v1',
      computedAt: '2026-06-08T10:00:00.000Z',
    },
    narration: {
      summary: 'Synthèse de test.',
      strengths: ['un point fort'],
      weaknesses: [],
      justification: 'Justification de test.',
    },
  } as unknown as CVApplication;
}

function summaryOf(...cvs: CVApplication[]): CVBatchSummary {
  return {
    total: cvs.length,
    aboveThreshold: cvs.filter((c) => c.scoringResult.status === 'accepted')
      .length,
    thresholdLow: 16,
    thresholdHigh: 90,
    perCV: cvs,
  };
}

const at = (url: string) => calls.filter((c) => c.url === url);
const mailDrafts = () =>
  at('/api/mail-composer').filter((c) => c.body?.draft === true);
const mailSends = () =>
  at('/api/mail-composer').filter((c) => !c.body?.draft);

beforeEach(() => {
  calls = [];
  mailComposerStatus = null;
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HITL gating E2E — dispatchPostAnalysisOutreach (3 zones)', () => {
  const autoAccept = makeCV('auto_accept', 'Alice');
  const autoReject = makeCV('auto_reject', 'Bob');
  const gray = makeCV('gray', 'Gris');

  it('tout GRIS : tout en FILE (brouillons), aucun envoi ni brief', async () => {
    await dispatchPostAnalysisOutreach({
      campaignId: 'CAMP-1',
      jobTitle: 'Dev',
      summary: summaryOf(gray, makeCV('gray', 'Gris2')),
      uids: ['u-g1', 'u-g2'],
      cvArtifactIds: [null, null],
      reportArtifactId: 'rep-1',
    });

    expect(at('/api/validations')).toHaveLength(2); // les 2 gris mis en file
    expect(mailDrafts()).toHaveLength(2); // brouillons composés
    expect(mailSends()).toHaveLength(0); // AUCUN envoi réel
    expect(at('/api/scheduler')).toHaveLength(0); // pas de brief (rien d'accepté)
    const uids = at('/api/validations').map(
      (c) => (c.body?.payload as { uid?: string })?.uid,
    );
    expect(new Set(uids)).toEqual(new Set(['u-g1', 'u-g2']));
  });

  it('zones AUTO : envoi automatique (mail réel + brief pour l’auto_accept)', async () => {
    await dispatchPostAnalysisOutreach({
      campaignId: 'CAMP-1',
      jobTitle: 'Dev',
      summary: summaryOf(autoAccept, autoReject),
      uids: ['u-accept', 'u-reject'],
      cvArtifactIds: [null, null],
      reportArtifactId: 'rep-1',
    });

    expect(at('/api/validations')).toHaveLength(0); // rien en file
    expect(mailSends()).toHaveLength(2); // envois réels
    expect(mailDrafts()).toHaveLength(0);
    expect(at('/api/scheduler')).toHaveLength(1); // brief du seul auto_accept
    expect(mailSends().every((c) => typeof c.body?.uid === 'string')).toBe(true);
  });

  it('MIXTE (gris + auto_accept) : le gris en file, l’auto_accept envoyé', async () => {
    await dispatchPostAnalysisOutreach({
      campaignId: 'CAMP-1',
      jobTitle: 'Dev',
      summary: summaryOf(autoAccept, gray),
      uids: ['u-accept', 'u-gray'],
      cvArtifactIds: [null, null],
      reportArtifactId: 'rep-1',
    });

    expect(at('/api/validations')).toHaveLength(1); // le gris
    // Direction PROVISOIRE du gris = refus (statut provisoire 'rejected').
    expect(at('/api/validations')[0]?.body?.decision).toBe('reject');
    expect(mailSends()).toHaveLength(1); // l'auto_accept envoyé
    expect(mailDrafts()).toHaveLength(1); // brouillon du gris en file
    expect(at('/api/scheduler')).toHaveLength(1); // brief de l'auto_accept
  });
});

const mailCandidate: MailCandidate = {
  candidateName: 'Bob',
  email: 'bob@x.fr',
  phone: null,
  score: 30,
  aboveThreshold: false,
  summary: 'Synthèse',
  strengths: ['a'],
  weaknesses: ['b'],
  justification: 'J',
};

function makeValidation(decision: 'accept' | 'reject'): PendingValidation {
  return {
    id: 'val-1',
    campaignId: 'CAMP-1',
    candidateName: 'Bob',
    candidateEmail: 'bob@x.fr',
    score: 30,
    decision,
    cvArtifactId: null,
    reportArtifactId: 'rep-1',
    mailDraftArtifactId: 'd-1',
    confirmed: true,
    status: 'pending',
    payload: {
      uid: 'u-bob',
      candidate: mailCandidate,
      jobTitle: 'Dev',
      mailSubject: 'Objet',
      mailBody: '<p>x</p>',
    },
    createdAt: '2026-06-08T10:00:00.000Z',
    updatedAt: '2026-06-08T10:00:00.000Z',
    decidedAt: null,
  } as unknown as PendingValidation;
}

describe('HITL E2E — envoi & switch', () => {
  it('« Envoyer » FINALISE même si le mail ne part pas (Resend non configuré)', async () => {
    mailComposerStatus = 'skipped_no_config';
    const res = await sendValidation(makeValidation('reject'), {
      subject: 'Objet',
      html: '<p>Corps</p>',
    });
    expect(res.ok).toBe(true); // la décision est enregistrée malgré tout
    expect(at('/api/validations/val-1/send')).toHaveLength(1); // finalisée
    expect(res.message).toMatch(/non configuré/i);
  });
});
