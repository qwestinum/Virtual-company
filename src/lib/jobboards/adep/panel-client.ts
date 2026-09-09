/**
 * Accès HTTP du panneau APEC. Client-safe.
 *
 * Séparé du composant pour la même raison que `job-post-client` : le panneau
 * garde sa logique d'affichage, et ces fonctions restent lisibles seules.
 */

import type { AdepFieldNote, AdepDraftOffer } from './mapping';
import type { AdepPrefill } from './prefill';
import type { JobPosting } from '@/lib/db/repos/job-postings';
import type { AdepConfig } from '@/types/adep-settings';
import type { AdepOffer } from '@/types/adep';
import type { AdepIssue } from './validate';
import type { PublishOutcome, TransitionOutcome } from '../types';
import type { AdepPositionStatusResult } from '@/types/adep';

export type AdepState = {
  /** Aucune publication réelle : le transport est le mock de recette. */
  simulated: boolean;
  clientReference: string;
  draft: AdepDraftOffer;
  notes: Partial<Record<keyof AdepOffer, AdepFieldNote>>;
  /** Préalables que le formulaire ne peut pas régler. */
  blockers: string[];
  /** Texte repris d'une annonce déjà rédigée. `null` = rien à reprendre. */
  prefill: AdepPrefill | null;
  /** Écarts du texte repris, dits à l'ouverture. N'empêchent pas d'éditer. */
  prefillIssues: AdepIssue[];
  config: AdepConfig;
  owner: { id: string; displayName: string; hasAdepNumeroDossier: boolean } | null;
  posting: JobPosting | null;
  history: JobPosting[];
};

async function readError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as
    | { message?: string; error?: string }
    | null;
  return data?.message ?? data?.error ?? `HTTP ${res.status}`;
}

export async function loadAdepState(campaignId: string): Promise<AdepState | null> {
  const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/adep`, {
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return (await res.json()) as AdepState;
}

export type PublishResponse = {
  outcome: PublishOutcome<AdepPositionStatusResult>;
  posting: JobPosting | null;
  simulated: boolean;
  warnings?: Array<{ field: string; message: string }>;
};

/**
 * Publie l'offre TELLE QU'ELLE EST À L'ÉCRAN.
 *
 * ⚠️ La référence client et l'identifiant de transaction ne sont pas envoyés :
 * le serveur les pose. Les laisser au client permettrait de rejouer une
 * référence déjà utilisée, c'est-à-dire de contourner le verrou d'idempotence.
 */
export async function publishToApec(
  campaignId: string,
  offer: Omit<AdepOffer, 'clientPositionId' | 'trackingId'>,
): Promise<PublishResponse> {
  const res = await fetch(
    `/api/campaigns/${encodeURIComponent(campaignId)}/adep/publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(offer),
    },
  );
  const data = (await res.json().catch(() => null)) as PublishResponse | null;
  if (!data?.outcome) throw new Error(await readError(res));
  return data;
}

export type TransitionResponse = {
  outcome?: TransitionOutcome<AdepPositionStatusResult>;
  posting: JobPosting | null;
  simulated: boolean;
  changed?: boolean;
};

export async function transitionApec(
  campaignId: string,
  action: 'suspend' | 'republish' | 'refresh',
): Promise<TransitionResponse> {
  const res = await fetch(
    `/api/campaigns/${encodeURIComponent(campaignId)}/adep/transition`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    },
  );
  const data = (await res.json().catch(() => null)) as
    | (TransitionResponse & { error?: string; message?: string })
    | null;
  // ⚠️ `res.ok` compte AUTANT que le corps. La route rend 409 (refusé par
  // l'Apec) ou 503 (injoignable) avec un JSON parfaitement lisible : se
  // contenter de « le corps a été parsé » avalait ces deux cas, et le bouton
  // paraissait ne rien faire.
  if (!res.ok || !data) {
    throw new Error(
      data?.message ?? data?.error ?? (await readError(res)),
    );
  }
  return data;
}

/**
 * Demande une pré-rédaction du texte de l'offre. N'écrit rien : le résultat
 * remplit le formulaire, le recruteur relit, et seul « Publier » envoie.
 */
export async function draftApecText(campaignId: string): Promise<AdepPrefill | null> {
  const res = await fetch(
    `/api/campaigns/${encodeURIComponent(campaignId)}/adep/draft-text`,
    { method: 'POST' },
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { prefill: AdepPrefill | null };
  return data.prefill ?? null;
}
