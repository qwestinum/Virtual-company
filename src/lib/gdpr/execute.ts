/**
 * Exécution ORDONNÉE de l'effacement.
 * Procédure : docs/ops/purge-rgpd-candidat.md §7.6.
 *
 * L'ordre va des DÉPENDANCES vers les RACINES, pour ne jamais laisser
 * d'orphelin : réservations et liens, entretiens, file de validation, vivier,
 * fichiers, métadonnées, analyses, JOURNAL EN DERNIER.
 *
 * Le journal ferme la marche parce qu'il est la seule pièce qui documente les
 * étapes précédentes : s'il partait en premier, un échec au milieu laisserait
 * un effacement partiel dont plus rien ne dirait ce qui avait été fait.
 *
 * ─── EN CAS D'ÉCHEC ──────────────────────────────────────────────────────
 * On S'ARRÊTE, et on dit OÙ. Pas de reprise automatique, pas de « au mieux » :
 * un effacement à moitié fait qui se tait est indistinguable d'un effacement
 * réussi. Les étapes déjà passées ne sont pas défaites — elles sont
 * idempotentes, la reprise consiste à relancer la même commande.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { ARTIFACTS_BUCKET } from '@/lib/storage/blob';
import { UTF8_BOM, withUtf8Bom } from '@/lib/storage/utf8';
import { stripApplication, isApplicationStripped } from '@/lib/gdpr/application-skeleton';
import { fileNameMarker, isErasureMarker } from '@/lib/gdpr/marker';
import {
  pseudonymizePayload,
  redactString,
  type SubjectFingerprint,
} from '@/lib/gdpr/payload-pseudonymize';
import { journalRowsInScope, type JournalRow } from '@/lib/gdpr/journal-scope';
import { stripCandidateSections } from '@/lib/gdpr/report-rewrite';
import { isMissingTable, pageAllByText } from '@/lib/gdpr/scan';
import type { CVApplication } from '@/types/cv-analysis';
import {
  EMPTY_ERASURE_COUNTS,
  type ErasureCounts,
  type ErasureIdentity,
  type StorageTarget,
} from '@/types/gdpr';

export type ExecuteInput = {
  db: SupabaseClient;
  identity: ErasureIdentity;
  fingerprint: SubjectFingerprint;
  marker: string;
  storage: StorageTarget[];
  /** Supprimer les lignes d'analyse au lieu de les vider (§6.1). */
  purgeAnalyses: boolean;
  /** Aucune écriture : on compte ce qu'on ferait. */
  dryRun: boolean;
  actor: string;
};

export type ExecuteResult = {
  counts: ErasureCounts;
  /** Déjà purgé par une exécution antérieure — le rejeu le dit au lieu de mentir. */
  alreadyErased: ErasureCounts;
  /** Nom de l'étape où l'on s'est arrêté. `null` = tout est passé. */
  stoppedAt: string | null;
  error: string | null;
};

type Ctx = ExecuteInput & { counts: ErasureCounts; already: ErasureCounts };

type Step = { name: string; run: (ctx: Ctx) => Promise<void> };

const STEPS: Step[] = [
  { name: 'réservations', run: stepBookings },
  { name: 'liens de réservation', run: stepBookingLinks },
  { name: 'briefings d’entretien', run: stepInterviewBriefs },
  { name: 'file de validation', run: stepValidations },
  { name: 'dossiers de vivier', run: stepVivier },
  { name: 'fichiers du stockage', run: stepStorage },
  { name: 'métadonnées d’artefacts', run: stepArtifactMeta },
  { name: 'file de résilience', run: stepUnmatched },
  { name: 'réessais d’analyse', run: stepRetries },
  { name: 'analyses de candidature', run: stepAnalyses },
  { name: 'journal', run: stepJournal },
];

