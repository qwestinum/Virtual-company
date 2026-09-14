/**
 * Page `/s/<jeton>` — un robot d'aperçu n'écrit RIEN.
 *
 * Défaut corrigé le 14/09/2026 : le quota était consommé AVANT le test du
 * robot. Chaque aperçu de lien (LinkedIn, messagerie, client mail) entamait
 * donc le débit de la vraie personne derrière la même passerelle. Aucune
 * écriture — quota, première ouverture, journal — ne doit précéder ce filtre.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const headerValues = new Map<string, string>();
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => headerValues.get(name.toLowerCase()) ?? null }),
}));
const afterCallbacks: (() => unknown)[] = [];
vi.mock('next/server', () => ({ after: (cb: () => unknown) => afterCallbacks.push(cb) }));
vi.mock('@/lib/jobboard/rate-limit', () => ({
  consumeQuota: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));
vi.mock('@/lib/db/repos/sourcing-admission', () => ({ markApproachOpened: vi.fn(async () => true) }));
vi.mock('@/lib/db/repos/journal', () => ({ appendJournalEntry: vi.fn(async () => {}) }));
vi.mock('@/lib/sourcing/server/landing-context', () => ({ resolveLandingContext: vi.fn() }));
vi.mock('@/components/sourcing-landing/LandingForm', () => ({ LandingForm: () => null }));
vi.mock('@/components/sourcing-landing/LandingShell', () => ({
  LandingShell: () => null,
  LandingNotice: () => null,
}));

import { appendJournalEntry } from '@/lib/db/repos/journal';
import { markApproachOpened } from '@/lib/db/repos/sourcing-admission';
import { consumeQuota } from '@/lib/jobboard/rate-limit';
import { resolveLandingContext } from '@/lib/sourcing/server/landing-context';

import SourcingLandingPage from '../page';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const approach = { id: 'ap1', campaignId: 'CAMP-2026-001', firstOpenedAt: null };

function contextWith(firstOpenedAt: string | null) {
  return {
    state: { kind: 'form', prefilled: {} },
    approach: { ...approach, firstOpenedAt },
    view: { organizationName: 'Cabinet' },
  };
}

async function open(userAgent: string | null) {
  headerValues.clear();
  if (userAgent !== null) headerValues.set('user-agent', userAgent);
  headerValues.set('x-forwarded-for', '203.0.113.7');
  await SourcingLandingPage({ params: Promise.resolve({ token: TOKEN }) });
  for (const cb of afterCallbacks.splice(0)) await cb();
}

describe('/s/<jeton> — ouverture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterCallbacks.length = 0;
    vi.mocked(resolveLandingContext).mockResolvedValue(contextWith(null) as never);
  });

  it.each([
    'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
    'WhatsApp/2.23.20.0',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  ])('un robot d’aperçu (%s) n’écrit RIEN : ni quota, ni ouverture, ni journal', async (ua) => {
    await open(ua);
    expect(consumeQuota).not.toHaveBeenCalled();
    expect(markApproachOpened).not.toHaveBeenCalled();
    expect(appendJournalEntry).not.toHaveBeenCalled();
  });

  it('sans user-agent : traité comme un robot, rien n’est écrit', async () => {
    await open(null);
    expect(consumeQuota).not.toHaveBeenCalled();
    expect(markApproachOpened).not.toHaveBeenCalled();
  });

  it('une personne : quota consommé, première ouverture marquée et journalisée', async () => {
    await open('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
    expect(consumeQuota).toHaveBeenCalledTimes(1);
    expect(markApproachOpened).toHaveBeenCalledWith('ap1');
    expect(appendJournalEntry).toHaveBeenCalledTimes(1);
  });

  it('lien déjà ouvert : aucune réécriture de l’ouverture', async () => {
    vi.mocked(resolveLandingContext).mockResolvedValue(contextWith('2026-09-10T08:00:00Z') as never);
    await open('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15');
    expect(markApproachOpened).not.toHaveBeenCalled();
    expect(appendJournalEntry).not.toHaveBeenCalled();
  });
});
