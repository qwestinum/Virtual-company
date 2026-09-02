/**
 * Contrôle final de l'effacement.
 * Procédure : docs/ops/purge-rgpd-candidat.md §7.4.
 *
 * ─── DEUX CONTRÔLES, ET LE SECOND EST LE VRAI ────────────────────────────
 * 1. ABSENCE LITTÉRALE — le nom, l'adresse et le téléphone ne doivent plus
 *    figurer nulle part DANS LE PÉRIMÈTRE. Nécessaire, mais faible : il
 *    vérifie qu'on a bien effacé des chaînes de caractères.
 *
 * 2. RÉ-IDENTIFICATION — on part des identifiants TECHNIQUES qu'on a
 *    délibérément conservés (`uid`, identifiant d'analyse) et on tente de
 *    remonter à une personne par CHAQUE chemin interne. Aucun ne doit
 *    aboutir. C'est la question que pose réellement l'article 17 : non pas
 *    « la chaîne a-t-elle disparu ? » mais « peut-on encore reconstituer
 *    quelqu'un ? »
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ─── LE CONTRÔLE NE LIT QUE LE PÉRIMÈTRE (incident du 02/09/2026) ─────────
 * Il a listé la base entière — 6525 « résidus » nommant tous les autres
 * candidats — parce qu'il balayait les tables SANS FILTRE avant d'auditer.
 * Le verdict `identity_key` étant structurel, toute ligne portant un
 * `candidate_name` devenait un résidu.
 *
 * Trois règles en découlent, et elles sont l'ossature de ce fichier :
 *   · **jamais de recherche sans terme** — périmètre vide ⇒ le contrôle NE
 *     S'EXÉCUTE PAS (`status: 'not_run'`), aucune requête n'est émise ;
 *   · **on ne rapatrie que par un identifiant du sujet** — identifiants
 *     résolus, ou motifs dérivés de l'ADRESSE seule ;
 *   · **on n'audite que ce qui appartient au sujet** — la requête borne le
 *     fetch, `carriesStrongIdentifier` rend le verdict. Une ligne hors
 *     périmètre n'est pas auditée : rien d'elle ne peut donc être retenu,
 *     nommé, ni recopié où que ce soit.
 *
 * La branche « homonyme probable » est SÉPARÉE (`probeHomonyms`) et ne rend
 * que des EMPLACEMENTS, jamais un extrait : elle désigne des lignes de TIERS.
 * Elle sert à ce qu'un humain juge, elle ne va jamais dans le livrable.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { containsErasureMarker } from '@/lib/gdpr/marker';
import { auditPayload } from '@/lib/gdpr/payload-audit';
import {
  strongIdentifiersOnly,
  type SubjectFingerprint,
} from '@/lib/gdpr/payload-pseudonymize';
import {
  carriesStrongIdentifier,
  perimeterIsEmpty,
  strongSearchPatterns,
  weakSearchPatterns,
} from '@/lib/gdpr/perimeter';
import { journalRowsInScope } from '@/lib/gdpr/journal-scope';
import { escapeLike, listStorageRecursive, pageAllByText, type Filter } from '@/lib/gdpr/scan';
import { ARTIFACTS_BUCKET } from '@/lib/storage/blob';
import type {
  ErasureIdentity,
  HomonymWarning,
  ReidentificationFinding,
  VerifyOutcome,
} from '@/types/gdpr';

/** Au-delà, on ne liste plus : on DIT que la liste est tronquée (§7.4). */
const HOMONYM_CAP = 200;

/**
 * Tables balayées pour l'absence littérale. Liste TENUE À JOUR avec
 * l'inventaire de la procédure (§4.1) : une table absente d'ici serait un
 * angle mort du contrôle, donc un effacement déclaré complet sans l'être.
 */