export async function executeErasure(input: ExecuteInput): Promise<ExecuteResult> {
  const ctx: Ctx = {
    ...input,
    counts: { ...EMPTY_ERASURE_COUNTS },
    already: { ...EMPTY_ERASURE_COUNTS },
  };

  for (const step of STEPS) {
    try {
      await step.run(ctx);
    } catch (err) {
      return {
        counts: ctx.counts,
        alreadyErased: ctx.already,
        stoppedAt: step.name,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return { counts: ctx.counts, alreadyErased: ctx.already, stoppedAt: null, error: null };
}

// ─── Étapes ────────────────────────────────────────────────────────────────

async function stepBookings(ctx: Ctx): Promise<void> {
  // `sched_events` part en cascade (FK `on delete cascade`) : la charge utile
  // d'événement porte le participant, elle ne doit pas survivre au rendez-vous.
  ctx.counts.bookings = await deleteByIds(ctx, 'sched_bookings', 'id', ctx.identity.bookingIds);
}

async function stepBookingLinks(ctx: Ctx): Promise<void> {
  ctx.counts.bookingLinks = await deleteByIds(
    ctx,
    'sched_booking_links',
    'token',
    ctx.identity.linkTokens,
  );
}

async function stepInterviewBriefs(ctx: Ctx): Promise<void> {
  ctx.counts.interviewBriefs = await deleteByIds(
    ctx,
    'interview_briefs',
    'id',
    ctx.identity.briefIds,
  );
}

async function stepValidations(ctx: Ctx): Promise<void> {
  ctx.counts.validations = await deleteByIds(
    ctx,
    'pending_validations',
    'id',
    ctx.identity.validationIds,
  );
}

/**
 * Vivier : le fichier D'ABORD, la ligne ensuite — même ordre que la suppression
 * unitaire existante (`deleteVivierCandidate`, spec vivier §8.2). Si la ligne
 * partait la première et que le fichier échouait, plus rien ne dirait où il est.
 * Les embeddings, entités, compétences, ancres et présélections partent en
 * cascade : un vecteur dérivé d'un CV se supprime, il ne se nettoie pas.
 */
async function stepVivier(ctx: Ctx): Promise<void> {
  if (ctx.identity.vivierIds.length === 0) return;
  const rows = await pageAllByText<{ id: string; cv_path: string | null }>(
    ctx.db,
    'vivier_candidates',
    'id, cv_path',
    'id',
    [{ op: 'in', col: 'id', values: ctx.identity.vivierIds }],
  );
  if (rows.length === 0) {
    ctx.already.vivierDossiers = ctx.identity.vivierIds.length;
    return;
  }
  if (!ctx.dryRun) {
    const paths = rows.map((r) => r.cv_path).filter((p): p is string => !!p);
    if (paths.length > 0) {
      const { error } = await ctx.db.storage.from(ARTIFACTS_BUCKET).remove(paths);
      if (error) throw new Error(`stockage vivier : ${error.message}`);
    }
    const { error } = await ctx.db
      .from('vivier_candidates')
      .delete()
      .in('id', rows.map((r) => r.id));
    if (error) throw new Error(`vivier_candidates : ${error.message}`);
  }
  ctx.counts.vivierDossiers = rows.length;
}

async function stepStorage(ctx: Ctx): Promise<void> {
  const toDelete = ctx.storage.filter((t) => t.action === 'delete').map((t) => t.path);
  const toRewrite = ctx.storage.filter((t) => t.action === 'rewrite');

  if (!ctx.dryRun) {
    for (const batch of chunk(toDelete, 100)) await removeObjects(ctx, batch);
  }
  ctx.counts.storageFilesDeleted = toDelete.length;

  for (const target of toRewrite) {
    if (ctx.dryRun) continue;
    const { data, error } = await ctx.db.storage.from(ARTIFACTS_BUCKET).download(target.path);
    if (error || !data) continue; // déjà parti : rien à réécrire
    const rewritten = stripCandidateSections(
      stripBom(await data.text()),
      ctx.fingerprint,
      ctx.marker,
    );

    if (rewritten.remaining === 0) {
      // Plus aucun autre candidat : le rapport n'a plus d'objet.
      await removeObjects(ctx, [target.path]);
      ctx.counts.storageFilesDeleted += 1;
      continue;
    }

    // SUPPRIMER PUIS DÉPOSER, et poser `cache-control: 0` sur la nouvelle
    // version. Un simple écrasement laisse la diffusion servir l'ancienne
    // pendant la durée de cache du fichier d'origine (une heure par défaut) —
    // c'est-à-dire continuer à livrer le nom d'une personne effacée.
    await removeObjects(ctx, [target.path]);
    const body = withUtf8Bom(rewritten.content, 'text/markdown');
    const { error: upErr } = await ctx.db.storage
      .from(ARTIFACTS_BUCKET)
      .upload(target.path, body, {
        contentType: 'text/markdown',
        cacheControl: '0',
        upsert: true,
      });
    if (upErr) {
      // Le fichier a été retiré et n'a pas pu être reposé : les AUTRES
      // candidats qu'il documentait ont perdu leur rapport. C'est grave, et ça
      // ne doit surtout pas passer pour un succès.
      throw new Error(
        `stockage (réécriture de ${target.path}) : ${upErr.message} — le fichier a été ` +
          `retiré et n'a pas pu être reposé.`,
      );
    }

    // ⚠️ ON VÉRIFIE PAR LE CATALOGUE, PAS PAR UNE RELECTURE.
    // Mesuré le 02/09/2026 : un `download` immédiatement après l'écriture
    // ramène l'ANCIEN contenu (371 caractères) alors que le catalogue annonce
    // déjà la nouvelle taille (232 octets) — la lecture passe par un cache que
    // l'écriture ne purge pas tout de suite. Prendre cette relecture pour
    // vérité conduirait à conclure « la réécriture a échoué » et à SUPPRIMER
    // un rapport parfaitement réécrit, avec l'analyse des autres candidats
    // dedans. Le catalogue, lui, reflète l'origine immédiatement.
    const written = await objectSize(ctx, target.path);
    const expected = Buffer.byteLength(body, 'utf8');
    if (written !== expected) {
      throw new Error(
        `stockage (réécriture de ${target.path}) : taille écrite ${written ?? 'absente'} ≠ ` +
          `${expected} attendue — la réécriture n'a pas abouti.`,
      );
    }
    ctx.counts.storageFilesRewritten += 1;
  }
}

/** Suppression d'objets — idempotente (un objet absent ne lève pas). */
async function removeObjects(ctx: Ctx, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await ctx.db.storage.from(ARTIFACTS_BUCKET).remove(paths);
  if (error) throw new Error(`stockage : ${error.message}`);
}

/** Taille d'un objet telle que le CATALOGUE la connaît (source : l'origine). */
async function objectSize(ctx: Ctx, path: string): Promise<number | null> {
  const cut = path.lastIndexOf('/');
  const { data } = await ctx.db.storage
    .from(ARTIFACTS_BUCKET)
    .list(path.slice(0, cut), { search: path.slice(cut + 1), limit: 1 });
  const entry = (data ?? [])[0];
  const size = (entry?.metadata as { size?: number } | null | undefined)?.size;
  return typeof size === 'number' ? size : null;
}

async function stepArtifactMeta(ctx: Ctx): Promise<void> {
  ctx.counts.artifactRows = await deleteByIds(
    ctx,
    'artifacts_meta',
    'id',
    ctx.identity.artifactIds,
  );
}

/**
 * File de résilience : les lignes RESTENT, vidées. Leur clé d'unicité
 * (boîte, message, nom de fichier) est le garde-fou anti-résurrection —
 * supprimer les lignes autoriserait un re-relevé à recréer la candidature.
 *
 * ⚠️ `file_name` participe à cette clé : un `NULL` la casserait (deux NULL
 * sont DISTINCTS dans un index unique). D'où un marqueur ORDINAL, qui est une
 * valeur, stable d'un rejeu à l'autre, et sans entropie exploitable.
 */
async function stepUnmatched(ctx: Ctx): Promise<void> {
  if (ctx.identity.unmatchedIds.length === 0) return;
  const rows = await pageAllByText<{
    id: string;
    mailbox_id: string;
    uid: string;
    from_addr: string | null;
    subject: string | null;
    file_name: string;
  }>(ctx.db, 'imap_unmatched_cvs', 'id, mailbox_id, uid, from_addr, subject, file_name', 'id', [
    { op: 'in', col: 'id', values: ctx.identity.unmatchedIds },
  ]);

  // L'ordinal est calculé sur le groupe (boîte, message), trié par id : deux
  // exécutions successives produisent le même nom pour la même ligne.
  const groups = new Map<string, typeof rows>();
  for (const r of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = `${r.mailbox_id}|${r.uid}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  for (const list of groups.values()) {
    let ordinal = 0;
    for (const row of list) {
      ordinal += 1;
      if (isErasureMarker(row.file_name)) {
        ctx.already.unmatchedRows += 1;
        continue;
      }
      if (!ctx.dryRun) {
        const { error } = await ctx.db
          .from('imap_unmatched_cvs')
          .update({
            from_addr: ctx.marker,
            subject: ctx.marker,
            file_name: fileNameMarker(ordinal),
            // Le chemin porte le nom du fichier d'origine : il part avec lui.
            storage_path: null,
            storage_bucket: null,
          })
          .eq('id', row.id);
        if (error) throw new Error(`imap_unmatched_cvs : ${error.message}`);
      }
      ctx.counts.unmatchedRows += 1;
    }
  }
}

/** Le compteur de réessais reste (il borne les tentatives) ; son message part. */
async function stepRetries(ctx: Ctx): Promise<void> {
  for (const ref of ctx.identity.imapRefs) {
    const rows = await pageAllByText<{ mailbox_id: string; uid: string; last_error: string | null }>(
      ctx.db,
      'imap_cv_retries',
      'mailbox_id, uid, last_error',
      'uid',
      [
        { op: 'eq', col: 'mailbox_id', value: ref.mailboxId },
        { op: 'eq', col: 'uid', value: ref.uid },
      ],
    );
    for (const row of rows) {
      if (!row.last_error) continue;
      const cleaned = redactString(row.last_error, ctx.fingerprint, ctx.marker);
      if (cleaned === row.last_error) continue;
      if (!ctx.dryRun) {
        const { error } = await ctx.db
          .from('imap_cv_retries')
          .update({ last_error: cleaned })
          .eq('mailbox_id', row.mailbox_id)
          .eq('uid', row.uid);
        if (error) throw new Error(`imap_cv_retries : ${error.message}`);
      }
      ctx.counts.retryRows += 1;
    }
  }
}

/**
 * Analyses : VIDÉES par défaut, supprimées sur demande (§6.1). Vider préserve
 * les compteurs des bilans DÉJÀ TRANSMIS — supprimer les ferait bouger
 * rétroactivement, ce qui réécrirait l'histoire d'un rapport signé.
 */
async function stepAnalyses(ctx: Ctx): Promise<void> {
  if (ctx.identity.analysisIds.length === 0) return;

  if (ctx.purgeAnalyses) {
    ctx.counts.analyses = await deleteByIds(
      ctx,
      'candidate_analyses',
      'id',
      ctx.identity.analysisIds,
    );
    return;
  }

  const rows = await pageAllByText<{
    id: string;
    candidate_name: string;
    application: CVApplication | null;
  }>(ctx.db, 'candidate_analyses', 'id, candidate_name, application', 'id', [
    { op: 'in', col: 'id', values: ctx.identity.analysisIds },
  ]);

  for (const row of rows) {
    const alreadyDone =
      isErasureMarker(row.candidate_name) &&
      (row.application === null || isApplicationStripped(row.application));
    if (alreadyDone) {
      ctx.already.analyses += 1;
      continue;
    }
    if (!ctx.dryRun) {
      const { error } = await ctx.db
        .from('candidate_analyses')
        .update({
          candidate_name: ctx.marker,
          // Colonne d'adresse : on n'y met pas un texte qui n'en est pas une.
          candidate_email: null,
          file_name: ctx.marker,
          application: row.application
            ? stripApplication(row.application, ctx.marker)
            : row.application,
          // Le dossier de vivier vient d'être supprimé : le pointeur ne mène
          // plus nulle part, et il rattachait la ligne à une personne.
          vivier_candidate_id: null,
        })
        .eq('id', row.id);
      if (error) throw new Error(`candidate_analyses : ${error.message}`);
    }
    ctx.counts.analyses += 1;
  }
}

/**
 * Journal : l'événement reste, l'identité part. Le périmètre est décidé par
 * `journalRowsInScope` — un nom seul n'y fait jamais entrer une ligne.
 */
async function stepJournal(ctx: Ctx): Promise<void> {
  const rows = await journalRowsInScope(ctx.db, ctx.identity, ctx.fingerprint);
  for (const row of rows) {
    const { value, changed } = pseudonymizePayload(
      row.payload ?? {},
      ctx.fingerprint,
      ctx.marker,
    );
    if (!changed) {
      ctx.already.journalEntries += 1;
      continue;
    }
    if (!ctx.dryRun) {
      const { error } = await ctx.db.from('journal').update({ payload: value }).eq('id', row.id);
      if (error) throw new Error(`journal : ${error.message}`);
    }
    ctx.counts.journalEntries += 1;
  }
}

export type { JournalRow };

// ─── Outils ────────────────────────────────────────────────────────────────

async function deleteByIds(
  ctx: Ctx,
  table: string,
  col: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  let removed = 0;
  for (const batch of chunk(ids, 200)) {
    // On compte ce qui existe AVANT de supprimer : le compteur du rapport doit
    // dire ce qui a réellement disparu, pas ce qu'on a demandé.
    const { data, error: readErr } = await ctx.db
      .from(table)
      .select(col)
      .in(col, batch);
    if (readErr) {
      if (isMissingTable(readErr)) return removed;
      throw new Error(`${table} : ${readErr.message}`);
    }
    const present = (data ?? []).length;
    if (present === 0) continue;
    if (!ctx.dryRun) {
      const { error } = await ctx.db.from(table).delete().in(col, batch);
      if (error) throw new Error(`${table} : ${error.message}`);
    }
    removed += present;
  }
  return removed;
}

/** Le contenu stocké porte une marque d'ordre d'octets (cf. `storage/utf8`). */
function stripBom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
