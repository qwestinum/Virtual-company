/**
 * S20 — Effacement RGPD des données du module Sourcing.
 * Spec : docs/specs/sourcing.md §12 · Procédure : docs/ops/purge-rgpd-candidat.md
 *
 * Sur la base réelle (tables du lot 1), quatre parcours :
 *   1. un profil JAMAIS MANIFESTÉ, désigné par l'adresse de son profil
 *      (`--linkedin-url`) : ses lignes partent sur TOUTES les campagnes, son
 *      approche est pseudonymisée et son lien révoqué, une opposition est
 *      posée ; un HOMONYME (même nom, autre profil) reste intact ;
 *   2. un profil dont l'instantané porte l'ADRESSE du sujet est retrouvé par
 *      l'adresse — sans opposition, que personne n'a demandée ;
 *   3. un candidat MANIFESTÉ, retrouvé par son email : sa candidature
 *      `can_src_…` mène à son approche, à son empreinte, et au profil encore
 *      vivant sur une autre campagne ;
 *   4. une candidature EN COURS DE CRÉATION arrête l'effacement.
 * Le contrôle final rend zéro, et un rejeu rend « déjà effacé ».
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { collectBlockerFacts } from '@/lib/gdpr/blocker-facts';
import { detectBlockers } from '@/lib/gdpr/blockers';
import { executeErasure } from '@/lib/gdpr/execute';
import { erasureMarker } from '@/lib/gdpr/marker';
import { buildFingerprint } from '@/lib/gdpr/payload-pseudonymize';
import { resolveIdentity, type ResolveInput } from '@/lib/gdpr/resolve';
import { verifyErasure } from '@/lib/gdpr/verify';
import { normalizeProfileUrl, profileFingerprint } from '@/lib/sourcing/fingerprint';
import type { ErasureIdentity } from '@/types/gdpr';

import { cleanAll, db, newTestCampaignId } from './helpers/db';

const PEPPER = 'treg-s20-sel';
const MARKER = erasureMarker('S20 — instruction de test');
const campA = newTestCampaignId('s20a');
const campB = newTestCampaignId('s20b');

const fpOf = (url: string) => profileFingerprint(normalizeProfileUrl(url)!, PEPPER);
const hex = () => randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 32);

// Parcours 1 — profil non manifesté, et son homonyme.
const NORA_URL = `https://www.linkedin.com/in/nora-source-${Math.random().toString(36).slice(2, 8)}`;
const NORA_FP = fpOf(NORA_URL);
const HOMONYM_FP = fpOf(`https://www.linkedin.com/in/nora-source-autre-${Math.random().toString(36).slice(2, 8)}`);
// Parcours 2 — profil portant l'adresse du sujet.
const ADDRESS_EMAIL = 'profil-adresse-s20@test.local';
const ADDRESS_FP = fpOf(`https://www.linkedin.com/in/adresse-s20-${Math.random().toString(36).slice(2, 8)}`);
// Parcours 3 — candidat manifesté.
const MANIF_EMAIL = 'manifeste-s20@test.local';
const MANIF_FP = fpOf(`https://www.linkedin.com/in/manifeste-s20-${Math.random().toString(36).slice(2, 8)}`);
const manifApproachId = randomUUID();
const MANIF_CV_PATH = `campagnes/treg-s20/sourcing-cv-${manifApproachId.slice(0, 8)}.pdf`;
const MANIF_FREE_PATH = `campagnes/treg-s20/autre-${manifApproachId.slice(0, 8)}.pdf`;
const manifAnalysisId = `can_src_${manifApproachId}`;
// Parcours 4 — admission en cours.
const PENDING_FP = fpOf(`https://www.linkedin.com/in/attente-s20-${Math.random().toString(36).slice(2, 8)}`);

const ALL_FPS = [NORA_FP, HOMONYM_FP, ADDRESS_FP, MANIF_FP, PENDING_FP];
const RECRUITER = randomUUID();

let noraApproachId = '';
let homonymProfileId = '';

async function cleanOwn(): Promise<void> {
  await db().from('sourcing_exclusions').delete().in('fingerprint', ALL_FPS);
  await db().from('candidate_analyses').delete().eq('id', manifAnalysisId);
  await cleanAll(); // campagnes de test ⇒ recherches, profils, approches en cascade
}

async function insertProfile(
  campaignId: string,
  searchId: string,
  fingerprint: string,
  rank: number,
  snapshot: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await db()
    .from('sourcing_profiles')
    .insert({ campaign_id: campaignId, search_id: searchId, fingerprint, exa_rank: rank, exa_snapshot: snapshot })
    .select('id')
    .single();
  if (error) throw new Error(`seed profil : ${error.message}`);
  return data.id as string;
}

async function insertApproach(row: Record<string, unknown>): Promise<string> {
  const { data, error } = await db()
    .from('sourcing_approaches')
    .insert({ recruiter_id: RECRUITER, channel: 'linkedin', message_format: 'connection_note', token_hash: hex(), ...row })
    .select('id')
    .single();
  if (error) throw new Error(`seed approche : ${error.message}`);
  return data.id as string;
}

beforeAll(async () => {
  await cleanOwn();

  for (const id of [campA, campB]) {
    const { error } = await db()
      .from('campaigns')
      .insert({ id, name: `[TREG] S20 ${id}`, status: 'active', fdp: {} });
    if (error) throw new Error(`seed campagne : ${error.message}`);
  }
  const search = async (campaignId: string) => {
    const { data, error } = await db()
      .from('sourcing_searches')
      .insert({
        campaign_id: campaignId,
        query: 'Consultant AMOA confirmé, basé à Paris',
        query_generated: 'Consultant AMOA confirmé, basé à Paris',
        query_method: 'llm',
        language: 'fr',
        requested: 100,
        returned: 100,
        new_after_dedup: 100,
      })
      .select('id')
      .single();
    if (error) throw new Error(`seed recherche : ${error.message}`);
    return data.id as string;
  };
  const searchA = await search(campA);
  const searchB = await search(campB);

  // 1. Nora, sur DEUX campagnes, approchée sur la première ; et son homonyme.
  const noraSnapshot = { name: 'Nora Source', location: 'Paris', workHistory: [{ title: 'Consultante AMOA' }] };
  const noraProfileA = await insertProfile(campA, searchA, NORA_FP, 1, noraSnapshot);
  await insertProfile(campB, searchB, NORA_FP, 1, noraSnapshot);
  homonymProfileId = await insertProfile(campA, searchA, HOMONYM_FP, 2, { ...noraSnapshot, location: 'Lyon' });
  await db()
    .from('sourcing_profiles')
    .update({ state: 'contacted', decided_at: new Date().toISOString(), decided_by_user_id: RECRUITER })
    .eq('id', noraProfileA);
  noraApproachId = await insertApproach({
    campaign_id: campA,
    profile_id: noraProfileA,
    fingerprint: NORA_FP,
    message: 'Bonjour Nora, votre parcours en AMOA nous intéresse.',
  });

  // 2. Un profil dont l'instantané affiche l'adresse du sujet.
  await insertProfile(campA, searchA, ADDRESS_FP, 3, {
    name: 'Adèle Adresse',
    contacts: { emails: [ADDRESS_EMAIL] },
  });

  // 3. Un candidat manifesté sur la campagne A, dont le profil vit encore en B.
  await insertProfile(campB, searchB, MANIF_FP, 2, { name: 'Marius Manifeste' });
  const now = new Date().toISOString();
  const { error: aErr } = await db()
    .from('candidate_analyses')
    .insert({
      id: manifAnalysisId,
      uid: manifAnalysisId,
      campaign_id: campA,
      candidate_name: 'Marius Manifeste',
      candidate_email: MANIF_EMAIL,
      file_name: 'cv-structure-marius.pdf',
      source: 'sourcing',
      received_at: now,
      total_score: 64,
      status: 'accepted',
      criteria_version: 'treg',
      computed_at: now,
      decision_zone: 'auto_accept',
      decided_by: 'user',
      application: {
        candidate: {
          fullName: 'Marius Manifeste', email: MANIF_EMAIL, phone: null, detectedLanguage: 'fr',
          fileName: 'cv-structure-marius.pdf', source: 'sourcing', receivedAt: now,
          rightToWork: null, location: 'Paris', photoPresent: false,
        },
        scoringResult: {
          totalScore: 64, status: 'accepted', decisionZone: 'auto_accept',
          breakdown: [], hardFailures: [], criteriaVersion: 'treg', computedAt: now,
        },
        narration: { summary: 'Marius Manifeste, AMOA.', strengths: [], weaknesses: [], justification: '' },
      },
    });
  if (aErr) throw new Error(`seed analyse : ${aErr.message}`);
  await insertApproach({
    id: manifApproachId,
    campaign_id: campA,
    fingerprint: MANIF_FP,
    message: 'Bonjour Marius',
    status: 'submitted',
    submitted_at: now,
    analysis_id: manifAnalysisId,
  });
  // Ses CV sourcing (lot 4) : le CV structuré par convention d'identifiant, et
  // un artefact d'identifiant libre qui ne porte l'approche qu'en métadonnée.
  const { error: artErr } = await db().from('artifacts_meta').insert([
    { id: `art_src_cv_${manifApproachId}`, campaign_id: campA, kind: 'cv', name: 'cv-structure.pdf', mime: 'application/pdf', storage_bucket: 'artifacts', storage_path: MANIF_CV_PATH, metadata: { source: 'sourcing', approachId: manifApproachId, structured: true } },
    { id: `art_treg_s20_libre_${manifApproachId.slice(0, 8)}`, campaign_id: campA, kind: 'cv', name: 'autre.pdf', mime: 'application/pdf', storage_bucket: 'artifacts', storage_path: MANIF_FREE_PATH, metadata: { source: 'sourcing', approachId: manifApproachId } },
  ]);
  if (artErr) throw new Error(`seed artefacts : ${artErr.message}`);

  // 4. Une soumission en cours de création.
  await insertApproach({
    campaign_id: campB,
    fingerprint: PENDING_FP,
    message: 'Bonjour Paule',
    status: 'admission_pending',
    submitted_at: now,
    submission: { email: 'paule-s20@test.local' },
  });
});

afterAll(cleanOwn);

// ─── Outils ────────────────────────────────────────────────────────────────

const fingerprint = (id: ErasureIdentity) =>
  buildFingerprint({ emails: id.emails, names: id.names, phones: id.phones });

async function run(input: ResolveInput, oppose: string[], dryRun: boolean) {
  const identity = await resolveIdentity(db(), input);
  const result = await executeErasure({
    db: db(),
    identity,
    fingerprint: fingerprint(identity),
    marker: MARKER,
    storage: [],
    purgeAnalyses: false,
    sourcingOppositionFingerprints: oppose,
    dryRun,
    actor: 's20',
  });
  return { identity, result };
}

async function rows(table: string, col: string, values: string[]) {
  const { data, error } = await db().from(table).select('*').in(col, values);
  if (error) throw new Error(`${table} : ${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
}

// ─── S20.1 ─────────────────────────────────────────────────────────────────

describe('S20.1 — profil non manifesté, désigné par l’adresse de son profil', () => {
  it('la résolution trouve ses deux profils et son approche, pas l’homonyme', async () => {
    const identity = await resolveIdentity(db(), { emails: [], sourcingFingerprints: [NORA_FP] });
    expect(identity.sourcingProfileIds).toHaveLength(2);
    expect(identity.sourcingApproachIds).toEqual([noraApproachId]);
    expect(identity.sourcingProfileIds).not.toContain(homonymProfileId);
    // Le nom lu sur le profil sert au caviardage, jamais au ciblage.
    expect(identity.names).toContain('Nora Source');
    expect(identity.analysisIds).toEqual([]);
  });

  it('le constat compte sans rien écrire', async () => {
    const { result } = await run({ emails: [], sourcingFingerprints: [NORA_FP] }, [NORA_FP], true);
    expect(result.error).toBeNull();
    expect(result.counts.sourcingProfiles).toBe(2);
    expect(result.counts.sourcingApproaches).toBe(1);
    expect(result.counts.sourcingOppositions).toBe(1);
    expect(await rows('sourcing_profiles', 'fingerprint', [NORA_FP])).toHaveLength(2);
    expect(await rows('sourcing_exclusions', 'fingerprint', [NORA_FP])).toHaveLength(0);
  });

  it('l’exécution supprime les profils, pseudonymise l’approche, pose l’opposition', async () => {
    const { result } = await run({ emails: [], sourcingFingerprints: [NORA_FP] }, [NORA_FP], false);
    expect(result.error).toBeNull();
    expect(result.stoppedAt).toBeNull();

    expect(await rows('sourcing_profiles', 'fingerprint', [NORA_FP])).toHaveLength(0);

    const [approach] = await rows('sourcing_approaches', 'id', [noraApproachId]);
    expect(approach).toBeDefined(); // la ligne RESTE
    expect(approach!.message).toBeNull();
    expect(approach!.submission).toBeNull();
    expect(approach!.profile_id).toBeNull();
    expect(approach!.purged_at).not.toBeNull();
    expect(approach!.status).toBe('revoked'); // le lien reçu ne sert plus
    // Ce qui documente QU'une approche a eu lieu survit.
    expect(approach!.recruiter_id).toBe(RECRUITER);
    expect(approach!.initiated_at).not.toBeNull();
    expect(approach!.channel).toBe('linkedin');

    const exclusions = await rows('sourcing_exclusions', 'fingerprint', [NORA_FP]);
    expect(exclusions).toHaveLength(1);
    expect(exclusions[0]!.reason).toBe('opposed');
    expect(exclusions[0]!.campaign_id).toBeNull();
  });

  it('l’homonyme est intact', async () => {
    const [homonym] = await rows('sourcing_profiles', 'id', [homonymProfileId]);
    expect(homonym).toBeDefined();
    expect((homonym!.exa_snapshot as { name: string }).name).toBe('Nora Source');
  });

  it('le contrôle final rend zéro — et il a bien lu quelque chose', async () => {
    const identity = await resolveIdentity(db(), { emails: [], sourcingFingerprints: [NORA_FP] });
    const outcome = await verifyErasure(db(), identity, fingerprint(identity));
    expect(outcome.reidentification).toEqual([]);
    expect(outcome.residues).toEqual([]);
    expect(outcome.status).toBe('clean');
    expect(outcome.auditedRows).toBeGreaterThan(0); // l'approche pseudonymisée
    expect(JSON.stringify(outcome)).not.toContain(homonymProfileId);
  });

  it('le contrôle VOIT un profil qui aurait survécu (il mord, il ne se tait pas)', async () => {
    // Profil semé APRÈS l'effacement, sous la même empreinte : sans nom lisible
    // dans le périmètre, seule la règle « une ligne EFFACER qui survit est un
    // échec » peut le remonter.
    const { data: s } = await db().from('sourcing_searches').select('id').eq('campaign_id', campA).limit(1).single();
    const survivor = await insertProfile(campA, s!.id as string, NORA_FP, 9, { name: 'x' });
    const identity = await resolveIdentity(db(), { emails: [], sourcingFingerprints: [NORA_FP] });
    const outcome = await verifyErasure(db(), identity, fingerprint(identity));
    expect(outcome.status).toBe('residues');
    expect(outcome.reidentification.map((r) => r.location)).toContain(`sourcing_profiles#${survivor}`);
    await db().from('sourcing_profiles').delete().eq('id', survivor);
  });

  it('le rejeu ne réécrit rien et le dit', async () => {
    const { result } = await run({ emails: [], sourcingFingerprints: [NORA_FP] }, [NORA_FP], false);
    expect(result.error).toBeNull();
    expect(result.counts.sourcingProfiles).toBe(0);
    expect(result.counts.sourcingApproaches).toBe(0);
    expect(result.counts.sourcingOppositions).toBe(0);
    expect(result.alreadyErased.sourcingApproaches).toBe(1);
    expect(result.alreadyErased.sourcingOppositions).toBe(1);
  });
});

// ─── S20.2 ─────────────────────────────────────────────────────────────────

describe('S20.2 — un profil qui affiche l’adresse du sujet', () => {
  it('est retrouvé par l’adresse et supprimé, sans opposition', async () => {
    const { identity, result } = await run({ emails: [ADDRESS_EMAIL] }, [], false);
    expect(identity.sourcingFingerprints).toContain(ADDRESS_FP);
    expect(result.error).toBeNull();
    expect(result.counts.sourcingProfiles).toBe(1);
    expect(await rows('sourcing_profiles', 'fingerprint', [ADDRESS_FP])).toHaveLength(0);
    // Personne n'a demandé d'opposition : on n'en déduit pas.
    expect(await rows('sourcing_exclusions', 'fingerprint', [ADDRESS_FP])).toHaveLength(0);
  });
});

// ─── S20.3 ─────────────────────────────────────────────────────────────────

describe('S20.3 — un candidat manifesté, retrouvé par son email', () => {
  it('la candidature mène à l’approche, à l’empreinte, puis au profil vivant ailleurs', async () => {
    const identity = await resolveIdentity(db(), { emails: [MANIF_EMAIL] });
    expect(identity.analysisIds).toContain(manifAnalysisId);
    expect(identity.sourcingApproachIds).toContain(manifApproachId);
    expect(identity.sourcingFingerprints).toContain(MANIF_FP);
    expect(identity.sourcingProfileIds).toHaveLength(1);
    // Ses CV sourcing entrent au périmètre, fichiers compris — par convention d'identifiant
    // ET par l'approche portée en métadonnée.
    expect(identity.artifactIds).toEqual(expect.arrayContaining([`art_src_cv_${manifApproachId}`, `art_treg_s20_libre_${manifApproachId.slice(0, 8)}`]));
    expect(identity.storagePaths).toEqual(expect.arrayContaining([MANIF_CV_PATH, MANIF_FREE_PATH]));
  });

  it('l’exécution pseudonymise l’approche SANS toucher à son statut ni à sa candidature', async () => {
    const { result } = await run({ emails: [MANIF_EMAIL] }, [], false);
    expect(result.error).toBeNull();
    expect(result.counts.analyses).toBe(1);
    expect(result.counts.sourcingApproaches).toBe(1);
    expect(result.counts.sourcingProfiles).toBe(1);

    const [approach] = await rows('sourcing_approaches', 'id', [manifApproachId]);
    expect(approach!.message).toBeNull();
    expect(approach!.purged_at).not.toBeNull();
    expect(approach!.status).toBe('submitted'); // un fait passé, pas un lien à révoquer
    expect(approach!.analysis_id).toBe(manifAnalysisId);
    expect(await rows('sourcing_profiles', 'fingerprint', [MANIF_FP])).toHaveLength(0);
    expect(await rows('sourcing_exclusions', 'fingerprint', [MANIF_FP])).toHaveLength(0);
  });

  it('le contrôle final rend zéro', async () => {
    const identity = await resolveIdentity(db(), {
      emails: [MANIF_EMAIL],
      analysisIds: [manifAnalysisId],
    });
    const outcome = await verifyErasure(db(), identity, fingerprint(identity));
    expect(outcome.reidentification).toEqual([]);
    expect(outcome.residues).toEqual([]);
    expect(outcome.status).toBe('clean');
  });
});

// ─── S20.4 ─────────────────────────────────────────────────────────────────

describe('S20.4 — une candidature en cours de création ARRÊTE l’effacement', () => {
  it('rend un arrêt qui se lève seul, et l’exécution refuse de détruire la saisie', async () => {
    const identity = await resolveIdentity(db(), { emails: [], sourcingFingerprints: [PENDING_FP] });
    const blockers = detectBlockers(await collectBlockerFacts(db(), identity));
    expect(blockers.map((b) => b.kind)).toEqual(['sourcing_admission_pending']);

    // Ceinture : même si l'arrêt était ignoré, l'étape s'arrête plutôt que de vider.
    const result = await executeErasure({
      db: db(),
      identity,
      fingerprint: fingerprint(identity),
      marker: MARKER,
      storage: [],
      purgeAnalyses: false,
      sourcingOppositionFingerprints: [],
      dryRun: false,
      actor: 's20',
    });
    expect(result.stoppedAt).toBe('approches de sourcing');
    const [approach] = await rows('sourcing_approaches', 'fingerprint', [PENDING_FP]);
    expect(approach!.submission).not.toBeNull();
    expect(approach!.status).toBe('admission_pending');
  });
});