type SweepTarget = {
  table: string;
  cursor: string;
  columns: string;
  /** Colonnes de la ligne qui composent son emplacement lisible. */
  keyCols?: string[];
  /**
   * Colonnes TEXTE interrogeables en `ilike`. JAMAIS une colonne `jsonb` :
   * PostgREST ne sait pas y chercher une sous-chaîne, et une requête qui
   * échoue silencieusement rendrait un contrôle vert sans avoir rien lu.
   */
  searchable: string[];
  /** Valeurs du curseur appartenant au périmètre. */
  ids?: (i: ErasureIdentity) => string[];
  /** Couples de filtres, pour les tables sans identifiant propre. */
  pairs?: (i: ErasureIdentity) => Filter[][];
  /** Appartenance PAR IDENTIFIANT — la première des deux portes d'entrée. */
  matches: (row: Record<string, unknown>, i: ErasureIdentity) => boolean;
  /**
   * Table dont le contenu sensible vit en `jsonb` : aucun motif `LIKE` ne
   * peut l'atteindre. On rapatrie tout et on filtre en JS — le même compromis
   * que pour le journal (§7.3), et il reste sûr : c'est le filtre JS qui
   * décide, jamais la requête.
   */
  deepScan?: boolean;
};

const byId =
  (col: string, pick: (i: ErasureIdentity) => string[]) =>
  (row: Record<string, unknown>, id: ErasureIdentity): boolean =>
    pick(id).includes(String(row[col] ?? ''));

const SWEEP: SweepTarget[] = [
  {
    table: 'candidate_analyses',
    cursor: 'id',
    columns: 'id, candidate_name, candidate_email, file_name, application',
    searchable: ['candidate_email', 'file_name'],
    ids: (i) => i.analysisIds,
    matches: byId('id', (i) => i.analysisIds),
  },
  {
    table: 'pending_validations',
    cursor: 'id',
    columns: 'id, candidate_name, candidate_email, payload',
    searchable: ['candidate_email'],
    ids: (i) => i.validationIds,
    matches: byId('id', (i) => i.validationIds),
  },
  {
    table: 'interview_briefs',
    cursor: 'id',
    columns: 'id, candidate_name, candidate_email, candidate_snapshot, questions',
    searchable: ['candidate_email'],
    ids: (i) => i.briefIds,
    matches: byId('id', (i) => i.briefIds),
  },
  {
    table: 'vivier_candidates',
    cursor: 'id',
    columns:
      'id, email, nom, prenom, telephone, cv_file_name, cv_text, title, title_variants, title_anchors, skills, tags',
    searchable: ['email', 'cv_file_name'],
    ids: (i) => i.vivierIds,
    matches: byId('id', (i) => i.vivierIds),
  },
  {
    table: 'imap_unmatched_cvs',
    cursor: 'id',
    columns: 'id, from_addr, subject, file_name, storage_path',
    searchable: ['from_addr', 'subject', 'file_name', 'storage_path'],
    ids: (i) => i.unmatchedIds,
    matches: byId('id', (i) => i.unmatchedIds),
  },
  {
    table: 'imap_cv_retries',
    cursor: 'uid',
    columns: 'mailbox_id, uid, last_error',
    keyCols: ['mailbox_id', 'uid'],
    searchable: ['last_error'],
    // Pas d'identifiant propre : le rattachement se fait par le couple
    // (boîte, message), le seul repère que cette table conserve.
    pairs: (i) =>
      i.imapRefs.map((r) => [
        { op: 'eq', col: 'mailbox_id', value: r.mailboxId },
        { op: 'eq', col: 'uid', value: r.uid },
      ]),
    matches: (row, id) =>
      id.imapRefs.some(
        (r) => r.mailboxId === String(row.mailbox_id ?? '') && r.uid === String(row.uid ?? ''),
      ),
  },
  {
    table: 'artifacts_meta',
    cursor: 'id',
    columns: 'id, name, metadata, storage_path',
    searchable: ['name', 'storage_path'],
    ids: (i) => i.artifactIds,
    matches: byId('id', (i) => i.artifactIds),
  },
  {
    table: 'sched_booking_links',
    cursor: 'token',
    columns: 'token, context, display',
    searchable: [],
    ids: (i) => i.linkTokens,
    matches: byId('token', (i) => i.linkTokens),
  },
  {
    table: 'sched_bookings',
    cursor: 'id',
    columns: 'id, attendee_name, attendee_email, attendee_phone, context',
    searchable: ['attendee_email'],
    ids: (i) => i.bookingIds,
    matches: byId('id', (i) => i.bookingIds),
  },
  {
    // `sched_events` part en cascade avec sa réservation, et tout son contenu
    // vit dans une charge utile `jsonb` : aucun identifiant, aucune colonne
    // texte. Une ligne orpheline qui porterait encore l'adresse ne serait
    // atteignable d'aucune autre façon.
    table: 'sched_events',
    cursor: 'id',
    columns: 'id, payload',
    searchable: [],
    matches: () => false,
    deepScan: true,
  },
];

