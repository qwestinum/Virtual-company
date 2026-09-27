import { CampaignVivierScreen } from '@/components/campagnes/CampaignVivierScreen';

export const metadata = { title: 'Chercher dans le vivier — QWESTINUM' };

/**
 * La présélection vivier d'une campagne, à son ADRESSE. Un geste, un écran.
 */
export default async function VivierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CampaignVivierScreen campaignId={id} />;
}
