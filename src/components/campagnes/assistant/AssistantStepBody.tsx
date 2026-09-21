'use client';

/**
 * Le CORPS de chaque étape — et rien d'autre : l'assistant ne réinvente aucun
 * éditeur, il remonte ceux qui existent déjà (`FDPInlineEditor`,
 * `ScoringDraftEditor`, `ChannelsDraftEditor`, `FluxDraftEditor`,
 * `OwnerDraftEditor`, `ThresholdDraftEditor`, `SchedulingDraftEditor`).
 *
 * Deux versions d'un même éditeur finiraient par diverger, et la divergence
 * serait silencieuse : on changerait le barème ici sans le changer là.
 */

import type { RecruiterOption } from '@/lib/campaign/use-recruiter-options';
import type { AssistantStep } from '@/lib/campagnes/assistant-steps';
import { CV_SOURCE_LABELS } from '@/types/cv-source';
import { PUBLICATION_CHANNEL_LABELS } from '@/types/publication-channel';


import { FDPInlineEditor } from '../edit/FDPInlineEditor';
import { ChannelsDraftEditor } from '../edit/draft/ChannelsDraftEditor';
import { FluxDraftEditor } from '../edit/draft/FluxDraftEditor';
import { OwnerDraftEditor } from '../edit/draft/OwnerDraftEditor';
import { SchedulingDraftEditor } from '../edit/draft/SchedulingDraftEditor';
import { ScoringDraftEditor } from '../edit/draft/ScoringDraftEditor';
import { ThresholdDraftEditor } from '../edit/draft/ThresholdDraftEditor';
import { AssistantProposeGrid } from './AssistantProposeGrid';
import { CANAUX_BIENTOT, CANAUX_OFFERTS, FLUX_OFFERTS } from './assistant-offres';
import { Note, Partie, SousTitre } from './AssistantStepParts';
import { AssistantStart } from './AssistantStart';
import { AssistantRecap, buildRecapLines } from './AssistantRecap';
import type { AssistantDraft } from './useAssistantDraft';

export function AssistantStepBody({
  step,
  draft,
  campaignId,
  recruiterOptions,
  onGo,
}: {
  step: AssistantStep;
  draft: AssistantDraft;
  campaignId: string;
  recruiterOptions: RecruiterOption[] | null;
  currentUserId: string | null;
  onGo: (step: AssistantStep) => void;
}) {
  switch (step) {
    case 'poste':
      return (
        <>
          {/* ⚠️ EN TÊTE, avant les champs : ces trois raccourcis changent TOUT
              l'écran d'un coup. Proposés après huit champs, on les aurait vus
              une fois la saisie faite — c'est-à-dire trop tard. */}
          <AssistantStart
            campaignId={campaignId}
            fdp={draft.fdp}
            jobTitle={draft.facts.jobTitle}
            onPrefill={draft.applyPrefill}
            onFillEmpty={draft.fillEmptyFields}
            onComparable={draft.applyComparable}
            onReset={draft.resetExceptTitle}
            prefilled={draft.prefillExtraction !== null || draft.facts.missingFdpLabels.length < 7}
          />
          <FDPInlineEditor fdp={draft.fdp} onPatch={draft.patchField} />
          <Note>
            Le nom de la campagne suit l’intitulé : une seule source de vérité,
            jamais deux champs à tenir d’accord.
          </Note>
        </>
      );

    case 'criteres':
      return (
        <>
          <AssistantProposeGrid fdp={draft.fdp} onPropose={draft.setCriteria} />
          <ScoringDraftEditor criteria={draft.criteria} onChange={draft.setCriteria} />
          <Note>
            Une pondération proposée par l’IA se confirme ou s’écarte — elle ne
            part jamais en l’état.
          </Note>
        </>
      );

    case 'reception':
      return (
        <>
          <SousTitre>Comment les candidatures vous parviennent</SousTitre>
          <FluxDraftEditor
            sources={FLUX_OFFERTS}
            selected={draft.sources}
            onChange={draft.setSources}
            mailboxIds={draft.mailboxIds}
            onMailboxesChange={draft.setMailboxIds}
          />
          <SousTitre>Où l’offre est diffusée</SousTitre>
          <ChannelsDraftEditor
            selected={draft.channels}
            onChange={draft.setChannels}
            channels={CANAUX_OFFERTS}
            comingSoon={CANAUX_BIENTOT}
          />
          <Note>
            Le texte des canaux s’écrit <strong>après le lancement</strong> : une
            offre en ligne fait arriver de vraies candidatures, et le chemin email
            ne traite que celles d’une campagne active. La référence{' '}
            <strong>{campaignId}</strong> voyagera dans l’objet des mails — c’est
            elle qui rattache une candidature à cette campagne.
          </Note>
        </>
      );

    case 'suivi':
      // DEUX sujets, et ils ne pèsent pas pareil : choisir un référent est un
      // réglage d'annuaire, régler ce qu'ORQA décide seul engage des envois.
      // Le premier reste sobre, le second porte la couleur — sinon l'œil les
      // lit comme une seule liste de champs.
      return (
        <>
          <Partie
            titre="Qui suit ce recrutement ?"
            sousTitre="Le référent reçoit les entretiens sur son agenda."
          >
            <OwnerDraftEditor
              value={draft.owner}
              onChange={draft.setOwnerChoice}
              options={recruiterOptions}
            />
          </Partie>
          <Partie
            titre="Comment les candidatures sont triées à l’arrivée"
            sousTitre="Selon la note obtenue, ORQA vous propose de l’écarter, vous laisse décider, ou invite à choisir un créneau."
            accent
          >
            <ThresholdDraftEditor
              low={draft.thresholdLow}
              high={draft.thresholdHigh}
              onChange={draft.setThresholds}
            />
          </Partie>
        </>
      );

    case 'reservation':
      return (
        <SchedulingDraftEditor
          native={draft.schedulingNative}
          onNativeChange={draft.setSchedulingNative}
          location={draft.meetingLocation}
          onLocationChange={draft.setMeetingLocation}
          owner={draft.ownerOption}
        />
      );

    case 'recapitulatif':
      return (
        <>
          <AssistantRecap
            lines={buildRecapLines({
              fdp: draft.fdp,
              criteriaCount: draft.criteria.length,
              criticalCount: draft.criteria.filter((c) => c.level === 'critique').length,
              channelLabels: draft.channels.map((c) => PUBLICATION_CHANNEL_LABELS[c]),
              sourceLabels: draft.sources.map((s) => CV_SOURCE_LABELS[s]),
              ownerLabel: draft.ownerOption?.displayName ?? 'Aucun référent',
              thresholdLow: draft.thresholdLow,
              thresholdHigh: draft.thresholdHigh,
              schedulingLabel: draft.schedulingNative
                ? `Disponibilités de ${draft.ownerOption?.displayName ?? 'le référent'}`
                : 'Lien Cal.com',
            })}
            onGo={onGo}
          />
          <Note>
            Le lancement ouvre la diffusion et la présélection du vivier : c’est à
            partir de là que des candidatures peuvent arriver.
          </Note>
        </>
      );
  }
}
