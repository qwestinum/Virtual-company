/**
 * S18 — Effacement RGPD d'un candidat.
 * Procédure : docs/ops/purge-rgpd-candidat.md
 *
 * Parcours complet sur la base réelle :
 *   1. un candidat semé dans TOUS les emplacements de l'inventaire (§4) —
 *      analyse, file de validation, briefing, vivier, réservation native,
 *      file de résilience, métadonnées, journal, et deux formes de fichier
 *      (rapport à un seul candidat, rapport GROUPÉ à plusieurs) ;
 *   2. un ARRÊT : entretien programmé à venir ⇒ rien n'est écrit, le message
 *      est adressé au responsable de traitement ;
 *   3. le CONSTAT trouve tout et ne modifie RIEN ;
 *   4. l'EXÉCUTION efface, pseudonymise, réécrit le rapport groupé ;
 *   5. le CONTRÔLE final rend zéro — absence littérale ET ré-identification
 *      depuis le uid conservé ;
 *   6. le REJEU ne lève pas et rend « déjà effacé » ;
 *   7. NON-DÉBORDEMENT : un homonyme et un candidat au téléphone identique
 *      ne sont pas touchés ;
 *   8. le journal a GARDÉ ses évènements, pseudonymisés ;
 *   9. REJEU SUR PÉRIMÈTRE VIDE : aucune recherche, aucun résidu, et surtout
 *      aucune ligne d'un autre candidat (incident de production du 02/09).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as analyzeCv } from '@/app/api/cv-analyzer/route';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { POST as postValidation } from '@/app/api/validations/route';

import {
  configureScheduling,
  createBookingLink,
  createRecordingMailer,
  createResource,
  createTarget,
  registerEventConsumer,
  resetSchedulingConfig,
  setWeeklyRules,
} from '@/lib/scheduling';

import { collectBlockerFacts } from '@/lib/gdpr/blocker-facts';
import { detectBlockers } from '@/lib/gdpr/blockers';
import { executeErasure } from '@/lib/gdpr/execute';
import { erasureMarker, isErasureMarker } from '@/lib/gdpr/marker';
import { buildFingerprint, isContaminated } from '@/lib/gdpr/payload-pseudonymize';
import { stripCandidateSections } from '@/lib/gdpr/report-rewrite';
import { withUtf8Bom } from '@/lib/storage/utf8';
import { perimeterIsEmpty } from '@/lib/gdpr/perimeter';
import { assertNoLeakedIdentity, renderErasureReport } from '@/lib/gdpr/report';
import { resolveIdentity } from '@/lib/gdpr/resolve';
import { planStorage } from '@/lib/gdpr/storage-plan';
import { verifyErasure } from '@/lib/gdpr/verify';
import { ARTIFACTS_BUCKET } from '@/lib/storage/blob';
import type { CVApplication } from '@/types/cv-analysis';
import { EMPTY_ERASURE_COUNTS, type ErasureIdentity } from '@/types/gdpr';

import { call, cvAnalyzerForm, testCampaignPayload, testScoringSheet, until } from './helpers/api';
import { cleanAll, db, newTestCampaignId, readRows } from './helpers/db';

const camp = newTestCampaignId('s18');
const REQUEST_REF = 'S18 — instruction de test';
const MARKER = erasureMarker(REQUEST_REF);

/** Le sujet de la demande. Identité produite par les fixtures du profil « fort ». */
const SUBJECT_EMAIL = 'fort@test.local';
const SUBJECT_NAME = 'Victor Fort';
/** Numéro PARTAGÉ par les trois profils de fixtures — le piège du test 7. */
const SHARED_PHONE = '0600000001';

const MAILBOX_ID = `mb_treg_s18_${Math.random().toString(36).slice(2, 8)}`;
const UNMATCHED_UID = '918273';

/** Les identifiants d'analyse sont FOURNIS : la route ne les renvoie pas. */
const subjectTaskId = `treg_s18_sujet_${Math.random().toString(36).slice(2, 8)}`;
const neighbourTaskId = `treg_s18_voisin_${Math.random().toString(36).slice(2, 8)}`;
let homonymAnalysisId = '';
let groupedReportContent = '';
let identity: ErasureIdentity;

