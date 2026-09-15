/**
 * Connecteur d'agenda externe — étage DÉPLOIEMENT du flag, fail-closed.
 *
 * Allumé seulement si `BUSY_CALENDAR_ENABLED` vaut EXACTEMENT `1` et que la
 * clé de chiffrement est présente et bien formée (sans elle, aucune URL ne se
 * déchiffre : allumer le connecteur bloquerait tous les agendas déclarés).
 * Éteint : la source n'est pas injectée, le moteur est strictement celui
 * d'avant.
 *
 * L'étage CABINET (`app_settings`) arrive avec l'écran de réglage (lot D) :
 * tant qu'aucune URL ne peut être saisie, il n'aurait rien à gouverner.
 */
export function isBusyCalendarEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if ((env.BUSY_CALENDAR_ENABLED ?? '').trim() !== '1') return false;
  return /^[0-9a-fA-F]{64}$/.test(env.MAILBOX_ENCRYPTION_KEY ?? '');
}
