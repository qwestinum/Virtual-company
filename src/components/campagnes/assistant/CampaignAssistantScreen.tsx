'use client';

/**
 * Point de montage de l'assistant — il ne fait QUE lire l'adresse.
 *
 * `?campagne=CAMP-…` reprend un brouillon ; sans lui, on part d'une campagne
 * neuve. Rien d'autre ne vit ici : la logique est dans `CampaignAssistant`, et
 * les règles d'étape dans `assistant-steps` (pur, testé).
 */

import { useSearchParams } from 'next/navigation';

import { PARAM } from '@/lib/navigation/workspace-routes';

import { PageShell } from '@/components/navigation/PageShell';

import { CampaignAssistant } from './CampaignAssistant';

export function CampaignAssistantScreen() {
  const params = useSearchParams();
  const resumeId = params?.get(PARAM.campagne) ?? null;

  return (
    // ⚠️ GABARIT COMMUN. L'écran portait son propre conteneur (980 px). La
    // carte, elle, garde sa largeur de lecture : c'est du CONTENU, pas le
    // cadre de la page. `bottomSpace` aéré parce que le geste principal vit
    // en bas à droite, là où le bandeau de notifications est posé.
    <PageShell bottomSpace="wide">
      <div style={{ maxWidth: 980 }}>
        <CampaignAssistant key={resumeId ?? 'neuve'} resumeId={resumeId} />
      </div>
    </PageShell>
  );
}