const sheet = testScoringSheet(camp);
const mailer = createRecordingMailer();

// ─── Nettoyage ─────────────────────────────────────────────────────────────

async function cleanScheduling(): Promise<void> {
  const supabase = db();
  const { data: targets } = await supabase
    .from('sched_targets')
    .select('id')
    .like('external_ref', `${camp}%`);
  const targetIds = (targets ?? []).map((r) => r.id as string);
  if (targetIds.length > 0) {
    const { data: bookings } = await supabase
      .from('sched_bookings')
      .select('id')
      .in('target_id', targetIds);
    const bookingIds = (bookings ?? []).map((r) => r.id as string);
    if (bookingIds.length > 0) {
      await supabase.from('sched_events').delete().in('booking_id', bookingIds);
    }
    await supabase.from('sched_bookings').delete().in('target_id', targetIds);
    await supabase.from('sched_booking_links').delete().in('target_id', targetIds);
    await supabase.from('sched_targets').delete().in('id', targetIds);
  }
  const { data: resources } = await supabase
    .from('sched_resources')
    .select('id')
    .like('external_ref', `${camp}%`);
  const resourceIds = (resources ?? []).map((r) => r.id as string);
  if (resourceIds.length > 0) {
    await supabase.from('sched_availability_rules').delete().in('resource_id', resourceIds);
    await supabase.from('sched_resources').delete().in('id', resourceIds);
  }
}

async function cleanOwn(): Promise<void> {
  const supabase = db();
  await cleanScheduling();
  await supabase.from('imap_unmatched_cvs').delete().eq('mailbox_id', MAILBOX_ID);
  await supabase.from('imap_cv_retries').delete().eq('mailbox_id', MAILBOX_ID);
  await supabase.from('gdpr_erasure_requests').delete().eq('request_ref', REQUEST_REF);
  // Le STOCKAGE aussi : `cleanAll` ne connaît que la base, et c'est justement
  // par là que le bucket s'est rempli de dossiers orphelins (cf. la procédure
  // §4.2). Un test sur l'effacement n'a pas le droit d'y contribuer.
  for (const prefix of [`campagnes/${camp}`, `unmatched/${MAILBOX_ID}/${UNMATCHED_UID}`]) {
    const { data } = await supabase.storage.from(ARTIFACTS_BUCKET).list(prefix, { limit: 100 });
    const paths = (data ?? []).map((f) => `${prefix}/${f.name}`);
    if (paths.length > 0) await supabase.storage.from(ARTIFACTS_BUCKET).remove(paths);
  }
  await cleanAll();
}

