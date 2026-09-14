/**
 * L'état APEC servi au panneau — et surtout ce qu'il ne resynchronise pas.
 *
 * Le cas qui porte ce fichier est le dernier : une annonce générique modifiée
 * APRÈS la publication APEC ne doit rien changer à ce qui est parti. Le
 * brouillon, lui, est vivant — c'est ce qu'on republierait.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-api-user', () => ({
  getApiUser: vi.fn(),
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/campaign/reception-address', () => ({
  resolveCampaignReceptionAddress: vi.fn(),
}));
vi.mock('@/lib/db/repos/app-settings', () => ({ getAppSettings: vi.fn() }));
vi.mock('@/lib/db/repos/campaigns', () => ({ getCampaign: vi.fn() }));
vi.mock('@/lib/db/repos/demo-job-posts', () => ({ getJobPost: vi.fn() }));
vi.mock('@/lib/db/repos/job-postings', () => ({ listJobPostings: vi.fn() }));
vi.mock('@/lib/db/repos/recruiters', () => ({ getRecruiter: vi.fn() }));
vi.mock('@/lib/db/repos/sites', () => ({ getSite: vi.fn() }));
vi.mock('@/lib/jobboards/adep/service', () => ({ isAdepEnabled: () => false }));

import { GET } from '@/app/api/campaigns/[id]/adep/route';
import { getApiUser } from '@/lib/auth/require-api-user';
import { resolveCampaignReceptionAddress } from '@/lib/campaign/reception-address';
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { getJobPost } from '@/lib/db/repos/demo-job-posts';
import { listJobPostings } from '@/lib/db/repos/job-postings';
import { getRecruiter } from '@/lib/db/repos/recruiters';
import { getSite } from '@/lib/db/repos/sites';
import { ADEP_LIMITS } from '@/lib/jobboards/adep/validate';
import type { DemoJobPost } from '@/types/job-post';

const user = vi.mocked(getApiUser);
const campaign = vi.mocked(getCampaign);
const post = vi.mocked(getJobPost);
const history = vi.mocked(listJobPostings);
const settings = vi.mocked(getAppSettings);
const site = vi.mocked(getSite);
const recruiter = vi.mocked(getRecruiter);
const address = vi.mocked(resolveCampaignReceptionAddress);

const ID = 'CAMP-2026-511';
const params = { params: Promise.resolve({ id: ID }) };
const request = new Request(`http://localhost/api/campaigns/${ID}/adep`);

const BODY_GENERIC =
  'Vous rejoignez une équipe de huit personnes pour tenir la comptabilité générale du groupe. '.repeat(
    3,
  );

function genericPost(over: Partial<DemoJobPost> = {}): DemoJobPost {
  return {
    campaignId: ID,
    title: 'Comptable général confirmé',
    body: BODY_GENERIC,
    tags: [],
    location: 'Tours',
    contract: 'CDI',
    isVisible: true,
    publishedAt: '2026-08-12T09:30:00.000Z',
    updatedAt: '2026-08-12T09:30:00.000Z',
    ...over,
  };
}

type Json = {
  draft: { positionTitle: string; positionDescription: string };
  notes: Record<string, { origin: string; from?: string } | undefined>;
  prefill: { source: string; label: string } | null;
  prefillIssues: { level: string; field: string; message: string }[];
  posting: { clientReference: string; requestXml: string | null } | null;
};

async function callGet(): Promise<Json> {
  const res = await GET(request, params);
  expect(res.status).toBe(200);
  return (await res.json()) as Json;
}

describe('GET /api/campaigns/[id]/adep — pré-remplissage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    user.mockResolvedValue({ id: 'u1', email: 'rh@exemple.fr' } as never);
    campaign.mockResolvedValue({
      id: ID,
      fdp: { fields: { job_title: { value: 'Comptable général' } } },
      siteId: null,
      ownerUserId: 'u1',
    } as never);
    settings.mockResolvedValue(null as never);
    site.mockResolvedValue(null as never);
    recruiter.mockResolvedValue({
      id: 'u1',
      displayName: 'Jane R.',
      hasAdepNumeroDossier: true,
    } as never);
    address.mockResolvedValue('recrutement@exemple.fr' as never);
    history.mockResolvedValue([] as never);
    post.mockResolvedValue(null as never);
  });

  afterEach(() => vi.clearAllMocks());

  it('reprend le titre et le corps de l’annonce générique publiée', async () => {
    post.mockResolvedValue(genericPost() as never);
    const json = await callGet();

    expect(json.draft.positionTitle).toBe('Comptable général confirmé');
    expect(json.draft.positionDescription).toBe(BODY_GENERIC.trim());
    expect(json.prefill?.source).toBe('generic_published');
    // La provenance est affichée sous le champ : un texte pré-rempli sans
    // explication passe pour une saisie qu'on aurait oubliée.
    expect(json.notes.positionDescription?.from).toContain('annonce générique publiée');
    expect(json.notes.positionTitle?.origin).toBe('certain');
  });

  it('sans annonce générique, laisse le descriptif vide et le DIT', async () => {
    const json = await callGet();

    expect(json.prefill).toBeNull();
    expect(json.draft.positionDescription).toBe('');
    // L'intitulé retombe sur la fiche de poste — jamais rien d'inventé.
    expect(json.draft.positionTitle).toBe('Comptable général');
    expect(json.notes.positionDescription?.origin).toBe('missing');
    expect(json.prefillIssues).toEqual([]);
  });

  it('affiche les écarts d’un descriptif trop long SANS le tronquer', async () => {
    const long = 'x'.repeat(ADEP_LIMITS.positionDescriptionMax + 500);
    post.mockResolvedValue(genericPost({ body: long }) as never);
    const json = await callGet();

    expect(json.draft.positionDescription).toHaveLength(long.length);
    const issue = json.prefillIssues.find((i) => i.field === 'positionDescription');
    expect(issue?.level).toBe('error');
    expect(issue?.message).toContain('À raccourcir');
  });

  it('ne re-synchronise PAS une offre déjà publiée quand le générique change', async () => {
    // L'offre est partie le 12/08 avec le texte de l'époque…
    const published = {
      id: 'jp1',
      campaignId: ID,
      channel: 'apec',
      clientReference: `${ID}-1`,
      apecPositionNumero: '177596708W',
      attemptState: 'acknowledged',
      requestXml: `<PositionDescription>${BODY_GENERIC.trim()}</PositionDescription>`,
      remoteStatus: 'PUBLIEE',
      publishedAt: '2026-08-12T10:00:00.000Z',
    };
    // La tentative courante est la plus récente de l'historique : la route ne
    // relit plus la table pour la retrouver.
    history.mockResolvedValue([published] as never);
    // …et l'annonce générique a été réécrite depuis.
    const rewritten = 'Texte entièrement réécrit après la publication. '.repeat(6);
    post.mockResolvedValue(
      genericPost({ body: rewritten, updatedAt: '2026-09-01T08:00:00.000Z' }) as never,
    );

    const json = await callGet();

    // Ce qui est PARTI est figé : la réécriture ne l'a pas touché.
    expect(json.posting?.requestXml).toContain('comptabilité générale');
    expect(json.posting?.requestXml).not.toContain('entièrement réécrit');
    // Le brouillon, lui, est vivant — c'est le texte qu'on republierait.
    expect(json.draft.positionDescription).toBe(rewritten.trim());
  });

  it('ne tombe pas quand la table du jobboard est absente', async () => {
    // Une installation qui n'a jamais activé la démonstration n'a pas la
    // table : un panneau APEC vide vaut mieux qu'un panneau en erreur.
    post.mockRejectedValue(new Error('relation "demo_job_posts" does not exist'));
    const json = await callGet();

    expect(json.prefill).toBeNull();
    expect(json.draft.positionTitle).toBe('Comptable général');
  });
});

describe('GET /api/campaigns/[id]/adep — lectures groupées', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    campaign.mockResolvedValue({
      id: ID,
      fdp: { fields: { job_title: { value: 'Comptable général' } } },
      siteId: null,
      ownerUserId: null,
    } as never);
    settings.mockResolvedValue(null as never);
    address.mockResolvedValue(null as never);
    history.mockResolvedValue([] as never);
    post.mockResolvedValue(null as never);
  });

  it('401 sans session, même si la lecture de la campagne échoue', async () => {
    user.mockResolvedValue(null as never);
    campaign.mockRejectedValue(new Error('boom'));
    const res = await GET(request, params);
    expect(res.status).toBe(401);
  });

  it('404 prime sur un échec de lecture de l’historique', async () => {
    user.mockResolvedValue({ id: 'u1' } as never);
    campaign.mockResolvedValue(null as never);
    history.mockRejectedValue(new Error('boom'));
    const res = await GET(request, params);
    expect(res.status).toBe(404);
  });

  it('500 quand l’historique est illisible sur une campagne existante', async () => {
    user.mockResolvedValue({ id: 'u1' } as never);
    history.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await GET(request, params);
    expect(res.status).toBe(500);
  });

  it('lit l’historique UNE fois et en rend la tentative la plus récente', async () => {
    user.mockResolvedValue({ id: 'u1' } as never);
    const recent = { id: 'jp2', clientReference: `${ID}-2`, requestXml: null };
    const older = { id: 'jp1', clientReference: `${ID}-1`, requestXml: null };
    history.mockResolvedValue([recent, older] as never);
    const res = await GET(request, params);
    const json = (await res.json()) as Json & { history: unknown[] };
    expect(history).toHaveBeenCalledTimes(1);
    expect(json.posting?.clientReference).toBe(`${ID}-2`);
    expect(json.history).toHaveLength(2);
  });
});
