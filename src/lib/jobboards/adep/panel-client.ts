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
import type { AdepPositionStatusResult, AdepReadOutcome } from '@/types/adep';

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

/** Le panneau n'a pas pu se charger, et il doit le DIRE plutôt que s'effacer. */
export class AdepStateUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdepStateUnavailableError';
  }
}

/**
 * ⚠️ AUCUN RETRAIT SILENCIEUX — 404 COMPRIS.
 *
 * Rendre `null` sur tout statut non-ok faisait disparaître le panneau sans un
 * mot : activer le canal « APEC » ne produisait alors RIEN, et il n'y avait
 * rien à lire pour comprendre. Deux jours de recette y sont passés.
 *
 * Le 404 mérite un mot d'explication à part. Le panneau générique, lui, se
 * retire légitimement sur 404 : sa route est derrière `DEMO_JOBBOARD_ENABLED`,
 * et « désactivée » est une réponse. La route APEC n'a AUCUN drapeau — son
 * unique 404 est « campagne inconnue », ce qui, depuis l'écran d'édition de
 * cette campagne, est une anomalie. Copier la règle du panneau générique
 * revenait à faire passer une panne pour une absence.
 *
 * Cas réel du 09/09/2026 : le manifeste de routes du serveur de développement
 * était périmé et ignorait `/api/campaigns/[id]/adep`. Next rendait 404, le
 * panneau s'évaporait, et le seul symptôme observable était « le canal APEC ne
 * déclenche rien ».
 */
export async function loadAdepState(campaignId: string): Promise<AdepState> {
  const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/adep`, {
    cache: 'no-store',
  });
  if (res.status === 404) {
    throw new AdepStateUnavailableError(
      'la route APEC a répondu « introuvable ». Si la campagne existe bien, ' +
        'le serveur ne connaît pas encore cette route : il faut le relancer.',
    );
  }
  if (!res.ok) throw new AdepStateUnavailableError(await readError(res));
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
  // ⚠️ UNE SEULE LECTURE DU CORPS.
  //
  // `Response.json()` CONSOMME le flux. Le relire — ce que faisait
  // `readError(res)` juste en dessous — lève « Body is unusable », l'exception
  // est avalée par le `.catch(() => null)` interne, et il ne reste que
  // `HTTP <statut>`. Toute publication en échec remontait donc « HTTP 500 » à
  // l'écran, quel que soit le motif que la route avait pris soin de nommer :
  // `publish_failed`, `offer_invalid` et son rapport de validation,
  // `numero_dossier_missing` et sa phrase qui dit quoi faire. Le seul moment
  // où l'on a besoin du message est celui où on le détruisait.
  //
  // Constaté le 10/09/2026, sur la première tentative de publication réelle.
  const data = (await res.json().catch(() => null)) as
    | (PublishResponse & {
        error?: string;
        message?: string;
        errors?: Array<{ message?: string }>;
      })
    | null;
  // ⚠️ La condition porte sur `outcome`, PAS sur `res.ok` : un refus de l'Apec
  // arrive en 422 AVEC un outcome, et l'écran sait le rendre champ par champ.
  if (!data?.outcome) throw new Error(describePublishFailure(data, res.status));
  return data;
}

/**
 * Le motif que la route a nommé, plutôt que son code HTTP. PUR.
 *
 * `offer_invalid` mérite un traitement à part : la route renvoie le rapport de
 * validation complet. Se contenter du nom de l'erreur laisserait chercher dans
 * un formulaire de vingt champs ce que le serveur vient d'énumérer.
 */
export function describePublishFailure(
  body: {
    error?: string;
    message?: string;
    errors?: Array<{ message?: string }>;
  } | null,
  status: number,
): string {
  if (!body) return `HTTP ${status}`;
  const details = (body.errors ?? [])
    .map((e) => e?.message)
    .filter((m): m is string => Boolean(m));
  if (details.length > 0) return details.join(' · ');
  return body.message ?? body.error ?? `HTTP ${status}`;
}

export type TransitionResponse = {
  outcome?: TransitionOutcome<AdepPositionStatusResult>;
  posting: JobPosting | null;
  simulated: boolean;
  /** `refresh` seulement — et à ne lire que sous `read.kind === 'found'`. */
  changed?: boolean;
  /** `refresh` seulement : ce que la lecture a donné. */
  read?: AdepReadOutcome;
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
 * Demande la rédaction du « profil recherché » à partir du descriptif AFFICHÉ.
 * N'écrit rien : le texte remplit le champ, le recruteur ajuste, « Publier »
 * envoie. Appelée à l'ouverture du panneau (et à la demande) — cf. la route.
 */
export async function draftApecProfile(
  campaignId: string,
  positionDescription: string,
): Promise<string> {
  const res = await fetch(
    `/api/campaigns/${encodeURIComponent(campaignId)}/adep/profile-text`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positionDescription }),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { profileDescription?: string };
  const profile = data.profileDescription?.trim() ?? '';
  if (!profile) throw new Error('Le profil rendu est vide.');
  return profile;
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