// ─── Semis ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await cleanOwn();

  const created = await call(putCampaign, {
    method: 'PUT',
    body: testCampaignPayload({ id: camp, status: 'active' }),
  });
  expect(created.status).toBe(200);

  // 1. L'analyse du SUJET, par la route réelle : elle crée l'analyse, le CV en
  //    stockage, ses métadonnées, les entrées de journal, et alimente le vivier.
  const subject = await call(analyzeCv, {
    form: cvAnalyzerForm({
      profile: 'fort',
      campaignId: camp,
      sheet,
      thresholdLow: 30,
      thresholdHigh: 75,
      taskId: subjectTaskId,
    }),
  });
  expect(subject.status).toBe(200);

  // 2. Un VOISIN : autre personne, autre adresse, MÊME téléphone que le sujet
  //    (les fixtures les partagent). Il ne doit pas être touché.
  const neighbour = await call(analyzeCv, {
    form: cvAnalyzerForm({
      profile: 'moyen',
      campaignId: camp,
      sheet,
      thresholdLow: 30,
      thresholdHigh: 75,
      taskId: neighbourTaskId,
    }),
  });
  expect(neighbour.status).toBe(200);

  // 3. Un HOMONYME PARFAIT : le même nom, une autre adresse. Écrit en direct —
  //    aucun parcours produit d'homonyme, et c'est justement ce cas qu'il faut
  //    pouvoir provoquer.
  homonymAnalysisId = `treg_s18_homonyme_${Math.random().toString(36).slice(2, 8)}`;
  const subjectRow = (
    await readRows<{ id: string; application: CVApplication; received_at: string }>(
      'candidate_analyses',
      { id: subjectTaskId },
    )
  )[0]!;
  // Même analyse, mais les COORDONNÉES sont bien celles de l'homonyme : c'est
  // une autre personne qui porte le même nom et le même numéro, pas une copie
  // du sujet.
  const homonymApplication: CVApplication = {
    ...subjectRow.application,
    candidate: {
      ...subjectRow.application.candidate,
      email: 'homonyme@test.local',
      fileName: 'CV-Victor-Fort-homonyme.pdf',
    },
  };
  await db()
    .from('candidate_analyses')
    .insert({
      id: homonymAnalysisId,
      uid: homonymAnalysisId,
      campaign_id: camp,
      candidate_name: SUBJECT_NAME, // MÊME NOM
      candidate_email: 'homonyme@test.local', // autre adresse
      file_name: 'CV-Victor-Fort-homonyme.pdf',
      source: 'manual',
      received_at: subjectRow.received_at,
      total_score: 55,
      status: 'rejected',
      criteria_version: 'treg',
      computed_at: subjectRow.received_at,
      application: homonymApplication,
      decision_zone: 'gray',
    });

  // 4. File de validation humaine (route réelle).
  const validation = await call(postValidation, {
    body: {
      id: `val_treg_s18_${subjectTaskId}`,
      campaignId: camp,
      candidateName: SUBJECT_NAME,
      candidateEmail: SUBJECT_EMAIL,
      score: 80,
      decision: 'accept',
      payload: { uid: subjectTaskId, candidate: { candidateName: SUBJECT_NAME, email: SUBJECT_EMAIL, phone: SHARED_PHONE } },
    },
  });
  expect(validation.status).toBe(200);

  // 5. Briefing d'entretien — PROGRAMMÉ DANS LE FUTUR : c'est l'arrêt du test 2.
  await db()
    .from('interview_briefs')
    .insert({
      campaign_id: camp,
      uid: subjectTaskId,
      candidate_email: SUBJECT_EMAIL,
      candidate_name: SUBJECT_NAME,
      job_title: 'Testeur Logiciel TREG',
      status: 'scheduled',
      questions: [`Parlez-nous du parcours de ${SUBJECT_NAME}.`],
      candidate_snapshot: { candidateName: SUBJECT_NAME, email: SUBJECT_EMAIL, phone: SHARED_PHONE },
      interview_start_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      interview_end_at: new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString(),
    });

  // 6. Réservation native : ressource, cible (external_ref = la campagne), lien.
  configureScheduling({
    supabase: db(),
    mailer,
    publicBaseUrl: 'https://treg.test.local',
    organizationName: 'Cabinet Test',
  });
  registerEventConsumer(async () => {});
  await createResource({
    externalRef: `${camp}-res`,
    displayName: 'Camille Test',
    timezone: 'Europe/Paris',
    minNoticeMinutes: 0,
    horizonDays: 60,
    notifyEmail: `camille-s18@test.local`,
  });
  await setWeeklyRules(
    `${camp}-res`,
    [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1080 })),
  );
  await createTarget({ externalRef: camp, resourceExternalRef: `${camp}-res` });
  await createBookingLink({
    targetExternalRef: camp,
    idempotencyKey: subjectTaskId,
    context: { uid: subjectTaskId, analysisId: subjectTaskId, campaignId: camp },
    display: { title: 'Entretien', attendeeName: 'Victor', attendeeEmail: SUBJECT_EMAIL },
  });

  // 7. File de résilience + son binaire en stockage.
  await db().storage
    .from(ARTIFACTS_BUCKET)
    .upload(`unmatched/${MAILBOX_ID}/${UNMATCHED_UID}/CV Victor Fort.pdf`, 'binaire factice', {
      contentType: 'application/pdf',
      upsert: true,
    });
  await db()
    .from('imap_unmatched_cvs')
    .insert({
      mailbox_id: MAILBOX_ID,
      uid: UNMATCHED_UID,
      from_addr: `Victor Fort <${SUBJECT_EMAIL}>`,
      subject: `Candidature Testeur — ${SUBJECT_NAME}`,
      file_name: 'CV Victor Fort.pdf',
      mime: 'application/pdf',
      storage_bucket: ARTIFACTS_BUCKET,
      storage_path: `unmatched/${MAILBOX_ID}/${UNMATCHED_UID}/CV Victor Fort.pdf`,
      campaign_id: camp,
      reason: 'none',
    });
  await db()
    .from('imap_cv_retries')
    .insert({
      mailbox_id: MAILBOX_ID,
      uid: UNMATCHED_UID,
      attempts: 2,
      last_error: 'extract_failed sur « CV Victor Fort.pdf »',
    });

  // 8. Un rapport d'analyse GROUPÉ : le sujet ET le voisin dans le même fichier.
  //    C'est le cas où supprimer effacerait les données de quelqu'un d'autre.
  groupedReportContent = [
    '# Analyse de 2 CV — ' + camp,
    '',
    'Reçus : 2 · Retenus : 2',
    '',
    '---',
    '',
    `## ${SUBJECT_NAME} — 80/100 — Retenu`,
    'Email : ' + SUBJECT_EMAIL,
    '',
    '### Évaluation par critère',
    '- ✅ Experience du test logiciel — satisfait · « TREGSKILL depuis 6 ans »',
    '',
    '## Marc Moyen — 60/100 — Retenu',
    'Email : moyen@test.local',
    '',
    '### Évaluation par critère',
    '- ✅ Maitrise de SQL — satisfait · « SQL au quotidien »',
    '',
  ].join('\n');
  const artifact = await call(createArtifact, {
    body: {
      id: `art_treg_s18_${Math.random().toString(36).slice(2, 8)}`,
      campaignId: camp,
      kind: 'cv_report',
      name: `rapport-cv-${camp}-groupe.md`,
      content: groupedReportContent,
    },
  });
  expect(artifact.status).toBe(200);

  // Le vivier est alimenté en différé par la route d'analyse.
  await until(
    async () =>
      (await readRows('vivier_candidates', { email: SUBJECT_EMAIL })).length > 0 || null,
    'dossier vivier du sujet',
  );
});

