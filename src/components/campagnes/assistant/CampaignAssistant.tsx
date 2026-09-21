'use client';

/**
 * L'assistant de création en six étapes — le lieu, l'état et la persistance.
 *
 * ⚠️ RÈGLE DU LOT : **le flux EST la sauvegarde.** Aucun bouton « Enregistrer ».
 * Dès la première étape validée, la campagne EXISTE en base, en brouillon ;
 * chaque « Suivant » suivant rejoue le même chemin d'écriture confirmé que la
 * création historique (`addCampaign` en upsert + `persistCampaign`, qui attend
 * la confirmation serveur avant de déclarer quoi que ce soit). Fermer et
 * revenir reprend à la première étape encore incomplète.
 *
 * ⚠️ Deux réglages ne peuvent PAS voyager dans le snapshot et sont appliqués à
 * part, comme avant : le rattachement des boîtes mail (`associateMailbox`) et
 * le régime de réservation (`applyDraftScheduling`, seul chemin d'écriture du
 * flag et du lieu). Ils partent à l'ACTIVATION, pas à chaque étape : une
 * campagne en brouillon ne reçoit rien, et un rattachement rejoué à chaque
 * « Suivant » serait du bruit.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { resolveDraftOwner, useRecruiterOptions } from '@/lib/campaign/use-recruiter-options';
import {
  nextStep as apres,
  prevStep as avant,
  resumeStep,
  STEP_HEADINGS,
  validateStep,
  type AssistantStep,
} from '@/lib/campagnes/assistant-steps';
import { pushManagerAcknowledgment } from '@/lib/chat/manager-acknowledgments';
import { generateCampaignId } from '@/lib/dashboard/campaign-id';
import { cancelScheduledCampaignPush, persistCampaign } from '@/lib/db/sync/campaigns-sync';
import { deriveCampaignName } from '@/lib/campaign/derive-campaign-name';
import { useCampaignsStore } from '@/stores/campaigns-store';
import { computeIsComplete, type FDPInProgress } from '@/types/field-collection';
import type { ScoringSheet } from '@/types/scoring';

import { activateFromAssistant } from './activation';
import { AssistantBody, AssistantHeader, AssistantSaveBar } from './AssistantChrome';
import { AssistantFooter } from './AssistantFooter';
import { AssistantAlreadyLive } from './AssistantAlreadyLive';
import { AssistantLaunched } from './AssistantLaunched';
import { AssistantRail } from './AssistantRail';
import { AssistantStepBody } from './AssistantStepBody';
import { useAssistantDraft } from './useAssistantDraft';

export function CampaignAssistant({ resumeId }: { resumeId: string | null }) {
  const router = useRouter();
  const addCampaign = useCampaignsStore((s) => s.addCampaign);
  const existingIds = useCampaignsStore((s) => s.order);
  const stored = useCampaignsStore((s) => (resumeId ? (s.byId[resumeId] ?? null) : null));

  const { options: recruiterOptions, currentUserId } = useRecruiterOptions();
  const draft = useAssistantDraft({ resumeId, stored, recruiterOptions, currentUserId });
  const { facts } = draft;

  // Identifiant : celui du brouillon repris, sinon un neuf tiré une seule fois.
  const [newId] = useState(() => generateCampaignId(existingIds));
  const campaignId = resumeId ?? newId;
  /** La campagne existe-t-elle en base ? Repris ⇒ oui d'emblée. */
  const [saved, setSaved] = useState<boolean>(Boolean(resumeId));
  const [step, setStep] = useState<AssistantStep>('poste');
  const [resumed, setResumed] = useState(!resumeId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Reprise : on dépose sur la première étape encore incomplète, une fois que
  // le brouillon stocké est arrivé. Calculé PENDANT le rendu — un effet
  // laisserait voir l'étape 1 une frame avant de sauter ailleurs.
  if (!resumed && stored && draft.hydrated) {
    setResumed(true);
    setStep(resumeStep(facts));
  }

  const verdict = validateStep(step, facts);
  const dernier = step === 'recapitulatif';

  /** Construit le snapshot courant et l'écrit — le SEUL chemin d'écriture. */
  async function enregistrer(): Promise<boolean> {
    const fdp: FDPInProgress = {
      ...draft.fdp,
      campaignId,
      isComplete: computeIsComplete(draft.fdp.fields),
      isValidated: computeIsComplete(draft.fdp.fields),
    };
    const scoringSheet: ScoringSheet = {
      campaignId,
      criteria: draft.criteria,
      isValidated: draft.criteria.length > 0,
    };
    const campaign = addCampaign({
      fdp,
      name: deriveCampaignName(fdp, facts.jobTitle),
      scoringSheet,
      publishedChannels: draft.channels,
      sourcesConfirmed: draft.sources.length > 0,
      sources: draft.sources,
      thresholdLow: draft.thresholdLow,
      thresholdHigh: draft.thresholdHigh,
      ownerUserId: resolveDraftOwner(draft.ownerChoice, recruiterOptions, currentUserId),
      prefillExtraction: draft.prefillExtraction,
      // ⚠️ Brouillon UNIQUEMENT à la création. `addCampaign` laisse un statut
      // explicite écraser l'existant : le poser à chaque enregistrement ferait
      // REDESCENDRE en brouillon une campagne déjà lancée — elle cesserait
      // alors de recevoir les candidatures par mail, sans que rien ne le dise.
      status: saved ? undefined : 'draft',
    });
    cancelScheduledCampaignPush(campaign.id);
    setBusy(true);
    const outcome = await persistCampaign(campaign);
    setBusy(false);
    if (!outcome.ok) {
      setError(
        `Rien n’a été perdu : vos saisies sont là. L’enregistrement a échoué (${outcome.error}) — réessayez.`,
      );
      return false;
    }
    setError(null);
    if (!saved) {
      setSaved(true);
      pushManagerAcknowledgment({
        kind: 'campaign_created',
        campaignId,
        campaignName: campaign.name,
      });
    }
    return true;
  }

  async function onNext() {
    if (!verdict.ok) return;
    if (!(await enregistrer())) return;
    if (!dernier) {
      setStep(apres(step)!);
      return;
    }
    setBusy(true);
    const outcome = await activateFromAssistant({
      campaignId,
      mailboxIds: draft.mailboxIds,
      schedulingNative: draft.schedulingNative,
      meetingLocation: draft.meetingLocation,
    });
    setBusy(false);
    setNotice(outcome.notice);
    setLaunched(true);
  }

  // ⚠️ L'ORDRE COMPTE, et il a coûté un test rouge : activer fait passer la
  // campagne en « active » dans le store, donc la garde ci-dessous se déclenche
  // aussi. Placée avant, elle remplaçait les trois portes par « déjà lancée »
  // — au moment précis où le recruteur vient de lancer, et seulement quand il
  // était parti d'un brouillon ROUVERT. Ce qu'on vient de faire prime sur ce
  // qu'on est venu faire.
  if (launched) {
    return (
      <AssistantLaunched
        campaignId={campaignId}
        name={facts.jobTitle || campaignId}
        notice={notice}
      />
    );
  }

  // L'assistant CRÉE. Rouvrir une campagne déjà lancée n'a pas de sens ici :
  // ses réglages se modifient depuis sa fiche, où l'on voit ce qui tourne déjà.
  // On ne masque pas en silence — on dit où aller.
  if (stored && stored.status !== 'draft' && stored.status !== 'in_progress') {
    return <AssistantAlreadyLive campaignId={stored.id} name={stored.name} />;
  }

  const headings = STEP_HEADINGS[step];
  return (
    <div
      // Repère de la carte entière — les tests et les captures la désignent
      // sans avoir à deviner un ancêtre par son style.
      data-assistant={step}
      style={{
        background: 'var(--dash-surface)',
        border: '1px solid var(--dash-border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <AssistantHeader
        onClose={() => router.push('/campagnes')}
        titre={saved && facts.jobTitle ? facts.jobTitle : null}
        reference={saved ? campaignId : null}
      />
      <AssistantRail current={step} facts={facts} onGo={setStep} />
      <AssistantSaveBar campaignId={saved ? campaignId : null} />
      <AssistantBody titre={headings.titre} sousTitre={headings.sousTitre}>
        <AssistantStepBody
          step={step}
          draft={draft}
          campaignId={campaignId}
          recruiterOptions={recruiterOptions}
          currentUserId={currentUserId}
          onGo={setStep}
        />
        {error ? (
          <p role="alert" className="font-body" style={{ marginTop: 14, fontSize: 12, color: 'var(--dash-red)' }}>
            {error}
          </p>
        ) : null}
      </AssistantBody>
      <AssistantFooter
        onBack={avant(step) ? () => setStep(avant(step)!) : null}
        onNext={onNext}
        nextLabel={dernier ? 'Activer la campagne' : 'Suivant →'}
        blockedReason={verdict.ok ? null : verdict.reason}
        busy={busy}
      />
    </div>
  );
}
