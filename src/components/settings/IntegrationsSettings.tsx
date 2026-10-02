'use client';

/**
 * Contenu des sections « Flux d'arrivée » et « Canaux de diffusion » de
 * /settings (extrait du hub, 02/10/2026).
 */

import { CV_SOURCES, CV_SOURCE_HINTS, CV_SOURCE_LABELS } from '@/types/cv-source';
import {
  PUBLICATION_CHANNEL_LABELS,
  PUBLICATION_CHANNEL_ORDER,
  type PublicationChannel,
} from '@/types/publication-channel';
import { DEFAULT_ADEP_CONFIG } from '@/types/adep-settings';

import { ApecConfigManager } from './ApecConfigManager';
import { IntegrationCard } from './IntegrationCard';
import type { PatchAndSave, SettingsData } from './settings-data';

/**
 * Flux réellement CONFIGURABLES : « manuel », « dossier local » et « vivier »
 * n'ont pas d'identifiants d'API — les compter fausserait le « n sur N ».
 */
export const INTEGRATION_SOURCES = CV_SOURCES.filter(
  (source) => source !== 'manual' && source !== 'local_folder' && source !== 'vivier',
);

type Props = { settings: SettingsData; patchAndSave: PatchAndSave };

export function FluxIntegrations({ settings, patchAndSave }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {INTEGRATION_SOURCES.map((id) => (
        <IntegrationCard
          key={id}
          label={CV_SOURCE_LABELS[id]}
          hint={CV_SOURCE_HINTS[id]}
          config={settings.fluxConfig[id] ?? { status: 'unconfigured' }}
          onSave={(next) =>
            patchAndSave(
              { fluxConfig: { ...settings.fluxConfig, [id]: next } },
              `Intégration ${CV_SOURCE_LABELS[id]} mise à jour.`,
            )
          }
        />
      ))}
    </div>
  );
}

export function ChannelIntegrations({ settings, patchAndSave }: Props) {
  return (
    <>
      {/* APEC a son propre bloc : ses identifiants sont des variables
          d'environnement, pas un token en base. Laisser la carte générique
          ferait croire qu'on configure le connecteur en collant une clé. */}
      <div className="mb-4 rounded-lg border border-stone-200 bg-white p-3">
        <p className="mb-2 font-body text-[13px] font-semibold text-stone-800">
          APEC — réglages du cabinet
        </p>
        <ApecConfigManager
          config={settings.adepConfig ?? DEFAULT_ADEP_CONFIG}
          onSave={(next) => patchAndSave({ adepConfig: next }, 'Réglages APEC mis à jour.')}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PUBLICATION_CHANNEL_ORDER.filter((c) => c !== 'generic' && c !== 'apec').map(
          (channel) => {
            const id = channel as PublicationChannel;
            return (
              <IntegrationCard
                key={id}
                label={PUBLICATION_CHANNEL_LABELS[id]}
                hint="API token / OAuth — à brancher via l'agent Publisher"
                config={settings.channelsConfig[id] ?? { status: 'unconfigured' }}
                onSave={(next) =>
                  patchAndSave(
                    { channelsConfig: { ...settings.channelsConfig, [id]: next } },
                    `Intégration ${PUBLICATION_CHANNEL_LABELS[id]} mise à jour.`,
                  )
                }
              />
            );
          },
        )}
      </div>
    </>
  );
}