afterAll(async () => {
  await cleanOwn();
  registerEventConsumer(null);
  resetSchedulingConfig();
});

// ─── Outils ────────────────────────────────────────────────────────────────

function fingerprint(id: ErasureIdentity) {
  return buildFingerprint({ emails: id.emails, names: id.names, phones: id.phones });
}

async function resolve(): Promise<ErasureIdentity> {
  return resolveIdentity(db(), { emails: [SUBJECT_EMAIL] });
}

async function runErasureWith(id: ErasureIdentity, dryRun: boolean) {
  const fp = fingerprint(id);
  const plan = await planStorage(db(), id, fp);
  return {
    id,
    fp,
    plan,
    result: await executeErasure({
      db: db(),
      identity: id,
      fingerprint: fp,
      marker: MARKER,
      storage: plan.targets,
      purgeAnalyses: false,
      dryRun,
      actor: 's18',
    }),
  };
}

/** Le chemin de l'opérateur : on repart de l'adresse, comme la commande. */
async function runErasure(dryRun: boolean) {
  return runErasureWith(await resolve(), dryRun);
}

// ─── S18.1 — Résolution ────────────────────────────────────────────────────

describe('S18.1 — la résolution trouve tout, et rien de plus', () => {
  it('retrouve le sujet dans chaque emplacement', async () => {
    identity = await resolve();
    expect(identity.analysisIds).toContain(subjectTaskId);
    expect(identity.campaignIds).toContain(camp);
    expect(identity.validationIds.length).toBeGreaterThan(0);
    expect(identity.briefIds.length).toBeGreaterThan(0);
    expect(identity.vivierIds.length).toBeGreaterThan(0);
    expect(identity.linkTokens.length).toBeGreaterThan(0);
    expect(identity.unmatchedIds.length).toBeGreaterThan(0);
    expect(identity.artifactIds.length).toBeGreaterThan(0);
    expect(identity.imapRefs).toContainEqual({ mailboxId: MAILBOX_ID, uid: UNMATCHED_UID });
  });

  it('n’attrape NI l’homonyme NI le voisin au téléphone identique', async () => {
    // La garantie centrale : ni le nom ni le téléphone ne font entrer une
    // donnée dans le périmètre. Seule l'adresse le fait.
    expect(identity.analysisIds).not.toContain(homonymAnalysisId);
    expect(identity.analysisIds).not.toContain(neighbourTaskId);
    expect(identity.emails).not.toContain('homonyme@test.local');
    expect(identity.emails).not.toContain('moyen@test.local');
  });
});

