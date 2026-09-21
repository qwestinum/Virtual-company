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

import { CampaignAssistant } from './CampaignAssistant';

export function CampaignAssistantScreen() {
  const params = useSearchParams();
  const resumeId = params?.get(PARAM.campagne) ?? null;

  return (
    <div
      className="font-body"
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        background: 'transparent',
        color: 'var(--dash-text)',
      }}
    >
      {/* ⚠️ GOUTTIÈRE BASSE de 260 px, et ce n'est pas du confort : le bandeau
          « Des actions vous attendent » du workspace est posé en bas à droite,
          sur ~230 px de haut, et il RECOUVRAIT le bouton « Activer la
          campagne » — cliquer dessus atteignait la notification, pas le
          bouton. Défaut trouvé en cliquant (S30.6) ; invisible à la lecture du
          code, puisque les deux éléments vivent dans des composants qui ne se
          connaissent pas. La gouttière permet de faire remonter le pied
          au-dessus du bandeau. */}
      <div style={{ padding: '24px 28px 260px', maxWidth: 980, margin: '0 auto' }}>
        <CampaignAssistant key={resumeId ?? 'neuve'} resumeId={resumeId} />
      </div>
    </div>
  );
}
