/**
 * Rail de drain des événements de réservation.
 *
 * Le module écrit ses événements dans une outbox et tente de les livrer tout
 * de suite. Ici, la livraison immédiate n'existe PAS : le consommateur n'est
 * jamais branché sur les surfaces candidat (cf. `configure.ts`), pour que
 * personne n'attende devant sa page de confirmation qu'ORQA télécharge un CV.
 * Le drain est donc le chemin NORMAL de livraison, pas un rattrapage.
 *
 * Trois déclencheurs, tous idempotents et sans coût à vide :
 *   - le cron de relève (production Vercel) ;
 *   - le tick du scheduler local (dev / VPS) ;
 *   - l'ouverture de l'onglet Entretiens (le drain sert celui qui attend).
 */
import { drainPendingEvents } from '@/lib/scheduling';

import { ensureSchedulingConsumer } from './configure';

export type DrainOutcome = {
  dispatched: number;
  failed: number;
  repaired: number;
};

const IDLE: DrainOutcome = { dispatched: 0, failed: 0, repaired: 0 };

/**
 * Draine la file. N'échoue JAMAIS vers l'appelant : ce rail est greffé sur des
 * traitements qui ont leur propre raison d'être (relever des mails, afficher
 * une liste) et ne doivent pas tomber parce qu'un rendez-vous est mal en point.
 */
export async function drainSchedulingEvents(): Promise<DrainOutcome> {
  try {
    await ensureSchedulingConsumer();
    return await drainPendingEvents();
  } catch (err) {
    console.error('[scheduling-drain] échec', err);
    return IDLE;
  }
}
