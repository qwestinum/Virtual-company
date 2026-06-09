/**
 * Entités d'organisation cliente — pré-requis du module Reporting
 * (cf. docs/specs/reporting.md §2). Introduites AVANT le reporting :
 *
 *   - Donneur d'ordre : la personne (interne au client) qui a INITIÉ une
 *     campagne. DISTINCT de l'utilisateur ORQA qui manipule l'interface.
 *     Une campagne a au plus un donneur d'ordre.
 *   - Site : l'entité géographique/organisationnelle de rattachement d'une
 *     campagne (orgs multi-sites). Une campagne a au plus un site. Pour les
 *     orgs mono-site, un site « par défaut » (DEFAULT_SITE_ID) est seedé.
 *
 * Les deux liens sont NULLABLE côté campagne : capture au brief (Temps 1) ou
 * via l'admin (/settings), vides pour les campagnes historiques.
 */

import { z } from 'zod';

/** Site seedé pour les organisations mono-site (cf. scripts/migrate.sql). */
export const DEFAULT_SITE_ID = 'SITE-DEFAULT';

// ── Site ────────────────────────────────────────────────────────────────────

export const SiteSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  /** Soft-archive : un site archivé est masqué des listes mais reste
   *  résolvable pour les campagnes historiques et l'audit. */
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Site = z.infer<typeof SiteSchema>;

/** Entrée de création (API POST). */
export const SiteCreateSchema = z.object({
  name: z.string().min(1).max(160),
  type: z.string().max(120).nullish(),
  city: z.string().max(120).nullish(),
  postalCode: z.string().max(20).nullish(),
});
export type SiteCreateInput = z.infer<typeof SiteCreateSchema>;

/** Patch partiel (API PATCH). */
export const SitePatchSchema = SiteCreateSchema.partial();
export type SitePatchInput = z.infer<typeof SitePatchSchema>;

// ── Donneur d'ordre ───────────────────────────────────────────────────────

export const DonneurOrdreSchema = z.object({
  id: z.string().min(1),
  firstName: z.string().nullable(),
  lastName: z.string().min(1),
  email: z.string().nullable(),
  /** Rôle ou fonction, texte libre (« Directeur du site de Lyon »…). */
  role: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DonneurOrdre = z.infer<typeof DonneurOrdreSchema>;

export const DonneurOrdreCreateSchema = z.object({
  firstName: z.string().max(120).nullish(),
  lastName: z.string().min(1).max(120),
  email: z.string().email().max(255).nullish(),
  role: z.string().max(160).nullish(),
});
export type DonneurOrdreCreateInput = z.infer<typeof DonneurOrdreCreateSchema>;

export const DonneurOrdrePatchSchema = DonneurOrdreCreateSchema.partial();
export type DonneurOrdrePatchInput = z.infer<typeof DonneurOrdrePatchSchema>;
