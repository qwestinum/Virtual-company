/**
 * Routes publiques de la page d'atterrissage — débit fail-closed AVANT le
 * corps, formulaire accepté seulement là où la page l'affiche, une seule
 * réservation, opposition globale.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const approach = {
  id: '11111111-2222-3333-4444-555555555555', campaignId: 'CAMP-2026-293', profileId: 'p1', fingerprint: 'f'.repeat(64),
  recruiterId: 'u1', status: 'active', submission: null, admissionAttempts: 0,
};
const view = { organizationName: 'Cabinet', logoUrl: null, accentColor: null, recruiterName: null, recruiterMessage: null, job: null, privacyContact: null, initial: {} };

vi.mock('@/lib/jobboard/rate-limit', () => ({
  clientIp: () => '1.2.3.4',
  consumeQuota: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));
vi.mock('@/lib/sourcing/server/landing-context', () => ({
  resolveLandingContext: vi.fn(async () => ({ state: { kind: 'form', prefilled: true }, approach, view })),
}));
vi.mock('@/lib/db/repos/sourcing-admission', () => ({
  reserveSubmission: vi.fn(async () => true),
  getLandingApproach: vi.fn(async () => ({ ...approach, status: 'admission_pending' })),
  recordOpposition: vi.fn(async () => ({ profilesDeleted: 2, approachesRevoked: 1 })),
}));
vi.mock('@/lib/sourcing/server/admit', () => ({
  admitSourcedCandidate: vi.fn(async () => ({ kind: 'admitted', analysisId: 'can_src_x', recruiterName: 'Jane R.' })),
}));
vi.mock('@/lib/storage/blob', () => ({ uploadArtifactBinary: vi.fn(), deleteArtifact: vi.fn(async () => {}) }));
vi.mock('@/lib/db/repos/journal', () => ({ appendJournalEntry: vi.fn(async () => {}) }));

import { POST as oppose } from '@/app/api/sourcing/approach/[token]/oppose/route';
import { POST as submit } from '@/app/api/sourcing/approach/[token]/submit/route';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { recordOpposition, reserveSubmission } from '@/lib/db/repos/sourcing-admission';
import { consumeQuota } from '@/lib/jobboard/rate-limit';
import { admitSourcedCandidate } from '@/lib/sourcing/server/admit';
import { resolveLandingContext } from '@/lib/sourcing/server/landing-context';

const params = { params: Promise.resolve({ token: 'AbCdEfGhIjKlMnOpQrStUv' }) };
const valid = { email: 'claire@exemple.fr', phone: '', consent: true, fullName: 'Claire Martin', workHistory: [], education: [], about: null };
const formRequest = (submission: unknown) => {
  const body = new FormData();
  body.append('submission', JSON.stringify(submission));
  return new Request('http://x', { method: 'POST', body });
};

beforeEach(() => {
  vi.mocked(reserveSubmission).mockClear();
  vi.mocked(admitSourcedCandidate).mockClear();
});

describe('soumission', () => {
  it('débit épuisé ⇒ 429 sans lire le corps ni toucher au lien', async () => {
    vi.mocked(consumeQuota).mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 120 });
    const request = formRequest(valid);
    const spy = vi.spyOn(request, 'formData');
    const res = await submit(request, params);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('120');
    expect(spy).not.toHaveBeenCalled();
    expect(resolveLandingContext).not.toHaveBeenCalled();
  });

  it('case non cochée ⇒ 400, rien de réservé', async () => {
    const res = await submit(formRequest({ ...valid, consent: false }), params);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toMatch(/cocher la case/);
    expect(reserveSubmission).not.toHaveBeenCalled();
  });

  it('nominal : réservation puis réponse « bien reçue » — l’admission part sur le RAIL, jamais dans la requête', async () => {
    const res = await submit(formRequest(valid), params);
    expect(await res.json()).toEqual({ outcome: 'received', firstName: 'Claire' });
    expect(vi.mocked(reserveSubmission).mock.calls[0]![1]).toMatchObject({ email: 'claire@exemple.fr', consent: true, cv: null });
    // La personne n'attend ni analyse, ni PDF, ni mail derrière son clic.
    expect(admitSourcedCandidate).not.toHaveBeenCalled();
  });

  it('réponse rapide : rien derrière la réservation n’est attendu', async () => {
    const started = performance.now();
    const res = await submit(formRequest(valid), params);
    expect(res.status).toBe(200);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('second envoi (réservation perdue) ⇒ « bien reçue », aucune seconde admission', async () => {
    vi.mocked(reserveSubmission).mockResolvedValueOnce(false);
    const res = await submit(formRequest(valid), params);
    expect(((await res.json()) as { outcome: string }).outcome).toBe('received');
    expect(admitSourcedCandidate).not.toHaveBeenCalled();
  });

  it('offre fermée ⇒ aucune lecture du formulaire, aucune réservation', async () => {
    vi.mocked(resolveLandingContext).mockResolvedValueOnce({ state: { kind: 'closed' }, approach, view } as never);
    const res = await submit(formRequest(valid), params);
    expect(await res.json()).toEqual({ outcome: 'closed' });
    expect(reserveSubmission).not.toHaveBeenCalled();
  });
});

describe('opposition', () => {
  it('exclusion globale par empreinte, journal sans donnée personnelle', async () => {
    const res = await oppose(new Request('http://x', { method: 'POST' }), params);
    expect(await res.json()).toEqual({ outcome: 'opposed' });
    expect(recordOpposition).toHaveBeenCalledWith('f'.repeat(64));
    const entry = vi.mocked(appendJournalEntry).mock.calls.at(-1)![0];
    expect(entry.action).toBe('sourcing_opposition_recorded');
    expect(JSON.stringify(entry.payload)).not.toMatch(/@|Claire/);
  });

  it('lien inconnu ⇒ rien à exclure', async () => {
    vi.mocked(recordOpposition).mockClear();
    vi.mocked(resolveLandingContext).mockResolvedValueOnce({ state: { kind: 'unavailable' }, approach: null, view } as never);
    expect(await (await oppose(new Request('http://x', { method: 'POST' }), params)).json()).toEqual({ outcome: 'unavailable' });
    expect(recordOpposition).not.toHaveBeenCalled();
  });
});
