/**
 * Hook de démarrage serveur (Next.js `instrumentation`).
 *
 * `register()` est appelé une fois par instance serveur, au boot — avant toute
 * requête. On y démarre le scheduler IMAP pour que la relève des candidatures
 * par mail tourne CÔTÉ SERVEUR EN CONTINU, indépendamment de toute activité UI.
 *
 * Bug corrigé : avant, le scheduler n'était lancé QUE par le premier
 * `GET /api/mailboxes` (mount de Réglages > Mailboxes, picker, ou un flux chat).
 * Après un redémarrage serveur (déploiement, crash, edit en dev) sans visite de
 * cette page, le polling ne démarrait jamais → les candidatures par mail
 * n'étaient plus traitées (« comme si on n'envoie rien »). Une boîte de
 * recrutement doit être relevée que le navigateur soit ouvert ou non.
 *
 * On ne démarre qu'en runtime Node : le scheduler utilise IMAP/Node, jamais
 * l'edge runtime. `ensureSchedulerStarted` est idempotent (garde sur
 * globalThis) — un re-register au hot-reload ne lance pas de second timer.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { ensureSchedulerStarted } = await import('@/lib/imap/scheduler');
  ensureSchedulerStarted();
}
