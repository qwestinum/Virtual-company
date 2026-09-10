/**
 * S19 — Connecteur APEC : publier, relire, dépublier, et sortir du doute.
 *
 * Le connecteur n'avait AUCUNE couverture de régression : ses lots 0 à 4 et
 * les correctifs des 09-10/09/2026 ne tenaient que sur des tests unitaires,
 * qui injectent leur transport et ne traversent ni les routes, ni la base, ni
 * le journal. Tout ce qui a coûté du temps en recette vivait précisément dans
 * cet interstice.
 *
 * ⚠️ AUCUN APPEL RÉEL. `tests/regression/setup.ts` coupe `ADEP_ENABLED` pour
 * toute la suite — le risque ici n'est pas un mail de trop, c'est une offre
 * publique sur apec.fr sous une référence brûlée à jamais. Le premier test de
 * ce fichier est le canari qui le vérifie.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const authState: { user: { id: string; email: string } | null } = { user: null };

// Le setup global fige `getApiUser` à `null` ; les routes APEC exigent une
// session (401 sinon). On rebranche l'export, comme S10/S16/S17.
vi.mock('@/lib/auth/require-api-user', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/auth/require-api-user')
  >('@/lib/auth/require-api-user');
  return { ...actual, getApiUser: async () => authState.user };
});

import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { GET as getAdepState } from '@/app/api/campaigns/[id]/adep/route';
import { POST as publishAdep } from '@/app/api/campaigns/[id]/adep/publish/route';
import { POST as transitionAdep } from '@/app/api/campaigns/[id]/adep/transition/route';
import { SAMPLE_OFFER } from '@/lib/jobboards/adep/__tests__/fixtures/sample-offer';
import type { AdepOffer } from '@/types/adep';

import { call, callWithId, testCampaignPayload } from './helpers/api';
import { cleanAll, db, newTestCampaignId, readRows } from './helpers/db';

// ⚠️ SLUGS D'UNE LETTRE, et ce n'est pas de la coquetterie : la référence
// client de l'Apec est bornée à 20 caractères (`API_309`, `isClientReferenceValid`)
// et c'est l'ID DE CAMPAGNE qui la porte. `CAMP-TREG-` (10) + slug + 6 aléatoires
// laisse exactement 4 caractères — un slug `s19a` ferait 21 et TOUTE publication
// partirait en `offer_invalid`, sur un défaut de fixture qu'on lirait comme un
// défaut produit. La tentative suivante (`-2`) tombe pile sur la borne.
const campPublish = newTestCampaignId('a');
const campInvalid = newTestCampaignId('b');
const campDoubt = newTestCampaignId('c');

const USER = { id: '00000000-0000-4000-8000-0000000019ab', email: 'apec@treg.local' };

/**
 * Dates RELATIVES. La fixture unitaire porte des dates en dur (`2026-11-02`) :
 * parfait pour un test à horloge injectée, poison pour une suite qui tourne
 * avant chaque déploiement — elle se mettrait à échouer un beau matin sans que
 * rien n'ait changé.
 */