// ─── S18.2 — Arrêt ─────────────────────────────────────────────────────────

describe('S18.2 — un entretien programmé ARRÊTE l’effacement', () => {
  it('rend un message adressé au responsable de traitement', async () => {
    const blockers = detectBlockers(await collectBlockerFacts(db(), identity));
    expect(blockers.length).toBeGreaterThan(0);
    const interview = blockers.find((b) => b.kind === 'interview_scheduled');
    expect(interview).toBeDefined();
    expect(interview!.message).toContain('Un entretien est programmé');
    expect(interview!.message).toContain('responsable de traitement');
    expect(interview!.message).not.toContain('interview_briefs');
  });

  it('se lève quand l’entretien est annulé — et l’effacement redevient possible', async () => {
    await db()
      .from('interview_briefs')
      .update({ status: 'cancelled' })
      .in('id', identity.briefIds);
    const blockers = detectBlockers(await collectBlockerFacts(db(), identity));
    expect(blockers).toEqual([]);
  });
});

// ─── S18.3 — Constat ───────────────────────────────────────────────────────

describe('S18.3 — le constat n’écrit RIEN', () => {
  it('compte ce qu’il ferait sans toucher à la base', async () => {
    const before = await snapshot();
    const { result, plan } = await runErasure(true);

    expect(result.stoppedAt).toBeNull();
    expect(result.counts.analyses).toBeGreaterThan(0);
    expect(result.counts.journalEntries).toBeGreaterThan(0);
    expect(plan.targets.some((t) => t.action === 'rewrite')).toBe(true);

    expect(await snapshot()).toEqual(before);
  });
});

async function snapshot(): Promise<string> {
  const analyses = await readRows<{ id: string; candidate_name: string }>(
    'candidate_analyses',
    { campaign_id: camp },
  );
  const validations = await readRows<{ id: string }>('pending_validations', {
    campaign_id: camp,
  });
  const vivier = await readRows<{ id: string }>('vivier_candidates', {
    email: SUBJECT_EMAIL,
  });
  return JSON.stringify({
    analyses: analyses.map((a) => [a.id, a.candidate_name]).sort(),
    validations: validations.length,
    vivier: vivier.length,
  });
}

// ─── S18.4 — Exécution ─────────────────────────────────────────────────────

