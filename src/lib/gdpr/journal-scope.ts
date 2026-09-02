/**
 * Périmètre des lignes de JOURNAL rattachées à un candidat.
 * Procédure : docs/ops/purge-rgpd-candidat.md §7.3.
 *
 * ─── LA RÈGLE, ET ELLE EST LA PLUS IMPORTANTE DU MODULE ──────────────────
 * Une ligne entre dans le périmètre par un IDENTIFIANT (uid, identifiant
 * d'analyse, dossier de vivier, briefing, réservation) ou par l'ADRESSE
 * présente dans sa charge utile.
 *
 * **Un NOM ne fait jamais entrer une ligne**, et un TÉLÉPHONE non plus.
 * « Martin » désigne des milliers de personnes ; un fixe de foyer ou un
 * standard d'entreprise en désigne plusieurs (les fixtures de régression le
 * montrent : trois candidats y partagent un numéro). Caviarder sur ces
 * signaux détruirait le dossier de quelqu'un qui n'a rien demandé — un
 * dommage irréversible infligé à un tiers.
 *
 * Les deux restent utiles, mais seulement À L'INTÉRIEUR d'une ligne déjà
 * retenue : une fois qu'on sait, par son uid, qu'une ligne concerne ce
 * dossier, on peut y caviarder nom et téléphone sans risque. Les occurrences
 * hors périmètre sont remontées par le contrôle final comme homonymes
 * probables, et laissées intactes (§7.4).
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le balayage est EXHAUSTIF : on ne peut pas filtrer en SQL sur « la charge
 * utile contient cette adresse » sans y perdre les formes imbriquées, et une
 * ligne oubliée serait une identité qui survit à un effacement déclaré
 * complet. On pagine donc tout le journal par keyset numérique.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  strongIdentifiersOnly,
  type SubjectFingerprint,
} from '@/lib/gdpr/payload-pseudonymize';
import { carriesStrongIdentifier } from '@/lib/gdpr/perimeter';
import { pageAllByNumber } from '@/lib/gdpr/scan';
import type { ErasureIdentity } from '@/types/gdpr';

export type JournalRow = {
  id: number;
  action: string;
  campaign_id: string | null;
  payload: Record<string, unknown> | null;
};

/** Clés de la charge utile qui portent un identifiant de rattachement. */
const LINK_KEYS: { key: string; from: (i: ErasureIdentity) => string[] }[] = [
  { key: 'uid', from: (i) => i.uids },
  { key: 'analysisId', from: (i) => i.analysisIds },
  { key: 'candidateId', from: (i) => i.vivierIds },
  { key: 'vivierId', from: (i) => i.vivierIds },
  { key: 'briefId', from: (i) => i.briefIds },
  { key: 'validationId', from: (i) => i.validationIds },
  { key: 'bookingId', from: (i) => i.bookingIds },
  { key: 'artifactId', from: (i) => i.artifactIds },
];

export async function journalRowsInScope(
  db: SupabaseClient,
  identity: ErasureIdentity,
  fp: SubjectFingerprint,
): Promise<JournalRow[]> {
  const all = await pageAllByNumber<JournalRow>(
    db,
    'journal',
    'id, action, campaign_id, payload',
    'id',
  );
  return all.filter((row) => isInScope(row, identity, fp));
}

/**
 * PURE — testable sans base. `strongIdentifiersOnly` retire noms ET téléphone
 * de l'empreinte : c'est ce qui garantit qu'aucune ligne n'entre par un
 * homonyme, ni par un numéro partagé.
 */
export function isInScope(
  row: JournalRow,
  identity: ErasureIdentity,
  fp: SubjectFingerprint,
): boolean {
  const payload = row.payload ?? {};

  for (const { key, from } of LINK_KEYS) {
    const value = payload[key];
    if (typeof value === 'string' && from(identity).includes(value)) return true;
    if (Array.isArray(value)) {
      const pool = from(identity);
      if (value.some((v) => typeof v === 'string' && pool.includes(v))) return true;
    }
  }

  // Le MÊME détecteur que le contrôle (`perimeter.ts`) : deux implémentations
  // de « cette ligne porte-t-elle l'adresse ? » finiraient par diverger, et
  // une ligne caviardée par l'une mais ignorée par l'autre serait invisible.
  return carriesStrongIdentifier(payload, strongIdentifiersOnly(fp));
}
