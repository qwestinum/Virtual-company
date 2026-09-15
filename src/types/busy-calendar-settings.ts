/**
 * Connecteur d'agenda externe — SECOND étage du flag (docs/specs/agenda-externe.md §10).
 *
 * Le premier étage est en variables d'environnement (`BUSY_CALENDAR_ENABLED`,
 * `MAILBOX_ENCRYPTION_KEY`) : il décide si la fonction PEUT exister sur ce
 * déploiement. Celui-ci décide si le cabinet l'ALLUME, sans redéploiement.
 * Les deux sont requis ; défaut : éteint.
 */
import { z } from 'zod';

export const BusyCalendarConfigSchema = z.object({
  enabled: z.boolean().default(false),
});
export type BusyCalendarConfig = z.infer<typeof BusyCalendarConfigSchema>;

export const DEFAULT_BUSY_CALENDAR_CONFIG: BusyCalendarConfig = { enabled: false };