describe('S18.4 — l’exécution efface et pseudonymise', () => {
  it('passe toutes les étapes sans s’arrêter', async () => {
    const { result } = await runErasure(false);
    expect(result.error).toBeNull();
    expect(result.stoppedAt).toBeNull();
    expect(result.counts.analyses).toBeGreaterThan(0);
    expect(result.counts.vivierDossiers).toBe(1);
    expect(result.counts.unmatchedRows).toBe(1);
    expect(result.counts.storageFilesRewritten).toBe(1);
  });

  it('vide l’analyse sans supprimer la ligne — les bilans ne bougent pas', async () => {
    const [row] = await readRows<{
      candidate_name: string;
      candidate_email: string | null;
      total_score: number;
      decision_zone: string | null;
      application: { candidate: { email: string | null }; narration: { strengths: string[] } };
    }>('candidate_analyses', { id: subjectTaskId });
    expect(row).toBeDefined();
    expect(isErasureMarker(row!.candidate_name)).toBe(true);
    expect(row!.candidate_email).toBeNull();
    expect(row!.application.candidate.email).toBeNull();
    expect(row!.application.narration.strengths).toEqual([]);
    // Ce qui alimente les compteurs SURVIT.
    expect(row!.total_score).toBeGreaterThan(0);
    expect(row!.decision_zone).toBeTruthy();
  });

  it('supprime le dossier de vivier et ses index dérivés', async () => {
    expect(await readRows('vivier_candidates', { email: SUBJECT_EMAIL })).toHaveLength(0);
    const orphans = await db()
      .from('vivier_embeddings')
      .select('candidate_id')
      .in('candidate_id', identity.vivierIds);
    expect(orphans.data ?? []).toHaveLength(0);
  });

  it('vide la file de résilience SANS supprimer la ligne (anti-résurrection)', async () => {
    const [row] = await readRows<{
      from_addr: string;
      subject: string;
      file_name: string;
      storage_path: string | null;
    }>('imap_unmatched_cvs', { mailbox_id: MAILBOX_ID });
    expect(row).toBeDefined(); // la ligne RESTE : elle bloque une réingestion
    expect(row!.from_addr).toBe(MARKER);
    expect(row!.subject).toBe(MARKER);
    expect(row!.file_name).toBe('[effacé-rgpd-1]'); // ordinal, jamais NULL
    expect(row!.storage_path).toBeNull();
  });

  it('réécrit le rapport groupé au lieu de le supprimer', async () => {
    // ⚠️ On vérifie par le CATALOGUE, pas par une relecture : mesuré le
    // 02/09/2026, un téléchargement immédiatement après l'écriture ramène
    // encore l'ancien contenu (cache de diffusion) alors que l'origine porte
    // déjà le nouveau. La taille annoncée par le catalogue, elle, est celle de
    // l'origine — c'est le seul oracle fiable à cet instant.
    const dir = `campagnes/${camp}`;
    const base = `rapport-cv-${camp}-groupe.md`;
    const { data } = await db().storage.from(ARTIFACTS_BUCKET).list(dir, { search: base });
    const entry = (data ?? [])[0];
    expect(entry, 'le rapport groupé ne doit PAS être supprimé').toBeDefined();

    // Taille attendue = celle du rapport dont la section du sujet a été retirée,
    // calculée par la même fonction pure que le code de purge.
    const expected = stripCandidateSections(
      groupedReportContent,
      buildFingerprint({ emails: [SUBJECT_EMAIL], names: [SUBJECT_NAME], phones: [SHARED_PHONE] }),
      MARKER,
    );
    expect(expected.remaining).toBe(1); // Marc Moyen y figure toujours
    expect(expected.content).not.toContain('Victor');
    expect(expected.content).toContain('Marc Moyen — 60/100');
    const size = (entry!.metadata as { size?: number } | null)?.size;
    expect(size).toBe(Buffer.byteLength(withUtf8Bom(expected.content, 'text/markdown'), 'utf8'));
    // Et la taille a bien CHANGÉ : le fichier n'est pas resté celui d'avant.
    expect(size).not.toBe(Buffer.byteLength(withUtf8Bom(groupedReportContent, 'text/markdown'), 'utf8'));
  });

  it('supprime le binaire de la file de résilience', async () => {
    const { data } = await db().storage
      .from(ARTIFACTS_BUCKET)
      .list(`unmatched/${MAILBOX_ID}/${UNMATCHED_UID}`);
    expect(data ?? []).toHaveLength(0);
  });

  it('vide les satellites', async () => {
    expect(await readRows('pending_validations', { campaign_id: camp })).toHaveLength(0);
    expect(
      (await db().from('sched_booking_links').select('token').in('token', identity.linkTokens))
        .data ?? [],
    ).toHaveLength(0);
    expect(
      (await db().from('interview_briefs').select('id').in('id', identity.briefIds)).data ?? [],
    ).toHaveLength(0);
  });
});

// ─── S18.5 — Contrôle final ────────────────────────────────────────────────

