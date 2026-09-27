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
 * ── REPLIÉ PAR DÉFAUT ───────────────────────────────────────────────────────
 *
 * Dix-sept champs déroulés sous un toggle, dans un bloc « Canaux » qui en
 * contient d'autres, noyaient la page. Le panneau se réduit donc à trois
 * lignes — état, préalables, un bouton — et le travail s'ouvre en sections,
 * une seule à la fois : « L'annonce » est ce qu'on relit, « Ce que l'Apec
 * demande en plus » est ce qu'on tranche.
 *
 * Une modale aurait empilé une couche par-dessus le Sheet d'édition de
 * campagne, avec deux Échap concurrents — et une saisie perdue sur un geste
 * irréversible. En attendant la refonte de l'écran, le pliage règle
 * l'encombrement sans rien risquer.
 *
 * « Vérifier » est distinct de « Publier » : il lance le validateur local et
 * liste les problèmes, chacun rattaché à son champ. Publier valide de toute
 * façon — l'existence du bouton dit simplement que la vérification est locale,
 * gratuite, et qu'on peut la refaire autant qu'on veut.
 *
 * L'état vit dans `useApecPanel` ; ce fichier n'est qu'une vue.
 */
import { errorsByField } from '@/lib/jobboards/adep/draft-check';
import { adepPhase, ADEP_IMMUTABLE_NOTICE } from '@/lib/jobboards/adep/panel-state';
import { useApecPanel } from '@/lib/jobboards/adep/use-apec-panel';

import { ApecFieldProvider } from './ApecFieldContext';
import { ApecIssueList } from './ApecIssueList';
import { ApecOfferForm } from './ApecOfferForm';
import { ApecPrefillNotice } from './ApecPrefillNotice';
import { ApecPublishedCard } from './ApecPublishedCard';
import { ApecRequirementsGrid } from './ApecRequirementsGrid';
import { CollapsibleSection } from './CollapsibleSection';
import { useApecSections } from './useApecSections';
import { errorStyle, ghostBtn, headerStyle, panelStyle, primaryBtn } from './job-ad-panel-styles';

/** Champs de la grille qu'ORQA ne sait pas toujours remplir — comptés repliés. */
const GRID_FIELDS = [
  'jobType',
  'statusJob',
  'experienceLevel',
  'inseeCode',
  'travelZone',
  'salaryMin',
] as const;

export function ApecPanel({ campaignId }: { campaignId: string }) {
  const panel = useApecPanel(campaignId);
  const { state, offer } = panel;
  const { open, setOpen, toggle, goToField } = useApecSections(panel.issues);

  // Le panneau ne se retire QUE sur `absent` (aucune surface APEC pour cette
  // campagne). Un chargement en échec reste à l'écran et dit pourquoi : sinon
  // activer le canal « APEC » ne produit rien du tout, et il n'y a rien à lire
  // pour comprendre — c'est le bug muet du 09/09.
  if (panel.phase === 'error') {
    return (
      <div style={panelStyle}>
        <div style={headerStyle}>
          <strong style={{ color: 'var(--dash-text)' }}>APEC</strong>
        </div>
        <div style={errorStyle}>
          Le panneau APEC n’a pas pu se charger — {panel.error ?? 'raison inconnue'}
        </div>
        <button
          type="button"
          style={{ ...ghostBtn, marginTop: 10 }}
          onClick={() => void panel.reload()}
        >
          Réessayer
        </button>
      </div>
    );
  }

  if (panel.phase !== 'ready' || !state || !offer) return null;

  const published = state.posting && adepPhase(state.posting) !== 'failed';
  const toTreat = GRID_FIELDS.filter(
    (f) => (state.notes[f]?.origin ?? 'missing') === 'missing',
  ).length;

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <strong style={{ color: 'var(--dash-text)' }}>APEC</strong>
        {state.simulated ? (
          <span style={{ fontSize: 12, color: 'var(--dash-orange)' }}>· mode simulation</span>
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
          {open === null ? (
            <button
              type="button"
              style={{ ...primaryBtn, marginBottom: 10 }}
              onClick={() => setOpen('annonce')}
            >
              Préparer la publication
            </button>
          ) : null}

          {open !== null ? (
            <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--dash-text-secondary)' }}>
              <span style={{ color: 'var(--dash-red-text)' }}>*</span> champ obligatoire
              pour l’Apec
            </p>
          ) : null}
          <ApecFieldProvider offer={offer} errors={errorsByField(panel.issues)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <CollapsibleSection
                title="L’annonce"
                icon="📝"
                subtitle={
                  panel.prefill
                    ? `repris de l’${panel.prefill.label}`
                    : 'titre, descriptif, profil'
                }
                open={open === 'annonce'}
                onToggle={() => toggle('annonce')}
              >
                <ApecPrefillNotice prefill={panel.prefill} />
                <ApecOfferForm
                  offer={offer}
                  // `panel.notes` et non `state.notes` : le profil est rédigé
                  // côté client, sa provenance n'est connue que du panneau.
                  notes={panel.notes}
                  onChange={panel.patch}
                  textDrafting={panel.textDrafting}
                  textError={panel.textError}
                  onDraftText={(target) => void panel.draftOfferText(target)}
                />
              </CollapsibleSection>

              <CollapsibleSection
                title="Ce que l’Apec demande en plus"
                icon="📋"
                subtitle={
                  toTreat > 0
                    ? `${toTreat} champ${toTreat > 1 ? 's' : ''} à compléter`
                    : 'tout est renseigné'
                }
                open={open === 'exigences'}
                onToggle={() => toggle('exigences')}
              >
                <ApecRequirementsGrid
                  offer={offer}
                  notes={panel.notes}
                  onChange={panel.patch}
                />
              </CollapsibleSection>
            </div>
          </ApecFieldProvider>

          <ApecIssueList issues={panel.issues} verified={panel.verified} onSelect={goToField} />

          {open !== null ? (
            <>
              <p style={{ margin: '12px 0 10px', fontSize: 12, color: 'var(--dash-orange)' }}>
                ⚠ {ADEP_IMMUTABLE_NOTICE}
              </p>

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={ghostBtn} onClick={panel.verify} disabled={panel.busy}>
                  Vérifier
                </button>
                <button
                  type="button"
                  style={primaryBtn}
                  // Désarmé dès le clic : `openPosition` n'est pas idempotent,
                  // et deux clics feraient deux offres. La réservation en base
                  // rattrape, mais on ne compte pas sur le filet.
                  onClick={() => void panel.publish()}
                  disabled={panel.busy || state.blockers.length > 0}
                >
                  {panel.busy ? 'Publication…' : 'Publier sur l’APEC'}
                </button>
              </div>
            </>
          ) : null}
        </>
      )}

      {panel.error ? <div style={{ ...errorStyle, marginTop: 10 }}>{panel.error}</div> : null}
      {/* Une action qui aboutit sans rien changer le DIT : sinon l'écran reste
          identique et le bouton passe pour mort. */}
      {panel.notice ? (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--dash-text-secondary)' }}>
          {panel.notice}
        </div>
      ) : null}
    </div>
  );
}