export async function verifyErasure(
  db: SupabaseClient,
  identity: ErasureIdentity,
  fp: SubjectFingerprint,
): Promise<VerifyOutcome> {
  // ── Périmètre vide : le contrôle n'a PAS D'OBJET ────────────────────────
  // Rien n'a été retrouvé pour cette personne ici. Sans identifiant, le
  // contrôle n'a plus rien pour la distinguer des autres — et une recherche
  // sans terme rend la base entière. On ne cherche pas « au cas où » : on
  // dit qu'il n'y avait rien à contrôler, ce qui est la vérité.
  if (perimeterIsEmpty(identity)) {
    return {
      status: 'not_run',
      auditedRows: 0,
      residues: [],
      homonymWarnings: [],
      homonymsTruncated: false,
      reidentification: [],
    };
  }

  const strong = strongIdentifiersOnly(fp);
  const residues: VerifyOutcome['residues'] = [];
  let auditedRows = 0;

  for (const target of SWEEP) {
    for (const row of await fetchCandidateRows(db, target, identity, fp)) {
      // ⚠️ LE VERDICT D'APPARTENANCE, jamais la requête. Un `ilike` sert à ne
      // pas tout rapatrier ; il ne prouve pas qu'une ligne est celle du sujet.
      if (!target.matches(row, identity) && !carriesStrongIdentifier(row, strong)) continue;
      auditedRows += 1;
      const location = `${target.table}#${locationKey(row, target)}`;
      for (const f of auditPayload(row, fp)) {
        // Toute trouvaille sur une ligne DU PÉRIMÈTRE est un résidu : le nom
        // et le téléphone y sont des données du sujet, pas des homonymes.
        residues.push({ location, field: f.path, trigger: f.trigger, sample: f.sample });
      }
    }
  }

  // Le journal a son propre lecteur de périmètre (§7.3) : une ligne y entre
  // par un identifiant de rattachement ou par l'adresse, jamais par un nom.
  for (const row of await journalRowsInScope(db, identity, fp)) {
    auditedRows += 1;
    for (const f of auditPayload(row.payload ?? {}, fp)) {
      residues.push({
        location: `journal#${row.id} (${row.action})`,
        field: `payload.${f.path}`,
        trigger: f.trigger,
        sample: f.sample,
      });
    }
  }

  const reidentification = await probeReidentification(db, identity, fp);
  const homonyms = await probeHomonyms(db, identity, fp, strong);

  return {
    status: residues.length > 0 || reidentification.length > 0 ? 'residues' : 'clean',
    auditedRows,
    residues,
    homonymWarnings: homonyms.warnings,
    homonymsTruncated: homonyms.truncated,
    reidentification,
  };
}

/**
 * Les lignes qu'il est LÉGITIME de regarder : celles du périmètre, plus
 * celles qu'un motif dérivé de l'ADRESSE ramène.
 *
 * Pourquoi la seconde source, alors que la résolution a déjà listé les
 * identifiants ? Parce qu'un contrôle qui ne regarde QUE là où l'effacement a
 * regardé ne peut jamais trouver ce que l'effacement a manqué. Il ne serait
 * plus un contrôle, seulement l'écho de la même requête.
 */
