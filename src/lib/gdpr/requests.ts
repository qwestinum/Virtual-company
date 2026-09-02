/**
 * Registre des demandes d'effacement — la preuve d'exécution.
 * Procédure : docs/ops/purge-rgpd-candidat.md §5.1.
 *
 * ORQA est sous-traitant : il doit pouvoir démontrer qu'une demande RÉFÉRENCÉE
 * a été exécutée (article 5.2), sans conserver l'identité de la personne
 * effacée. D'où l'empreinte SALÉE de l'adresse plutôt que l'adresse.
 *
 * ⚠️ LE SEL EST OBLIGATOIRE, et son absence est bloquante en exécution. Une
 * empreinte d'adresse électronique NON salée se retrouve par dictionnaire en
 * quelques minutes : ce ne serait pas une pseudonymisation, seulement un
 * encodage. Mieux vaut refuser d'écrire la trace que d'écrire une trace qui
 * réidentifie.
 */

import { createHmac } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { isMissingTable } from '@/lib/gdpr/scan';
import type { ErasureCounts, ErasureStatus } from '@/types/gdpr';

const TABLE = 'gdpr_erasure_requests';

export class MissingPepperError extends Error {
  constructor() {
    super(
      'GDPR_SUBJECT_PEPPER absent : sans sel, l’empreinte de l’adresse serait ' +
        'réversible par dictionnaire. Posez la variable avant d’exécuter.',
    );
    this.name = 'MissingPepperError';
  }
}

/** Empreinte du sujet. L'adresse est normalisée AVANT, jamais stockée. */
export function subjectHash(email: string, pepper: string | undefined): string {
  if (!pepper || pepper.trim().length === 0) throw new MissingPepperError();
  return createHmac('sha256', pepper).update(email.trim().toLowerCase()).digest('hex');
}

export type RecordRequestInput = {
  requestRef: string;
  subjectHash: string;
  environment: string;
  status: ErasureStatus;
  receivedAt: string | null;
  instructedBy: string | null;
  executedBy: string;
  reason: string | null;
  counts: ErasureCounts;
  alreadyErased: ErasureCounts;
};

/**
 * Enregistre (ou met à jour) la trace. La clé naturelle est
 * (référence, sujet, environnement) : une demande peut être exécutée en deux
 * temps et sur plusieurs environnements sans empiler des lignes qui
 * raconteraient chacune une moitié de l'histoire.
 *
 * Renvoie `false` si la table n'existe pas encore ici — l'effacement lui-même
 * a eu lieu, et c'est le fait important ; le rapport le signale.
 */
export async function recordErasureRequest(
  db: SupabaseClient,
  input: RecordRequestInput,
): Promise<boolean> {
  const { error } = await db.from(TABLE).upsert(
    {
      request_ref: input.requestRef,
      subject_hash: input.subjectHash,
      environment: input.environment,
      status: input.status,
      received_at: input.receivedAt,
      instructed_by: input.instructedBy,
      executed_at: input.status === 'dry_run' ? null : new Date().toISOString(),
      executed_by: input.executedBy,
      reason: input.reason,
      // COMPTEURS uniquement — jamais un extrait, jamais un nom.
      scope: { erased: input.counts, alreadyErased: input.alreadyErased },
    },
    { onConflict: 'request_ref,subject_hash,environment' },
  );
  if (!error) return true;
  if (isMissingTable(error)) return false;
  throw new Error(`gdpr_erasure_requests : ${error.message}`);
}

/**
 * Cette personne a-t-elle déjà fait l'objet d'une exécution ici ? Sert à
 * l'affichage du constat (« déjà purgée le … ») — l'idempotence réelle, elle,
 * vient des marqueurs, pas de cette table.
 */
export async function previousExecutions(
  db: SupabaseClient,
  hash: string,
): Promise<{ requestRef: string; executedAt: string | null; environment: string }[]> {
  const { data, error } = await db
    .from(TABLE)
    .select('request_ref, executed_at, environment')
    .eq('subject_hash', hash)
    .not('executed_at', 'is', null)
    .order('executed_at', { ascending: false })
    .limit(20);
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(`gdpr_erasure_requests : ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    requestRef: String(r.request_ref),
    executedAt: r.executed_at ? String(r.executed_at) : null,
    environment: String(r.environment),
  }));
}