describe('S18.5 — le contrôle rend zéro', () => {
  it('aucun résidu, aucun chemin de ré-identification', async () => {
    const fp = fingerprint(identity);
    const outcome = await verifyErasure(db(), identity, fp);
    expect(outcome.residues).toEqual([]);
    expect(outcome.reidentification).toEqual([]);
    expect(outcome.status).toBe('clean');
  });

  it('ne rapporte AUCUNE donnée d’un autre candidat — périmètre plein', async () => {
    // L'incident du 02/09/2026 : le contrôle balayait les tables entières puis
    // auditait chaque ligne. Le verdict `identity_key` étant structurel, tout
    // candidat portant un `candidate_name` devenait un « résidu » — 6525 en
    // production. Ce test tient la règle sur un périmètre PLEIN, parce que le
    // défaut n'avait rien de propre au périmètre vide.
    const outcome = await verifyErasure(db(), identity, fingerprint(identity));
    const blob = JSON.stringify({
      residues: outcome.residues,
      reidentification: outcome.reidentification,
    });
    for (const tiers of ['moyen@test.local', 'Marc Moyen', 'homonyme@test.local']) {
      expect(blob).not.toContain(tiers);
    }
    // Et il a bien LU quelque chose : un contrôle vert parce qu'il ne regarde
    // rien serait le pire des deux mondes.
    expect(outcome.auditedRows).toBeGreaterThan(0);
  });

  it('le voisin et l’homonyme sont SIGNALÉS, jamais effacés', async () => {
    // Ils portent le nom (homonyme) ou le téléphone (voisin) du sujet : le
    // contrôle les remonte pour qu'un humain juge — c'est exactement ce que
    // l'outil doit faire plutôt que de trancher seul.
    const outcome = await verifyErasure(db(), identity, fingerprint(identity));
    const locations = outcome.homonymWarnings.map((w) => w.location).join(' ');
    expect(locations).toContain(homonymAnalysisId);
    // Le signal désigne une ligne de TIERS : il donne l'emplacement, jamais la
    // valeur qu'on y a lue. Rien à recopier, donc rien à fuiter.
    for (const w of outcome.homonymWarnings) {
      expect(Object.keys(w).sort()).toEqual(['field', 'location', 'trigger']);
    }

    const [homonym] = await readRows<{ candidate_name: string; candidate_email: string }>(
      'candidate_analyses',
      { id: homonymAnalysisId },
    );
    expect(homonym!.candidate_name).toBe(SUBJECT_NAME); // INTACT
    expect(homonym!.candidate_email).toBe('homonyme@test.local');

    const [neighbour] = await readRows<{ candidate_name: string; candidate_email: string }>(
      'candidate_analyses',
      { id: neighbourTaskId },
    );
    expect(neighbour!.candidate_name).toBe('Marc Moyen'); // INTACT
    expect(neighbour!.candidate_email).toBe('moyen@test.local');
  });
});

// ─── S18.6 — Journal ───────────────────────────────────────────────────────

describe('S18.6 — le journal garde ses évènements', () => {
  it('les entrées existent toujours, pseudonymisées', async () => {
    const entries = await readRows<{
      action: string;
      payload: Record<string, unknown>;
    }>('journal', { campaign_id: camp });
    expect(entries.length).toBeGreaterThan(0);

    const fp = fingerprint(identity);
    for (const e of entries) {
      const blob = JSON.stringify(e.payload);
      // Ni l'adresse, ni le nom du sujet ne subsistent dans SES lignes.
      expect(isContaminated(blob, { ...fp, nameTokens: [], slugs: [], phoneTails: [] })).toBe(
        false,
      );
    }
    // L'ÉVÈNEMENT, lui, est là : l'analyse du sujet a bien laissé sa trace.
    expect(entries.some((e) => e.action === 'imap_cv_analyzed')).toBe(true);
  });
});

// ─── S18.7 — Rejeu ─────────────────────────────────────────────────────────

