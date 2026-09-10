'use client';

/**
 * Étape qui SUIT la création d'une campagne, dans la même feuille.
 *
 * Elle existe parce que deux surfaces ne peuvent pas vivre dans le brouillon :
 * l'annonce réellement publiée d'un canal (générique, APEC) et la présélection
 * vivier ont besoin d'une campagne ENREGISTRÉE, et elles ne s'ouvrent qu'une
 * fois la campagne ACTIVE — elles font arriver des candidatures, qui ne sont
 * analysées que sur une campagne active. On ne renvoie donc plus le DRH rouvrir
 * la campagne en édition : il active ici, puis diffuse ici.
 *
 * L'état affiché est LU DANS LE STORE, pas dans le snapshot reçu à la
 * création : l'activation se fait sur cet écran, et un snapshot figé
 * continuerait d'annoncer « en brouillon » une campagne devenue active.
 */

import { canActivate } from '@/lib/campaign/lifecycle';
import { useCampaignsStore, type ActiveCampaign } from '@/stores/campaigns-store';
import { countUntreatedSuggestions } from '@/types/scoring';

import { PostActivationPanels } from './PostActivationPanels';
import {
  ActivationGateNotice,
  GhostButton,
  MailboxFailureNotice,
  Notice,
  PrimaryButton,
} from './created-step-parts';

export type CampaignCreatedStepProps = {
  campaign: ActiveCampaign;
  mailboxFailures: number;
  /** Régime de réservation demandé mais NON appliqué (message serveur). */
  schedulingNotice: string | null;
  activateError: string | null;
  onActivate: () => void;
  onEdit: () => void;
  onClose: () => void;
};

export function CampaignCreatedStep({
  campaign: snapshot,
  mailboxFailures,
  schedulingNotice,
  activateError,
  onActivate,
  onEdit,
  onClose,
}: CampaignCreatedStepProps) {
  const live = useCampaignsStore((s) => s.byId[snapshot.id]);
  const campaign = live ?? snapshot;
  const active = campaign.status === 'active';

  const phaseGate = canActivate(campaign.lifecycle);
  const untreated = countUntreatedSuggestions(campaign.scoringSheet);
  // Même verrou que le store : phases obligatoires faites ET aucune pondération
  // suggérée par l'IA laissée sans décision humaine.
  const gateOk = phaseGate.ok && untreated === 0;

  return (
    <>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: '20px 22px 18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span aria-hidden style={{ fontSize: 22, lineHeight: 1 }}>
            {active ? '🚀' : '✅'}
          </span>
          <div>
            <h3
              className="font-display"
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 800,
                color: 'var(--dash-text)',
              }}
            >
              {active ? 'Campagne lancée' : 'Campagne enregistrée'}
            </h3>
            <p
              className="font-body"
              style={{
                margin: '2px 0 0',
                fontSize: 12,
                color: 'var(--dash-text-secondary)',
              }}
            >
              {campaign.id} — « {campaign.name} »{' '}
              {active
                ? 'est active : le flux de réception est ouvert.'
                : 'est en brouillon.'}
            </p>
          </div>
        </div>

        {mailboxFailures > 0 ? (
          <MailboxFailureNotice count={mailboxFailures} />
        ) : null}

        {schedulingNotice ? (
          <Notice tone="yellow">
            ⚠️ <strong>Réservation d’entretien</strong> — {schedulingNotice} La
            campagne reste donc sur le lien d’agenda configuré ; reprenez le
            réglage dans le bloc <strong>Réservation d’entretien</strong> de
            l’édition.
          </Notice>
        ) : null}

        {!active && gateOk ? (
          <p
            className="font-body"
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.5,
              color: 'var(--dash-text-secondary)',
            }}
          >
            Tout est prêt. Activez-la pour démarrer la diffusion et la veille du
            CV Analyzer — ou gardez-la en brouillon pour plus tard.
          </p>
        ) : null}

        {!active && !gateOk ? (
          <ActivationGateNotice
            missing={phaseGate.missing}
            untreatedSuggestions={untreated}
          />
        ) : null}

        {activateError ? (
          <Notice tone="red" alert>
            {activateError}
          </Notice>
        ) : null}

        <PostActivationPanels campaign={campaign} active={active} />
      </div>

      <footer
        style={{
          padding: '14px 22px',
          borderTop: '1px solid var(--dash-border)',
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        {active ? (
          <PrimaryButton label="Terminer" onClick={onClose} tone="green" />
        ) : (
          <>
            <GhostButton label="Garder en brouillon" onClick={onClose} />
            {gateOk ? (
              <PrimaryButton
                label="Activer la campagne"
                onClick={onActivate}
                tone="green"
              />
            ) : (
              <PrimaryButton
                label="Compléter la campagne"
                onClick={onEdit}
                tone="blue"
              />
            )}
          </>
        )}
      </footer>
    </>
  );
}
