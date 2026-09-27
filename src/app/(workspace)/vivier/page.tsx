import { PageShell } from '@/components/navigation/PageShell';
import { VivierHub } from '@/components/vivier/VivierHub';

export const metadata = { title: 'Vivier — QWESTINUM' };

/**
 * Vivier de candidats (cf. docs/specs/vivier.md) — stock interne de dossiers,
 * indépendant des campagnes.
 *
 * ⚠️ IL A REJOINT LA COQUILLE du workspace (groupe `(workspace)`) sans changer
 * d'adresse : il portait son propre bandeau, son propre conteneur de 896 px et
 * aucune colonne — on quittait le produit en y entrant. C'est un espace de
 * GESTION TRANSVERSE, pas une sixième entrée : il vit donc dans la barre du
 * haut, et garde la colonne à sa gauche pour qu'on en revienne d'un clic.
 */
export default function VivierPage() {
  return (
    <PageShell
      title="Vivier de candidats"
      subtitle="Votre stock de CV, indexé et réutilisable d’une campagne à l’autre. Chaque dépôt est analysé puis indexé automatiquement."
    >
      <VivierHub />
    </PageShell>
  );
}
