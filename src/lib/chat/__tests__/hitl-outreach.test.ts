/**
 * P8 — E2E déterministe du gating HITL dans `dispatchPostAnalysisOutreach`.
 *
 * Vérifie le cœur du cycle : selon la config HITL lue à l'analyse, chaque
 * candidat est SOIT mis en file (brouillon, aucun envoi), SOIT traité en envoi
 * automatique (mail réel + brief pour un accept). `fetch` est mocké et on
 * inspecte les endpoints réellement appelés.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchPostAnalysisOutreach } from '@/lib/chat/manager-flow';
import { sendValidation, switchValidation } from '@/lib/hitl/send-validation';
import type { HitlConfig, PendingValidation } from '@/types/hitl';
import type { CVApplication, CVBatchSummary } from '@/types/cv-analysis';
import type { MailCandidate } from '@/types/mail-candidate';

type Call = { url: string; body: Record<string, unknown> | undefined };

let calls: Call[] = [];
let hitlConfig: HitlConfig = { rejectionMail: true, acceptanceMail: true };
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

  if (url === '/api/settings') {
    return jsonResponse({ offline: false, settings: { hitlConfig } });
  }
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

function makeCV(status: 'accepted' | 'rejected', name: string): CVApplication {
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
      totalScore: status === 'accepted' ? 82 : 30,
      status,
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
    threshold: 60,
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

describe('HITL gating E2E — dispatchPostAnalysisOutreach', () => {
  const accept = makeCV('accepted', 'Alice');
  const reject = makeCV('rejected', 'Bob');

  it('toggles ON : tout en FILE (brouillons), aucun envoi ni brief', async () => {
    hitlConfig = { rejectionMail: true, acceptanceMail: true };
    await dispatchPostAnalysisOutreach({
      campaignId: 'CAMP-1',
      jobTitle: 'Dev',
      summary: summaryOf(accept, reject),
      uids: ['u-accept', 'u-reject'],
      reportArtifactId: 'rep-1',
    });

    expect(at('/api/validations')).toHaveLength(2); // les 2 mis en file
    expect(mailDrafts()).toHaveLength(2); // brouillons composés
    expect(mailSends()).toHaveLength(0); // AUCUN envoi réel
    expect(at('/api/scheduler')).toHaveLength(0); // brief différé
    // Le uid de l'analyse est rattaché à la validation.
    const uids = at('/api/validations').map((c) => (c.body?.payload as { uid?: string })?.uid);
    expect(new Set(uids)).toEqual(new Set(['u-accept', 'u-reject']));
  });

  it('toggles OFF : envoi AUTOMATIQUE (mail réel + brief pour l’accept)', async () => {
    hitlConfig = { rejectionMail: false, acceptanceMail: false };
    await dispatchPostAnalysisOutreach({
      campaignId: 'CAMP-1',
      jobTitle: 'Dev',
      summary: summaryOf(accept, reject),
      uids: ['u-accept', 'u-reject'],
      reportArtifactId: 'rep-1',
    });

    expect(at('/api/validations')).toHaveLength(0); // rien en file
    expect(mailSends()).toHaveLength(2); // envois réels
    expect(mailDrafts()).toHaveLength(0);
    expect(at('/api/scheduler')).toHaveLength(1); // brief du seul accept
  });

  it('toggle MIXTE (refus ON / accept OFF) : refus en file, accept auto', async () => {
    hitlConfig = { rejectionMail: true, acceptanceMail: false };
    await dispatchPostAnalysisOutreach({
      campaignId: 'CAMP-1',
      jobTitle: 'Dev',
      summary: summaryOf(accept, reject),
      uids: ['u-accept', 'u-reject'],
      reportArtifactId: 'rep-1',
    });

    expect(at('/api/validations')).toHaveLength(1); // le refus
    expect(at('/api/validations')[0]?.body?.decision).toBe('reject');
    expect(mailSends()).toHaveLength(1); // l'accept envoyé auto
    expect(mailDrafts()).toHaveLength(1); // brouillon du refus en file
    expect(at('/api/scheduler')).toHaveLength(1); // brief de l'accept
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

  it('Switcher régénère la chaîne INVERSE (brouillon invite) et flippe la décision', async () => {
    const res = await switchValidation(makeValidation('reject'));
    // Brouillon de la décision inverse (accept → mode invite, draft).
    const draft = at('/api/mail-composer').find((c) => c.body?.draft === true);
    expect(draft?.body?.mode).toBe('invite');
    // PATCH : décision flippée, confirmed reset, uid préservé.
    const patch = at('/api/validations/val-1')[0];
    expect(patch?.body?.decision).toBe('accept');
    expect(patch?.body?.confirmed).toBe(false);
    expect((patch?.body?.payload as { uid?: string })?.uid).toBe('u-bob');
    expect(res.ok).toBe(true);
    expect(res.validation?.decision).toBe('accept');
  });
});
