/**
 * Plan d'action sur le STOCKAGE.
 * Procédure : docs/ops/purge-rgpd-candidat.md §4.2.
 *
 * ─── POURQUOI ON BALAIE LES DOSSIERS, ET PAS LES MÉTADONNÉES ──────────────
 * `artifacts_meta.campaign_id` est en `on delete cascade` : supprimer une
 * campagne efface ses lignes de métadonnées et LAISSE les fichiers en place.
 * Mesuré le 02/09/2026 sur l'environnement de développement : plus de mille
 * dossiers de campagne dans le stockage pour douze campagnes en base, et une
 * campagne effacée qui conservait vingt-et-un fichiers — CV, rapports
 * d'analyse, messages nominatifs — sans une seule ligne de métadonnée.
 *
 * Un effacement qui suivrait les seules métadonnées raterait tout cela EN
 * SILENCE, et se déclarerait complet. On parcourt donc les dossiers, et on
 * OUVRE les fichiers texte : le nom d'un rapport de lot ne dit pas qui est
 * dedans.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { ARTIFACTS_BUCKET } from '@/lib/storage/blob';
import {
  isContaminated,
  strongIdentifiersOnly,
  type SubjectFingerprint,
} from '@/lib/gdpr/payload-pseudonymize';
import { listStorageRecursive } from '@/lib/gdpr/scan';
import { stripCandidateSections } from '@/lib/gdpr/report-rewrite';
import type { ErasureIdentity, StorageTarget } from '@/types/gdpr';

/** Extensions dont on sait lire le contenu (et donc juger sur pièces). */
const TEXT_EXT = /\.(md|txt|json|csv)$/iu;

/** Plafond de téléchargements d'inspection — un balayage ne doit pas figer. */
const MAX_INSPECTIONS = 400;

export type StoragePlan = {
  targets: StorageTarget[];
  /** Un parcours borné ou une inspection plafonnée : DIT, jamais silencieux. */
  truncated: boolean;
  /** Fichiers texte non inspectés faute de budget. */
  notInspected: string[];
};

export async function planStorage(
  db: SupabaseClient,
  identity: ErasureIdentity,
  fp: SubjectFingerprint,
  opts: { deepScan?: boolean } = {},
): Promise<StoragePlan> {
  const candidates = new Set<string>(identity.storagePaths);
  let truncated = false;

  const prefixes: string[] = [];
  for (const id of identity.campaignIds) {
    prefixes.push(`campagnes/${id}`, `tasks/${id}`);
  }
  for (const v of identity.vivierIds) prefixes.push(`vivier/${v}`);
  for (const r of identity.imapRefs) prefixes.push(`unmatched/${r.mailboxId}/${r.uid}`);
  if (opts.deepScan) prefixes.push('campagnes', 'tasks', 'unmatched', 'vivier');

  for (const prefix of uniq(prefixes)) {
    const listed = await listStorageRecursive(db, ARTIFACTS_BUCKET, prefix);
    if (listed.truncated) truncated = true;
    for (const p of listed.paths) candidates.add(p);
  }

  const targets: StorageTarget[] = [];
  const notInspected: string[] = [];
  let inspections = 0;

  for (const path of [...candidates].sort()) {
    const known = identity.storagePaths.includes(path);
    const base = path.slice(path.lastIndexOf('/') + 1);

    if (known) {
      targets.push({ path, action: 'delete', why: 'fichier référencé par le dossier du candidat' });
      continue;
    }
    if (inOwnedPrefix(path, identity)) {
      targets.push({ path, action: 'delete', why: 'fichier d’un dossier propre au candidat' });
      continue;
    }
    if (identity.fileNames.includes(base)) {
      targets.push({ path, action: 'delete', why: 'nom de fichier de CV du candidat' });
      continue;
    }

    if (!TEXT_EXT.test(base)) {
      // Binaire non rattaché : on ne peut pas l'ouvrir. Le nom seul ne suffit
      // pas à condamner (homonyme) — on signale.
      targets.push(
        isContaminated(base, fp)
          ? { path, action: 'review', why: 'nom de fichier évoquant le candidat, contenu illisible' }
          : { path, action: 'keep', why: 'aucun rattachement' },
      );
      continue;
    }

    if (inspections >= MAX_INSPECTIONS) {
      notInspected.push(path);
      truncated = true;
      continue;
    }
    inspections += 1;

    const text = await downloadText(db, path);
    if (text === null) {
      targets.push({ path, action: 'keep', why: 'fichier illisible ou déjà absent' });
      continue;
    }
    if (!isContaminated(text, fp)) {
      targets.push({ path, action: 'keep', why: 'contenu sans mention du candidat' });
      continue;
    }

    // Contenu rattaché. Reste à savoir s'il ne concerne QUE lui.
    const strong = mentionsStrongIdentifier(text, fp);
    const rewrite = stripCandidateSections(text, fp, 'x');
    if (rewrite.remaining > 0) {
      targets.push({
        path,
        action: 'rewrite',
        why: `rapport groupé — ${rewrite.remaining} autre(s) candidat(s) y figurent`,
      });
      continue;
    }
    targets.push(
      strong
        ? { path, action: 'delete', why: 'contenu nominatif du candidat' }
        : { path, action: 'review', why: 'nom du candidat sans adresse — homonyme possible' },
    );
  }

  return { targets, truncated, notInspected };
}

/**
 * Le texte porte-t-il un identifiant qui ne désigne QU'UNE personne ? Seule
 * l'adresse en est un (cf. `strongIdentifiersOnly`) : un nom comme un numéro
 * de téléphone peuvent appartenir à quelqu'un d'autre, et supprimer sur cette
 * base effacerait son dossier.
 */
function mentionsStrongIdentifier(text: string, fp: SubjectFingerprint): boolean {
  return isContaminated(text, strongIdentifiersOnly(fp));
}

function inOwnedPrefix(path: string, identity: ErasureIdentity): boolean {
  for (const v of identity.vivierIds) if (path.startsWith(`vivier/${v}/`)) return true;
  for (const r of identity.imapRefs) {
    if (path.startsWith(`unmatched/${r.mailboxId}/${r.uid}/`)) return true;
  }
  return false;
}

async function downloadText(db: SupabaseClient, path: string): Promise<string | null> {
  try {
    const { data, error } = await db.storage.from(ARTIFACTS_BUCKET).download(path);
    if (error || !data) return null;
    const raw = await data.text();
    // Les contenus texte sont écrits avec une marque d'ordre d'octets (cf.
    // `lib/storage/utf8.ts`) : elle fausserait une comparaison en tête de ligne.
    return raw.replace(/^\uFEFF/u, '');
  } catch {
    return null;
  }
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}
