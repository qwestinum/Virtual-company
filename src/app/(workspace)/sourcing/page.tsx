import { SourcingWorkspace } from '@/components/sourcing/SourcingWorkspace';

export const metadata = { title: 'Sourcing — QWESTINUM' };

/**
 * SOURCING — la base des campagnes ACTIVES, celle qui existait déjà.
 *
 * ⚠️ Elle n'est pas refaite : c'est le MÊME écran que la porte « Approcher des
 * profils » d'une carte de campagne ouvre, à ceci près qu'on arrive sur la
 * liste plutôt que sur une campagne nommée. Les campagnes qui ont déjà sourcé
 * y sont mises en exergue et proposent « Détail » ; les autres, « Sourcer ».
 *
 * Une seconde vue transverse a existé quelques heures et a été RETIRÉE : elle
 * listait les approches au lieu des campagnes, et donnait donc une deuxième
 * réponse à « où en est mon sourcing ? ». Deux écrans pour une question
 * finissent par se contredire.
 */
export default function SourcingPage() {
  return <SourcingWorkspace />;
}
