'use client';

/**
 * Éditeur de canaux pour un brouillon de campagne (Session 6 v2).
 *
 * Symétrique de `ChannelsEditBlock` mais sans store : le parent
 * détient la liste sélectionnée et reçoit chaque toggle via onChange.
 */

import {
  PUBLICATION_CHANNEL_LABELS,
  PUBLICATION_CHANNEL_ORDER,
  type PublicationChannel,
} from '@/types/publication-channel';

export type ChannelsDraftEditorProps = {
  selected: PublicationChannel[];
  onChange: (next: PublicationChannel[]) => void;
  /** Canaux à proposer (défaut : tous — l'édition d'une campagne ancienne). */
  channels?: readonly PublicationChannel[];
  /**
   * Canaux montrés mais PAS encore branchés : cochables, non. On les AFFICHE
   * quand même, avec « bientôt » — masquer une destination qu'on prépare
   * laisserait croire qu'elle n'existera jamais.
   */
  comingSoon?: readonly PublicationChannel[];
};

export function ChannelsDraftEditor({
  selected,
  onChange,
  channels = PUBLICATION_CHANNEL_ORDER,
  comingSoon = [],
}: ChannelsDraftEditorProps) {
  const toggle = (channel: PublicationChannel) => {
    if (selected.includes(channel)) {
      onChange(selected.filter((c) => c !== channel));
    } else {
      onChange([...selected, channel]);
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {channels.map((channel) => {
        const enabled = selected.includes(channel);
        const bientot = comingSoon.includes(channel);
        return (
          <button
            key={channel}
            type="button"
            data-channel={channel}
            disabled={bientot}
            onClick={() => toggle(channel)}
            aria-pressed={enabled}
            className="font-body"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderRadius: 10,
              border: `1px solid ${enabled ? 'var(--dash-green)' : 'var(--dash-border)'}`,
              background: enabled
                ? 'var(--dash-green-light)'
                : 'var(--dash-warm)',
              color: enabled
                ? 'var(--dash-green)'
                : 'var(--dash-text-secondary)',
              fontWeight: 600,
              fontSize: 13,
              cursor: bientot ? 'not-allowed' : 'pointer',
              opacity: bientot ? 0.55 : 1,
            }}
          >
            <span>
              {PUBLICATION_CHANNEL_LABELS[channel]}
              {bientot ? (
                <span
                  className="font-body"
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--dash-text-secondary)',
                  }}
                >
                  bientôt
                </span>
              ) : null}
            </span>
            <span
              aria-hidden
              style={{
                width: 34,
                height: 18,
                borderRadius: 999,
                background: enabled
                  ? 'var(--dash-green)'
                  : 'var(--dash-border-strong)',
                position: 'relative',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  left: enabled ? 18 : 2,
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 0.15s',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}