async function fetchCandidateRows(
  db: SupabaseClient,
  target: SweepTarget,
  identity: ErasureIdentity,
  fp: SubjectFingerprint,
): Promise<Record<string, unknown>[]> {
  const seen = new Map<string, Record<string, unknown>>();
  const keep = (rows: Record<string, unknown>[]) => {
    for (const row of rows) seen.set(locationKey(row, target), row);
  };

  if (target.deepScan) {
    keep(await pageAllByText<Record<string, unknown>>(db, target.table, target.columns, target.cursor));
    return [...seen.values()];
  }

  const ids = target.ids?.(identity) ?? [];
  if (ids.length > 0) {
    keep(
      await pageAllByText<Record<string, unknown>>(db, target.table, target.columns, target.cursor, [
        { op: 'in', col: target.cursor, values: ids },
      ]),
    );
  }

  for (const pair of target.pairs?.(identity) ?? []) {
    keep(
      await pageAllByText<Record<string, unknown>>(
        db,
        target.table,
        target.columns,
        target.cursor,
        pair,
      ),
    );
  }

  for (const pattern of strongSearchPatterns(identity, fp, escapeLike)) {
    for (const col of target.searchable) {
      keep(
        await pageAllByText<Record<string, unknown>>(
          db,
          target.table,
          target.columns,
          target.cursor,
          [{ op: 'ilike', col, value: pattern }],
        ),
      );
    }
  }

  return [...seen.values()];
}

/**
 * Occurrences du NOM du sujet HORS de son périmètre — des homonymes probables.
 *
 * ⚠️ Ces lignes appartiennent à des TIERS. Elles ne sont ni effacées, ni
 * auditées, et on n'en recopie AUCUNE valeur : seulement l'emplacement, pour
 * qu'un humain aille voir. Un nom désigne des milliers de personnes ; c'est
 * précisément pourquoi il ne fait pas entrer une ligne dans un périmètre
 * d'effacement (§7.3), et pourquoi ce signal ne quitte jamais la console de
 * l'opérateur — le rapport n'en porte que le NOMBRE.
 */
export async function probeHomonyms(
  db: SupabaseClient,
  identity: ErasureIdentity,
  fp: SubjectFingerprint,
  strong: SubjectFingerprint,
): Promise<{ warnings: HomonymWarning[]; truncated: boolean }> {
  const patterns = weakSearchPatterns(fp, escapeLike);
  if (patterns.length === 0) return { warnings: [], truncated: false };

  const targets: { table: string; cursor: string; cols: string[] }[] = [
    { table: 'candidate_analyses', cursor: 'id', cols: ['candidate_name'] },
    { table: 'pending_validations', cursor: 'id', cols: ['candidate_name'] },
    { table: 'interview_briefs', cursor: 'id', cols: ['candidate_name'] },
    { table: 'vivier_candidates', cursor: 'id', cols: ['nom', 'prenom'] },
  ];

  const warnings: HomonymWarning[] = [];
  const seen = new Set<string>();
  let truncated = false;

  for (const t of targets) {
    for (const col of t.cols) {
      for (const pattern of patterns) {
        const rows = await pageAllByText<Record<string, unknown>>(
          db,
          t.table,
          `${t.cursor}, ${col}`,
          t.cursor,
          [{ op: 'ilike', col, value: pattern }],
          HOMONYM_CAP + 1,
        );
        if (rows.length > HOMONYM_CAP) truncated = true;
        for (const row of rows.slice(0, HOMONYM_CAP)) {
          const key = `${t.table}#${String(row[t.cursor] ?? '?')}`;
          // Une ligne DU périmètre n'est pas un homonyme : c'est le sujet,
          // et ses résidus éventuels sont déjà remontés comme tels.
          if (idsOf(identity, t.table).includes(String(row[t.cursor] ?? ''))) continue;
          if (carriesStrongIdentifier(row, strong)) continue;
          // Une valeur déjà caviardée n'apprend rien à personne.
          if (containsErasureMarker(String(row[col] ?? ''))) continue;
          if (seen.has(`${key}·${col}`)) continue;
          seen.add(`${key}·${col}`);
          warnings.push({
            location: key,
            field: col,
            trigger: `porte le nom du sujet (${pattern.replace(/%/gu, '')})`,
          });
        }
      }
    }
  }

  return { warnings, truncated };
}

function idsOf(identity: ErasureIdentity, table: string): string[] {
  switch (table) {
    case 'candidate_analyses':
      return identity.analysisIds;
    case 'pending_validations':
      return identity.validationIds;
    case 'interview_briefs':
      return identity.briefIds;
    case 'vivier_candidates':
      return identity.vivierIds;
    default:
      return [];
  }
}