function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** L'offre que le formulaire enverrait : la référence et le tracking sont posés
 *  par le SERVEUR, jamais par le client (verrou d'idempotence). */
function offerPayload(over: Partial<AdepOffer> = {}) {
  const { clientPositionId: _r, trackingId: _t, ...rest } = SAMPLE_OFFER;
  return {
    ...rest,
    releaseDate: inDays(3),
    datePositionTaken: inDays(45),
    applicationEmail: 'recrutement@treg.local',
    ...over,
  };
}

beforeAll(async () => {
  await cleanAll();
  authState.user = USER;
  for (const id of [campPublish, campInvalid, campDoubt]) {
    const res = await call(putCampaign, { method: 'PUT', body: testCampaignPayload({ id }) });
    expect(res.status).toBe(200);
  }
});
afterAll(async () => {
  authState.user = null;
  await cleanAll();
});

describe('S19 — connecteur APEC', () => {
  it('S19.0 CANARI — la suite ne peut PAS joindre le vrai Apec', () => {
    // Si ce test tombe, ARRÊTER LA SUITE : un scénario de publication créerait
    // une offre réelle, publique, sous une référence non réutilisable.
    expect(process.env.ADEP_ENABLED).not.toBe('1');
    expect(process.env.ADEP_WSDL_URL ?? '').toBe('');
  });

  it('S19.1 l’état du panneau se charge, avec la référence de la tentative', async () => {
    const res = await callWithId(getAdepState, campPublish);
    expect(res.status).toBe(200);
    // La première tentative porte la référence NUE de la campagne (pas de rang).
    expect(res.json.clientReference).toBe(campPublish);
    expect(res.json.simulated).toBe(true);
    expect(Array.isArray(res.json.blockers)).toBe(true);
  });

  it('S19.2 publier → acquittée, ligne en base, journal qui nomme l’environnement', async () => {
    const res = await callWithId(publishAdep, campPublish, {
      method: 'POST',
      body: offerPayload(),
    });
    expect(res.status).toBe(200);
    const outcome = res.json.outcome as { kind: string; remoteId?: string };
    expect(outcome.kind).toBe('published');
    expect(res.json.simulated).toBe(true);

    const rows = await readRows<{
      client_reference: string;
      attempt_state: string;
      apec_position_numero: string | null;
      published_at: string | null;
      request_xml: string | null;
    }>('job_postings', { campaign_id: campPublish });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attempt_state).toBe('acknowledged');
    expect(rows[0]!.apec_position_numero).toBeTruthy();
    expect(rows[0]!.published_at).toBeTruthy();
    // Le flux est archivé, SECRETS CAVIARDÉS — jamais la clé en clair.
    expect(rows[0]!.request_xml).toBeTruthy();
    expect(rows[0]!.request_xml).not.toContain('x'.repeat(342));

    const journal = await readRows<{ action: string; payload: Record<string, unknown> }>(
      'journal',
      { campaign_id: campPublish, action: 'apec_offer_published' },
    );
    expect(journal).toHaveLength(1);
    // Le manque du 09-10/09 : `simulated:false` ne disait pas SI c'était la
    // recette ou la production. L'environnement est désormais nommé.
    expect(journal[0]!.payload.apecEnvironment).toBe('simulation');
  });

  it('S19.3 relire le statut → un VERDICT de lecture, pas seulement « changé ou non »', async () => {
    const res = await callWithId(transitionAdep, campPublish, {
      method: 'POST',
      body: { action: 'refresh' },
    });
    expect(res.status).toBe(200);
    // ⚠️ `changed: false` ne suffit PAS : il vaut aussi pour une lecture qui
    // n'a jamais eu lieu. C'est `read` qui dit que l'Apec a répondu.
    expect(res.json.read).toEqual({ kind: 'found' });
    expect(res.json.changed).toBe(false);
  });

  it('S19.4 dépublier → statut suspendu, date posée, journal daté', async () => {
    const res = await callWithId(transitionAdep, campPublish, {
      method: 'POST',
      body: { action: 'suspend' },
    });
    expect(res.status).toBe(200);
    expect((res.json.outcome as { kind: string }).kind).toBe('changed');

    const rows = await readRows<{ remote_status: string; suspended_at: string | null }>(
      'job_postings',
      { campaign_id: campPublish },
    );
    expect(rows[0]!.remote_status).toBe('SUSPENDUE');
    expect(rows[0]!.suspended_at).toBeTruthy();

    const journal = await readRows<{ payload: Record<string, unknown> }>('journal', {
      campaign_id: campPublish,
      action: 'apec_offer_suspended',
    });
    expect(journal).toHaveLength(1);
    expect(journal[0]!.payload.apecEnvironment).toBe('simulation');
  });

  it('S19.5 une offre invalide est refusée AVANT de consommer une tentative', async () => {
    // Réserver une référence pour un flux qu'on sait refusé ferait partir la
    // publication suivante en `-2` sans raison, et l'Apec n'oublie jamais une
    // référence (`API_390`).
    const res = await callWithId(publishAdep, campInvalid, {
      method: 'POST',
      body: offerPayload({ positionDescription: 'trop court' }),
    });
    expect([422]).toContain(res.status);
    expect(res.json.error).toBe('offer_invalid');

    const rows = await readRows('job_postings', { campaign_id: campInvalid });
    expect(rows).toHaveLength(0);

    // Et la prochaine tentative porte toujours la référence NUE.
    const state = await callWithId(getAdepState, campInvalid);
    expect(state.json.clientReference).toBe(campInvalid);
  });

  it('S19.6 une référence inconnue CLÔT une tentative restée dans le doute', async () => {
    // Le cas CAMP-2026-267 : `openPosition` refusé, vérification refusée à son
    // tour ⇒ ligne `sent`, phase `uncertain`, et le panneau n'offrait plus NI
    // publier NI republier. La campagne était bloquée sans geste de sortie.
    const reference = `${campDoubt}-9`;
    const { error } = await db().from('job_postings').insert({
      id: `JOBP-${reference}`,
      campaign_id: campDoubt,
      channel: 'apec',
      client_reference: reference,
      attempt_state: 'sent',
      tracking_id: 'treg-doubt',
      last_error_message: 'La vérification a échoué à son tour.',
    });
    expect(error).toBeNull();

    const res = await callWithId(transitionAdep, campDoubt, {
      method: 'POST',
      body: { action: 'refresh' },
    });
    expect(res.status).toBe(200);
    expect(res.json.read).toEqual({ kind: 'not_found', resolved: true });

    const rows = await readRows<{ attempt_state: string }>('job_postings', {
      campaign_id: campDoubt,
    });
    expect(rows[0]!.attempt_state).toBe('failed');

    const journal = await readRows('journal', {
      campaign_id: campDoubt,
      action: 'apec_offer_attempt_closed',
    });
    expect(journal).toHaveLength(1);

    // Le panneau rouvre : la tentative suivante prend une référence NEUVE.
    const state = await callWithId(getAdepState, campDoubt);
    expect(state.json.clientReference).toBe(`${campDoubt}-2`);
  });

  it('S19.7 relire une offre acquittée ne la déclasse pas', async () => {
    // ⚠️ CE QUE CE TEST NE PROUVE PAS, et pourquoi c'est écrit ici.
    //
    // La garde anti-doublon proprement dite — un `not_found` sur une ligne
    // ACQUITTÉE ne doit JAMAIS clore la tentative, sans quoi une seconde offre
    // partirait sur apec.fr — est INATTEIGNABLE par les routes en simulation :
    // `mockSeedFromPosting` amorce le mock DEPUIS la ligne, donc dès qu'un
    // numéro Apec existe, la lecture le retrouve forcément. La branche est
    // tenue par le test unitaire de `service.test.ts` (sondé : il tombe quand
    // on retire la garde).
    //
    // Sondé ici aussi, et c'est la raison de ce commentaire : forcer
    // `closable = true` laisse ce fichier VERT. Un test qui ne peut pas
    // échouer ne protège rien — mieux vaut le dire que le laisser croire.
    //
    // Ce qui est réellement vérifié : une relecture répétée sur une offre
    // vivante est sans effet de bord (le cache n'est pas réécrit à tort, l'état
    // ne bouge pas).
    const before = await readRows<{ attempt_state: string; remote_status: string }>(
      'job_postings',
      { campaign_id: campPublish },
    );
    expect(before[0]!.attempt_state).toBe('acknowledged');

    const res = await callWithId(transitionAdep, campPublish, {
      method: 'POST',
      body: { action: 'refresh' },
    });
    expect(res.status).toBe(200);
    expect((res.json.read as { kind: string }).kind).toBe('found');
    expect(res.json.changed).toBe(false);

    const after = await readRows<{ attempt_state: string; remote_status: string }>(
      'job_postings',
      { campaign_id: campPublish },
    );
    expect(after[0]!.attempt_state).toBe('acknowledged');
    expect(after[0]!.remote_status).toBe(before[0]!.remote_status);
  });
});