describe('S18.7 — le rejeu est sans risque', () => {
  it('reprise d’une exécution interrompue : rien à refaire, tout est « déjà effacé »', async () => {
    // Cas réel : la commande s'est arrêtée en cours de route, on la relance
    // avec les mêmes identifiants. Chaque étape doit reconnaître son propre
    // marqueur et ne rien réécrire.
    const { result } = await runErasureWith(identity, false);
    expect(result.error).toBeNull();
    expect(result.stoppedAt).toBeNull();
    expect(result.counts.analyses).toBe(0);
    expect(result.counts.unmatchedRows).toBe(0);
    expect(result.alreadyErased.analyses).toBeGreaterThan(0);
    expect(result.alreadyErased.unmatchedRows).toBe(1);
    expect(result.alreadyErased.vivierDossiers).toBeGreaterThan(0);
  });

  it('relance par l’ADRESSE : plus rien n’est rattachable, et c’est le résultat attendu', async () => {
    // L'adresse a disparu des analyses : une seconde demande ne retrouve rien.
    // Ce n'est pas un échec — c'est la preuve que l'effacement a porté. Le
    // registre `gdpr_erasure_requests` est ce qui garde la mémoire de l'acte.
    const again = await resolve();
    expect(again.analysisIds).toHaveLength(0);
    expect(again.vivierIds).toHaveLength(0);

    const { result } = await runErasureWith(again, false);
    expect(result.error).toBeNull();
    expect(result.stoppedAt).toBeNull();
    expect(Object.values(result.counts).every((n) => n === 0)).toBe(true);
  });

  it('le contrôle reste vert après le rejeu', async () => {
    const outcome = await verifyErasure(db(), identity, fingerprint(identity));
    expect(outcome.residues).toEqual([]);
    expect(outcome.reidentification).toEqual([]);
  });
});

// ─── S18.8 — Rejeu sur un périmètre VIDE ───────────────────────────────────

describe('S18.8 — un périmètre vide ne déclenche AUCUNE recherche', () => {
  it('le contrôle ne s’exécute pas, et le dit', async () => {
    // Le rejeu de la purge Bisseg en production : tout était déjà effacé, donc
    // plus rien ne se rattachait à la personne. Le contrôle a cherché SANS
    // TERME et a rendu la base entière — 6525 « résidus nominatifs » qui
    // étaient les autres candidats.
    const empty = await resolve();
    expect(perimeterIsEmpty(empty)).toBe(true);

    const outcome = await verifyErasure(db(), empty, fingerprint(empty));
    expect(outcome.status).toBe('not_run');
    expect(outcome.auditedRows).toBe(0);
    expect(outcome.residues).toEqual([]);
    expect(outcome.reidentification).toEqual([]);
    expect(outcome.homonymWarnings).toEqual([]);
  });

  it('la base contient pourtant d’AUTRES candidats — ils ne sont pas remontés', async () => {
    // La garde ne vaut que si le piège est réellement tendu : l'homonyme et le
    // voisin sont toujours là, intacts, avec leur nom en clair.
    const [homonym] = await readRows<{ candidate_name: string }>('candidate_analyses', {
      id: homonymAnalysisId,
    });
    expect(homonym!.candidate_name).toBe(SUBJECT_NAME);

    const empty = await resolve();
    const outcome = await verifyErasure(db(), empty, fingerprint(empty));
    expect(JSON.stringify(outcome)).not.toContain(homonymAnalysisId);
    expect(JSON.stringify(outcome)).not.toContain(neighbourTaskId);
  });

  it('le rapport reste propre, et ne prétend pas avoir contrôlé', async () => {
    const empty = await resolve();
    const outcome = await verifyErasure(db(), empty, fingerprint(empty));
    const report = renderErasureReport({
      requestRef: REQUEST_REF,
      receivedAt: null,
      executedAt: new Date().toISOString(),
      environmentLabel: 'environnement de test',
      counts: { ...EMPTY_ERASURE_COUNTS },
      alreadyErased: { ...EMPTY_ERASURE_COUNTS },
      storage: [],
      purgedAnalyses: false,
      backupRetentionDays: null,
      dryRun: false,
      verification: outcome.status,
    });

    // Aucune ligne d'un autre candidat, et la garde dure le confirme.
    for (const tiers of ['Marc Moyen', 'moyen@test.local', 'homonyme@test.local', SUBJECT_EMAIL]) {
      expect(report).not.toContain(tiers);
    }
    expect(() =>
      assertNoLeakedIdentity(report, [
        SUBJECT_EMAIL,
        SUBJECT_NAME,
        'Marc Moyen',
        'moyen@test.local',
      ]),
    ).not.toThrow();

    // Et il dit la vérité : il n'y avait rien à contrôler.
    expect(report).toContain('sans objet');
  });
});