/**
 * Tente de remonter du `uid` conservé à une personne. Chaque chemin qui aboutit
 * est un ÉCHEC : l'identifiant technique n'a le droit de rester que s'il ne
 * mène plus nulle part à l'intérieur d'ORQA (§5.3).
 *
 * Toutes les recherches partent d'un identifiant DU PÉRIMÈTRE — une liste vide
 * ne rend rien (`byIn` court-circuite). Aucune ne peut donc atteindre un tiers.
 */
export async function probeReidentification(
  db: SupabaseClient,
  identity: ErasureIdentity,
  fp: SubjectFingerprint,
): Promise<ReidentificationFinding[]> {
  const found: ReidentificationFinding[] = [];
  const note = (path: string, location: string, evidence: string) =>
    found.push({ path, location, evidence });

  // uid → analyse
  for (const rows of await byIn(db, 'candidate_analyses', 'id, candidate_name, candidate_email', 'id', identity.analysisIds)) {
    const name = str(rows.candidate_name);
    const mail = str(rows.candidate_email);
    if ((name && !containsErasureMarker(name)) || mail) {
      note('identifiant d’analyse → analyse', `candidate_analyses#${str(rows.id)}`, name || mail || '');
    }
  }

  // uid → file de validation
  for (const row of await byIn(db, 'pending_validations', 'id, candidate_name, payload', 'id', identity.validationIds)) {
    note('uid → file de validation', `pending_validations#${str(row.id)}`, str(row.candidate_name));
  }

  // uid → briefing d'entretien
  for (const row of await byIn(db, 'interview_briefs', 'id, candidate_name', 'id', identity.briefIds)) {
    note('uid → briefing d’entretien', `interview_briefs#${str(row.id)}`, str(row.candidate_name));
  }

  // uid → métadonnées d'artefact
  for (const row of await byIn(db, 'artifacts_meta', 'id, name, metadata', 'id', identity.artifactIds)) {
    note('uid → métadonnées d’artefact', `artifacts_meta#${str(row.id)}`, str(row.name));
  }

  // identifiant d'analyse → lien de réservation
  for (const row of await byIn(db, 'sched_booking_links', 'token, display', 'token', identity.linkTokens)) {
    note('identifiant d’analyse → lien de réservation', `sched_booking_links#${str(row.token)}`, JSON.stringify(row.display ?? {}));
  }

  // (boîte, message) → file de résilience
  for (const ref of identity.imapRefs) {
    const rows = await pageAllByText<Record<string, unknown>>(
      db,
      'imap_unmatched_cvs',
      'id, from_addr, file_name, storage_path',
      'id',
      [
        { op: 'eq', col: 'mailbox_id', value: ref.mailboxId },
        { op: 'eq', col: 'uid', value: ref.uid },
      ],
    );
    for (const row of rows) {
      for (const f of auditPayload(row, fp)) {
        note(
          '(boîte, message) → file de résilience',
          `imap_unmatched_cvs#${str(row.id)} · ${f.path}`,
          `${f.trigger} — ${f.sample}`,
        );
      }
    }
    // (boîte, message) → fichiers restés dans le stockage
    const listed = await listStorageRecursive(
      db,
      ARTIFACTS_BUCKET,
      `unmatched/${ref.mailboxId}/${ref.uid}`,
      200,
    );
    for (const path of listed.paths) {
      note('(boîte, message) → stockage', path, path.slice(path.lastIndexOf('/') + 1));
    }
  }

  // uid → journal (les lignes du périmètre doivent être propres)
  const journal = await journalRowsInScope(db, identity, fp);
  for (const row of journal) {
    for (const f of auditPayload(row.payload ?? {}, fp)) {
      note(
        'uid → journal',
        `journal#${row.id} (${row.action}) · ${f.path}`,
        `${f.trigger} — ${f.sample}`,
      );
    }
  }

  return found;
}

// ─── Outils ────────────────────────────────────────────────────────────────

function locationKey(row: Record<string, unknown>, target: SweepTarget): string {
  const cols = target.keyCols ?? [target.cursor];
  return cols.map((c) => String(row[c] ?? '?')).join(':');
}

async function byIn(
  db: SupabaseClient,
  table: string,
  columns: string,
  cursor: string,
  ids: string[],
): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];
  return pageAllByText<Record<string, unknown>>(db, table, columns, cursor, [
    { op: 'in', col: cursor, values: ids },
  ]);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export { escapeLike };
