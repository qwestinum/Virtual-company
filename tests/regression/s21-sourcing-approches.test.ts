/**
 * S21 — Module Sourcing, arbitrage et approche, sur la base réelle.
 * Spec : docs/specs/sourcing.md §7-8.
 *
 * Vérifie que les écritures du lot 3 passent les CONTRAINTES du lot 1 (ce que
 * les tests unitaires, base simulée, ne peuvent pas prouver) :
 *   1. décliner ⇒ exclusion de campagne PUIS ligne supprimée ; le profil ne
 *      revient pas dans le dédoublonnage d'une nouvelle recherche ;
 *   2. préparer ⇒ approche active, message avec `[lien]`, empreinte de jeton ;
 *   3. confirmer ⇒ profil contacté (auteur + date), exclusion « contacted »,
 *      et une exclusion « declined » existante n'est jamais rétrogradée ;
 *   4. annuler ⇒ lien révoqué ; un lien déjà ouvert ne se révoque pas ;
 *   5. préférences du recruteur persistées.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listKnownFingerprints } from '@/lib/db/repos/sourcing';
import {
  confirmSourcingApproach,
  declineSourcingProfile,
  getSourcingApproach,
  getSourcingPreferences,
  getSourcingProfile,
  insertSourcingApproach,
  patchSourcingPreferences,
  revokeSourcingApproach,
} from '@/lib/db/repos/sourcing-approaches';
import { mintApproachToken } from '@/lib/sourcing/approach-token';
import { LINK_PLACEHOLDER } from '@/lib/sourcing/message';

import { cleanAll, db, newTestCampaignId } from './helpers/db';

const camp = newTestCampaignId('s21');
const RECRUITER = randomUUID();
const hex = () => (randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 64);
const FP = { declined: hex(), contacted: hex(), cancelled: hex() };
const ids: Record<string, string> = {};

async function cleanOwn(): Promise<void> {
  await db().from('sourcing_exclusions').delete().in('fingerprint', Object.values(FP));
  await db().from('recruiters').delete().eq('id', RECRUITER);
  await cleanAll();
}

beforeAll(async () => {
  await cleanOwn();
  const c = await db().from('campaigns').insert({ id: camp, name: '[TREG] S21', status: 'active', fdp: {} });
  if (c.error) throw new Error(c.error.message);
  const r = await db().from('recruiters').insert({ id: RECRUITER, display_name: 'Jane S21', email: 'jane-s21@test.local' });
  if (r.error) throw new Error(r.error.message);
  const s = await db()
    .from('sourcing_searches')
    .insert({ campaign_id: camp, query: 'q', query_generated: 'q', query_method: 'llm', language: 'fr', requested: 100, returned: 3, new_after_dedup: 3 })
    .select('id')
    .single();
  if (s.error) throw new Error(s.error.message);
  for (const [key, fingerprint] of Object.entries(FP)) {
    const p = await db()
      .from('sourcing_profiles')
      .insert({ campaign_id: camp, search_id: s.data.id, fingerprint, exa_rank: Object.keys(ids).length + 1, state: 'to_review', exa_snapshot: { name: key } })
      .select('id')
      .single();
    if (p.error) throw new Error(p.error.message);
    ids[key] = p.data.id as string;
  }
});

afterAll(cleanOwn);

describe('S21.1 — décliner', () => {
  it('exclusion posée, ligne supprimée, et le profil est reconnu comme exclu par une nouvelle recherche', async () => {
    const profile = (await getSourcingProfile(ids.declined!))!;
    await declineSourcingProfile(profile);
    expect(await getSourcingProfile(ids.declined!)).toBeNull();
    const known = await listKnownFingerprints(camp, [FP.declined]);
    expect(known.excluded.has(FP.declined)).toBe(true);
    expect(known.seen.has(FP.declined)).toBe(false);
  });
});

describe('S21.2-3 — préparer puis confirmer', () => {
  it('l’approche passe les contraintes : message avec [lien], jeton haché', async () => {
    const profile = (await getSourcingProfile(ids.contacted!))!;
    const { tokenHash } = mintApproachToken();
    ids.approach = await insertSourcingApproach({
      profile,
      recruiterId: RECRUITER,
      channel: 'linkedin',
      messageFormat: 'connection_note',
      message: `Bonjour, votre parcours nous intéresse : ${LINK_PLACEHOLDER} — Jane`,
      tokenHash,
    });
    const a = (await getSourcingApproach(ids.approach))!;
    expect(a.status).toBe('active');
    expect(a.message).toContain(LINK_PLACEHOLDER);
  });

  it('confirmer : profil contacté avec auteur et date, exclusion « contacted »', async () => {
    const a = (await getSourcingApproach(ids.approach!))!;
    await confirmSourcingApproach(a, RECRUITER, `Bonjour Claire : ${LINK_PLACEHOLDER} — Jane`);
    const { data: prof } = await db().from('sourcing_profiles').select('state, decided_at, decided_by_user_id').eq('id', ids.contacted!).single();
    expect(prof).toMatchObject({ state: 'contacted', decided_by_user_id: RECRUITER });
    expect(prof!.decided_at).not.toBeNull();
    const { data: ex } = await db().from('sourcing_exclusions').select('reason, campaign_id').eq('fingerprint', FP.contacted);
    expect(ex).toEqual([{ reason: 'contacted', campaign_id: camp }]);
    expect((await getSourcingApproach(ids.approach!))!.message).toBe(`Bonjour Claire : ${LINK_PLACEHOLDER} — Jane`);
  });

  it('une exclusion « declined » n’est jamais rétrogradée par une confirmation ultérieure', async () => {
    const fake = { ...(await getSourcingApproach(ids.approach!))!, fingerprint: FP.declined, profileId: null };
    await confirmSourcingApproach(fake, RECRUITER, `x ${LINK_PLACEHOLDER}`);
    const { data: ex } = await db().from('sourcing_exclusions').select('reason').eq('fingerprint', FP.declined).eq('campaign_id', camp);
    expect(ex).toEqual([{ reason: 'declined' }]);
  });
});

describe('S21.4 — annuler', () => {
  it('un lien jamais ouvert est révoqué ; un lien ouvert ne l’est pas', async () => {
    const profile = (await getSourcingProfile(ids.cancelled!))!;
    const first = await insertSourcingApproach({ profile, recruiterId: RECRUITER, channel: 'linkedin', messageFormat: 'inmail', message: `a ${LINK_PLACEHOLDER}`, tokenHash: mintApproachToken().tokenHash });
    expect(await revokeSourcingApproach(first)).toBe(true);
    expect((await getSourcingApproach(first))!.status).toBe('revoked');

    const opened = await insertSourcingApproach({ profile, recruiterId: RECRUITER, channel: 'linkedin', messageFormat: 'inmail', message: `b ${LINK_PLACEHOLDER}`, tokenHash: mintApproachToken().tokenHash });
    await db().from('sourcing_approaches').update({ first_opened_at: new Date().toISOString() }).eq('id', opened);
    expect(await revokeSourcingApproach(opened)).toBe(false);
    expect((await getSourcingApproach(opened))!.status).toBe('active');
  });

  it('la base refuse une note de connexion de plus de 300 caractères', async () => {
    const profile = (await getSourcingProfile(ids.cancelled!))!;
    await expect(
      insertSourcingApproach({ profile, recruiterId: RECRUITER, channel: 'linkedin', messageFormat: 'connection_note', message: `${'x'.repeat(300)} ${LINK_PLACEHOLDER}`, tokenHash: mintApproachToken().tokenHash }),
    ).rejects.toThrow(/note_length/);
  });
});

describe('S21.5 — préférences du recruteur', () => {
  it('format et tri persistés sur la fiche recruteur', async () => {
    expect(await getSourcingPreferences(RECRUITER)).toEqual({ messageFormat: 'connection_note', availableFirst: true });
    expect(await patchSourcingPreferences(RECRUITER, { messageFormat: 'inmail', availableFirst: false })).toBe(true);
    expect(await getSourcingPreferences(RECRUITER)).toEqual({ messageFormat: 'inmail', availableFirst: false });
    expect(await patchSourcingPreferences(randomUUID(), { availableFirst: false })).toBe(false);
  });
});
