/**
 * Réglage du module Sourcing — SECOND étage du flag (docs/specs/sourcing.md §13).
 *
 * Le premier étage est en variables d'environnement (`SOURCING_ENABLED`,
 * `EXA_API_KEY`, `SOURCING_FINGERPRINT_PEPPER`) : il suit le déploiement et
 * décide si la surface PEUT exister chez ce client. Celui-ci décide si elle
 * est ALLUMÉE, sans redéploiement. Les deux sont requis ; défaut : éteint.
 */
import { z } from 'zod';

export const SourcingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Langue proposée par défaut — mesuré : le français trouve la spécialité (§2.5). */
  defaultLanguage: z.enum(['fr', 'en']).default('fr'),
});
export type SourcingConfig = z.infer<typeof SourcingConfigSchema>;

export const DEFAULT_SOURCING_CONFIG: SourcingConfig = {
  enabled: false,
  defaultLanguage: 'fr',
};
