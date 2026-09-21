import { DiffusionOverview } from '@/components/diffusion/DiffusionOverview';
import { PageShell } from '@/components/navigation/PageShell';

export const metadata = { title: 'Diffusion — QWESTINUM' };

/**
 * DIFFUSION — toutes les annonces publiées, tous canaux, toutes campagnes.
 *
 * L'état d'une annonce ne se voyait que dans sa campagne : personne ne pouvait
 * dire laquelle allait basculer sans les ouvrir une par une.
 */
export default function DiffusionPage() {
  return (
    <PageShell
      title="Diffusion"
      subtitle="Vos annonces en ligne, tous canaux. L’état vient du diffuseur et porte la date à laquelle il a été lu."
    >
      <DiffusionOverview />
    </PageShell>
  );
}
