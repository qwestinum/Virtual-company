import { CampaignAnnonceScreen } from '@/components/campagnes/CampaignAnnonceScreen';

export const metadata = { title: 'Diffuser l’annonce — QWESTINUM' };

/**
 * Le contenu publiable d'une campagne, à son ADRESSE. Un geste, un écran.
 */
export default async function AnnoncePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CampaignAnnonceScreen campaignId={id} />;
}
