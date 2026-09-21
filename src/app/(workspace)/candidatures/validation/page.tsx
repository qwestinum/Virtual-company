import Link from 'next/link';

import { PageShell } from '@/components/navigation/PageShell';
import { ValidationsHub } from '@/components/validations/ValidationsHub';

export const metadata = { title: 'Revue de candidature — QWESTINUM' };

/**
 * REVUE DE CANDIDATURE — la revue GROUPÉE des dossiers à valider.
 *
 * ⚠️ Ce n'est pas un second chemin vers la décision à l'unité : celle-ci reste
 * sous la puce « À valider » de Candidatures. Ici, on passe en revue d'un bloc
 * — c'est ce que le refus groupé demande, et c'est pour ça que l'écran a sa
 * propre porte dans la barre du haut (lot 8 ter).
 *
 * ⚠️ IL PORTE LE GABARIT COMMUN depuis le 22/09/2026. Il gardait son propre
 * conteneur (`max-w-6xl`, marges à lui) : il échappait aux mesures de S32 et
 * S34, qui ne couvrent que les cinq entrées, et la page changeait donc de
 * cadre en y entrant. L'écran lui-même — partition en sous-onglets, cartes,
 * filtre par référent, refus groupé — n'a pas bougé d'une ligne.
 *
 * Le TITRE reprend le mot du lien qu'on vient de cliquer : arriver sur un
 * écran qui porte un autre nom fait douter d'être au bon endroit.
 */
export default function ValidationReviewPage() {
  return (
    <PageShell
      title="Revue de candidature"
      subtitle="Les candidatures qui attendent votre validation, passées en revue d’un bloc."
    >
      <Link
        href="/candidatures?statut=a_valider"
        className="mb-4 inline-flex items-center gap-1.5 font-body text-[13px] font-semibold"
        style={{ color: 'var(--dash-text-secondary)' }}
      >
        <span aria-hidden>←</span> Les voir une par une
      </Link>
      <ValidationsHub />
    </PageShell>
  );
}
