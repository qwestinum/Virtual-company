/**
 * Arbitrage et approche — ce que les routes écrivent, et ce qu'elles refusent.
 * Modèle, base et flag simulés : c'est la décision qui est testée.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const profile = {
  id: 'p1',
  campaignId: 'CAMP-2026-293',
  fingerprint: 'f'.repeat(64),
  state: 'to_review' as const,
  snapshot: {
    url: 'https://www.linkedin.com/in/claire', name: 'Claire Martin', firstName: 'Claire', location: 'Paris', headline: null,
    current: { title: 'Business Analyst', company: 'Banque X', since: '2024-05-01' }, workHistory: [], education: [],
    about: null, skills: null, languages: null, certifications: null, highlight: null, indexedAt: null,
    contacts: { emails: ['claire.martin@exemple.fr'] }, availability: null,
  },
};
const approach = {
  id: 'a1', campaignId: 'CAMP-2026-293', profileId: 'p1', fingerprint: 'f'.repeat(64), recruiterId: 'u1',
  channel: 'linkedin' as const, messageFormat: 'connection_note' as const, message: 'x', status: 'active' as const, firstOpenedAt: null,
};

vi.mock('@/lib/sourcing/flag', () => ({ isSourcingEnabled: vi.fn(async () => true) }));
vi.mock('@/lib/auth/require-api-user', () => ({
  getApiUser: vi.fn(async () => ({ id: 'u1', email: 'jane@cabinet.fr' })),
  unauthorizedResponse: () => new Response('{}', { status: 401 }),
}));
vi.mock('@/lib/db/repos/campaigns', () => ({
  getCampaign: vi.fn(async () => ({ id: 'CAMP-2026-293', status: 'active', fdp: { fields: { job_title: { value: 'Business Analyst' }, location: { value: 'Paris' } } }, scoringSheet: null })),
}));
vi.mock('@/lib/db/repos/sourcing-approaches', () => ({
  getSourcingProfile: vi.fn(async () => profile),
  getSourcingApproach: vi.fn(async () => approach),
  declineSourcingProfile: vi.fn(async () => {}),
  insertSourcingApproach: vi.fn(async () => 'a1'),
  confirmSourcingApproach: vi.fn(async () => {}),
  revokeSourcingApproach: vi.fn(async () => true),
  getSourcingPreferences: vi.fn(async () => ({ messageFormat: 'connection_note', availableFirst: true })),
}));
vi.mock('@/lib/db/repos/recruiters', () => ({ getRecruiter: vi.fn(async () => ({ displayName: 'Jane Recruteuse' })) }));
vi.mock('@/lib/db/repos/app-settings', () => ({ getAppSettings: vi.fn(async () => null) }));
vi.mock('@/lib/db/repos/journal', () => ({ appendJournalEntry: vi.fn(async () => {}) }));
vi.mock('@/lib/sourcing/server/compose-message', () => ({
  composeApproachMessage: vi.fn(async () => ({ subject: null, body: 'Bonjour Claire, votre parcours nous intéresse : [lien] — Jane', method: 'llm' })),
}));

import { POST as approachAction } from '@/app/api/sourcing/approaches/[id]/route';
import { POST as decline } from '@/app/api/sourcing/profiles/[id]/decline/route';
import { POST as prepare } from '@/app/api/sourcing/profiles/[id]/approaches/route';
import { getApiUser } from '@/lib/auth/require-api-user';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import {
  confirmSourcingApproach,
  declineSourcingProfile,
  getSourcingProfile,
  insertSourcingApproach,
} from '@/lib/db/repos/sourcing-approaches';
import { isSourcingEnabled } from '@/lib/sourcing/flag';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  vi.mocked(insertSourcingApproach).mockClear();
  vi.mocked(confirmSourcingApproach).mockClear();
  vi.mocked(declineSourcingProfile).mockClear();
  vi.mocked(appendJournalEntry).mockClear();
});

describe('préparer une approche', () => {
  it('stocke le message avec [lien] et une empreinte de jeton ; rend le texte avec la vraie URL', async () => {
    const res = await prepare(post({ channel: 'linkedin' }), params('p1'));
    const json = (await res.json()) as { message: string; url: string };
    expect(res.status).toBe(200);
    const stored = vi.mocked(insertSourcingApproach).mock.calls[0]![0];
    expect(stored.message).toContain('[lien]');
    expect(stored.message).not.toContain('/s/');
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(json.url).toMatch(/\/s\/[A-Za-z0-9_-]{22}$/);
    expect(json.message).toContain(json.url);
    // Le jeton en clair n'est dans RIEN de ce qui est écrit en base.
    const token = json.url.split('/s/')[1]!;
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('contacter par email exige une adresse attribuable à la personne', async () => {
    vi.mocked(getSourcingProfile).mockResolvedValueOnce({ ...profile, snapshot: { ...profile.snapshot, contacts: { emails: [] } } });
    const res = await prepare(post({ channel: 'email' }), params('p1'));
    expect(res.status).toBe(409);
    expect(insertSourcingApproach).not.toHaveBeenCalled();
  });

  it('module éteint ⇒ 404, rien n’est rédigé', async () => {
    vi.mocked(isSourcingEnabled).mockResolvedValueOnce(false);
    expect((await prepare(post({ channel: 'linkedin' }), params('p1'))).status).toBe(404);
    expect(insertSourcingApproach).not.toHaveBeenCalled();
  });
});

describe('confirmer ou annuler', () => {
  const URL = 'https://orqa.exemple.fr/s/AbCdEfGhIjKlMnOpQrStUv';

  it('confirmer : message stocké sans l’URL, journal sans donnée personnelle', async () => {
    const res = await approachAction(post({ action: 'confirm', message: `Bonjour Claire : ${URL} — Jane`, url: URL }), params('a1'));
    expect(res.status).toBe(200);
    const [, , stored] = vi.mocked(confirmSourcingApproach).mock.calls[0]!;
    expect(stored).toBe('Bonjour Claire : [lien] — Jane');
    const payload = JSON.stringify(vi.mocked(appendJournalEntry).mock.calls[0]![0].payload);
    expect(payload).not.toMatch(/Claire|Martin|exemple\.fr|linkedin\.com|AbCdEf/);
  });

  it('un message dont le lien a été retiré est refusé', async () => {
    const res = await approachAction(post({ action: 'confirm', message: 'Bonjour Claire', url: URL }), params('a1'));
    expect(res.status).toBe(422);
    expect(confirmSourcingApproach).not.toHaveBeenCalled();
  });

  it('une note de plus de 300 caractères, lien compris, est refusée', async () => {
    const res = await approachAction(post({ action: 'confirm', message: `${'x'.repeat(290)} ${URL}`, url: URL }), params('a1'));
    expect(res.status).toBe(422);
  });

  it('seul le recruteur de l’approche peut la confirmer', async () => {
    vi.mocked(getApiUser).mockResolvedValueOnce({ id: 'u2', email: 'autre@cabinet.fr' } as never);
    const res = await approachAction(post({ action: 'confirm', message: `x ${URL}`, url: URL }), params('a1'));
    expect(res.status).toBe(403);
  });
});

describe('décliner', () => {
  it('pose l’exclusion et supprime le profil ; journal = empreinte seule', async () => {
    const res = await decline(post({}), params('p1'));
    expect(res.status).toBe(200);
    expect(declineSourcingProfile).toHaveBeenCalledOnce();
    expect(vi.mocked(appendJournalEntry).mock.calls[0]![0]).toMatchObject({
      action: 'sourcing_profile_declined',
      payload: { fingerprint: 'f'.repeat(64) },
    });
  });

  it('un profil déjà approché ne se décline plus', async () => {
    vi.mocked(getSourcingProfile).mockResolvedValueOnce({ ...profile, state: 'contacted' as never });
    expect((await decline(post({}), params('p1'))).status).toBe(409);
    expect(declineSourcingProfile).not.toHaveBeenCalled();
  });
});
