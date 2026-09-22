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

import { useRecruiterOptions } from '@/lib/campaign/use-recruiter-options';
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
import { useCampaignsStore } from '@/stores/campaigns-store';

import { activateFromAssistant } from './activation';
import { enregistrerBrouillon } from './persist';
import { AssistantBody, AssistantHeader, AssistantSaveBar } from './AssistantChrome';
import { AssistantFooter } from './AssistantFooter';
import { AssistantAlreadyLive } from './AssistantAlreadyLive';
import { AssistantLaunched } from './AssistantLaunched';
import { AssistantLeaveDialog } from './AssistantLeaveDialog';
import { AssistantRail } from './AssistantRail';
import { AssistantStepBody } from './AssistantStepBody';
import { useAssistantDraft } from './useAssistantDraft';
import { useScrollToTopOnStep } from './useScrollToTopOnStep';

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
  /** « Fermer » demande AVANT de fermer : on ne quitte pas une saisie en silence. */
  const [quitting, setQuitting] = useState(false);
  /** Document en cours de lecture : « Suivant » attend, et le dit. */
  const [reading, setReading] = useState<string | null>(null);

  const carte = useScrollToTopOnStep<HTMLDivElement>(step);

  // Reprise : on dépose sur la première étape encore incomplète, une fois que
  // le brouillon stocké est arrivé. Calculé PENDANT le rendu — un effet
  // laisserait voir l'étape 1 une frame avant de sauter ailleurs.
  if (!resumed && stored && draft.hydrated) {
    setResumed(true);
    setStep(resumeStep(facts));
  }

  const verdict = reading
    ? ({ ok: false, reason: 'Lecture du document en cours…' } as const)
    : validateStep(step, facts);
  const dernier = step === 'recapitulatif';

  async function onNext() {
    if (!verdict.ok) return;
    setBusy(true);
    const ecrit = await enregistrerBrouillon({
      campaignId,
      draft,
      recruiterOptions,
      currentUserId,
      addCampaign,
      existe: saved,
    });
    setBusy(false);
    if (!ecrit.ok) {
      setError(ecrit.message);
      return;
    }
    setError(null);
    if (!saved) {
      setSaved(true);
      pushManagerAcknowledgment({
        kind: 'campaign_created',
        campaignId,
        campaignName: ecrit.name,
      });
    }
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
      ref={carte}
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
        onClose={() => setQuitting(true)}
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
          reading={reading}
          onReadingChange={setReading}
        />
        {error ? (
          <p role="alert" className="font-body" style={{ marginTop: 14, fontSize: 12, color: 'var(--dash-red)' }}>
            {error}
          </p>
        ) : null}
      </AssistantBody>
      {quitting ? (
        <AssistantLeaveDialog
          campaignId={saved ? campaignId : null}
          onStay={() => setQuitting(false)}
          onLeave={() => router.push('/campagnes')}
        />
      ) : null}
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
