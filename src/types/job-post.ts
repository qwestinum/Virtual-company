/**
 * Annonce publiée sur le jobboard de démonstration (canal « Annonce
 * générique »).
 *
 * Le contenu est un SNAPSHOT figé au clic « Publier » : ce que l'humain a relu
 * part tel quel et n'est jamais re-généré derrière son dos (même principe que
 * le preview HITL des mails). Le type reflète cette intention — il ne porte
 * AUCUNE référence à la fiche de poste, seulement le texte retenu.
 *
 * La RÉFÉRENCE affichée au candidat est l'identifiant de campagne lui-même
 * (`CAMP-YYYY-NNN`), jamais un second identifiant cosmétique : c'est cette
 * chaîne exacte que le commercial montre sur l'annonce publique, qui voyage
 * dans l'objet du mail de candidature, et que le poller cherche pour rattacher
 * le CV à LA campagne. Un doublon d'identifiant casserait le fil de
 * traçabilité qui fait toute la démonstration.
 */

import { z } from 'zod';

import { joinContracts } from '@/lib/fdp/contract-type';
import type { FDPInProgress } from '@/types/field-collection';

export type DemoJobPost = {
  campaignId: string;
  title: string;
  body: string;
  tags: string[];
  /** Dérivés de la FDP au moment du snapshot — figés comme le reste. */
  location: string | null;
  contract: string | null;
  isVisible: boolean;
  publishedAt: string | null;
  updatedAt: string;
};

/** Payload accepté par le PUT (publication). Le client n'envoie que du texte. */
export const JobPostPublishSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
});
export type JobPostPublishInput = z.infer<typeof JobPostPublishSchema>;

/** Lecture défensive d'un champ FDP en texte affichable. `null` si vide. */
export function fdpText(fdp: FDPInProgress, key: 'location'): string | null {
  const raw = fdp.fields[key]?.value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Contrat affichable (« CDI », « CDD · alternance »). Le champ est multi-valeur
 * depuis la refonte FDP : on passe par le helper canonique plutôt que de
 * re-dériver une n-ième lecture maison.
 */
export function fdpContract(fdp: FDPInProgress): string | null {
  const joined = joinContracts(fdp.fields.contract_type?.value).trim();
  return joined.length > 0 ? joined : null;
}

/**
 * Titre de repli quand la génération n'a pas encore tourné : l'intitulé de la
 * FDP. Jamais une chaîne vide — une annonce sans titre n'est pas publiable.
 */
export function fdpJobTitle(fdp: FDPInProgress): string {
  const raw = fdp.fields.job_title?.value;
  return typeof raw === 'string' && raw.trim().length > 0
    ? raw.trim()
    : 'Poste à pourvoir';
}
