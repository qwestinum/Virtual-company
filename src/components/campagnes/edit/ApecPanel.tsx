'use client';

/**
 * Panneau du canal « APEC », à côté d'« Annonce générique ».
 *
 * Deux états, jamais mélangés : tant que rien n'est parti, on montre le
 * formulaire ; dès qu'une offre existe chez l'Apec, on montre son état. Le
 * contenu étant FIGÉ à la publication (`updatePosition` est désactivé côté
 * Apec), afficher un formulaire éditable au-dessus d'une offre publiée
 * laisserait croire qu'on peut la corriger.
 *
 * « Vérifier » est distinct de « Publier » : il lance le validateur local et
 * liste les problèmes, chacun rattaché à son champ. Publier valide de toute
 * façon — l'existence du bouton dit simplement que la vérification est locale,
 * gratuite, et qu'on peut la refaire autant qu'on veut.
 *
 * L'état vit dans `useApecPanel` ; ce fichier n'est qu'une vue.
 */
import { adepPhase, ADEP_IMMUTABLE_NOTICE } from '@/lib/jobboards/adep/panel-state';
import { useApecPanel } from '@/lib/jobboards/adep/use-apec-panel';

import { ApecOfferForm } from './ApecOfferForm';
import { ApecPublishedCard } from './ApecPublishedCard';
import { errorStyle, ghostBtn, headerStyle, panelStyle, primaryBtn } from './job-ad-panel-styles';

export function ApecPanel({ campaignId }: { campaignId: string }) {
  const panel = useApecPanel(campaignId);
  const { state, offer } = panel;

  if (panel.phase !== 'ready' || !state || !offer) return null;

  const published = state.posting && adepPhase(state.posting) !== 'failed';
  const errors = panel.issues?.filter((i) => i.level === 'error') ?? [];
  const warnings = panel.issues?.filter((i) => i.level === 'warning') ?? [];

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <strong style={{ color: 'var(--dash-text)' }}>APEC</strong>
        {state.simulated ? (
          <span style={{ fontSize: 12, color: '#b45309' }}>· mode simulation</span>
        ) : null}
        <span style={{ marginLeft: 'auto', fontSize: 12 }}>
          {state.owner ? `Référent : ${state.owner.displayName}` : 'Aucun référent'}
          {' · '}
          {state.clientReference}
        </span>
      </div>

      {/* Les préalables sont dits AVANT le bouton, jamais au moment de l'envoi. */}
      {state.blockers.length > 0 ? (
        <ul style={{ ...errorStyle, margin: '0 0 10px', paddingLeft: 18 }}>
          {state.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}

      {published && state.posting ? (
        <ApecPublishedCard
          posting={state.posting}
          simulated={state.simulated}
          busy={panel.busy}
          onRefresh={() => void panel.act('refresh')}
          onSuspend={() => void panel.act('suspend')}
          onRepublish={() => void panel.act('republish')}
        />
      ) : (
        <>
          <ApecOfferForm offer={offer} notes={state.notes} onChange={panel.patch} />

          {errors.length > 0 ? (
            <ul style={{ ...errorStyle, marginTop: 10, paddingLeft: 18 }}>
              {errors.map((i) => (
                <li key={`${i.field}-${i.preventsCode}-${i.message}`}>{i.message}</li>
              ))}
            </ul>
          ) : null}
          {warnings.length > 0 ? (
            <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12, color: '#b45309' }}>
              {warnings.map((i) => (
                <li key={`${i.field}-${i.message}`}>{i.message}</li>
              ))}
            </ul>
          ) : null}
          {panel.issues && errors.length === 0 ? (
            <div style={{ marginTop: 10, fontSize: 13, color: '#15803d' }}>
              Aucune erreur — l’offre est prête à partir.
            </div>
          ) : null}

          <p style={{ margin: '12px 0 10px', fontSize: 12, color: '#b45309' }}>
            ⚠ {ADEP_IMMUTABLE_NOTICE}
          </p>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={ghostBtn} onClick={panel.verify} disabled={panel.busy}>
              Vérifier
            </button>
            <button
              type="button"
              style={primaryBtn}
              // Désarmé dès le clic : `openPosition` n'est pas idempotent, et
              // deux clics feraient deux offres. La réservation en base
              // rattrape, mais on ne compte pas sur le filet.
              onClick={() => void panel.publish()}
              disabled={panel.busy || state.blockers.length > 0}
            >
              {panel.busy ? 'Publication…' : 'Publier sur l’APEC'}
            </button>
          </div>
        </>
      )}

      {panel.error ? <div style={{ ...errorStyle, marginTop: 10 }}>{panel.error}</div> : null}
    </div>
  );
}
