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
import { CV_SOURCE_LABELS, CV_SOURCE_OPERATIONAL, CV_SOURCES } from '@/types/cv-source';
import {
  PUBLICATION_CHANNEL_LABELS,
  PUBLICATION_CHANNEL_ORDER,
  type PublicationChannel,
} from '@/types/publication-channel';

/**
 * ⚠️ On ne propose à la CRÉATION que ce qui fonctionne vraiment. Un flux inerte
 * offert à quelqu'un qui monte sa campagne, c'est lui promettre des
 * candidatures qui n'arriveront pas. La liste vient de `CV_SOURCE_OPERATIONAL`
 * et non d'une copie : le jour où un flux devient opérationnel, il apparaît
 * ici sans qu'on y touche.
 */
const FLUX_OFFERTS = CV_SOURCES.filter((s) => CV_SOURCE_OPERATIONAL[s]);

/** Les deux canaux réellement diffusables aujourd'hui. */
const CANAUX_ACTIFS: readonly PublicationChannel[] = ['apec', 'generic'];
/**
 * LinkedIn est RETIRÉ de la création (rien ne le publie), les autres sont
 * montrés avec « bientôt » : masquer une destination qu'on prépare laisserait
 * croire qu'elle n'existera jamais.
 */
const CANAUX_OFFERTS = PUBLICATION_CHANNEL_ORDER.filter((c) => c !== 'linkedin');
const CANAUX_BIENTOT = CANAUX_OFFERTS.filter((c) => !CANAUX_ACTIFS.includes(c));

import { FDPInlineEditor } from '../edit/FDPInlineEditor';
import { ChannelsDraftEditor } from '../edit/draft/ChannelsDraftEditor';
import { FluxDraftEditor } from '../edit/draft/FluxDraftEditor';
import { OwnerDraftEditor } from '../edit/draft/OwnerDraftEditor';
import { SchedulingDraftEditor } from '../edit/draft/SchedulingDraftEditor';
import { ScoringDraftEditor } from '../edit/draft/ScoringDraftEditor';
import { ThresholdDraftEditor } from '../edit/draft/ThresholdDraftEditor';
import { AssistantDocumentStart } from './AssistantDocumentStart';
import { AssistantRecap, buildRecapLines } from './AssistantRecap';
import type { AssistantDraft } from './useAssistantDraft';

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="font-body"
      style={{ fontSize: 12, color: 'var(--dash-text-secondary)', marginTop: 14, lineHeight: 1.5 }}
    >
      {children}
    </p>
  );
}

/**
 * Une PARTIE d'étape : un titre, un sous-titre, un contenu. `accent` marque
 * celle qui engage quelque chose — deux parties de même poids se lisent comme
 * une seule.
 */
function Partie({
  titre,
  sousTitre,
  accent,
  children,
}: {
  titre: string;
  sousTitre: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        marginBottom: 18,
        padding: accent ? '16px 16px 14px' : '2px 0 0',
        borderRadius: accent ? 12 : 0,
        border: accent ? '1px solid var(--dash-purple)' : 'none',
        background: accent ? 'var(--dash-purple-light)' : 'transparent',
      }}
    >
      <h3
        className="font-display"
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: accent ? 'var(--dash-purple)' : 'var(--dash-text-secondary)',
          margin: 0,
        }}
      >
        {titre}
      </h3>
      <p
        className="font-body"
        style={{
          fontSize: 12,
          color: 'var(--dash-text-secondary)',
          margin: '3px 0 10px',
        }}
      >
        {sousTitre}
      </p>
      {children}
    </section>
  );
}

function SousTitre({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="font-display"
      style={{ fontSize: 13, fontWeight: 700, color: 'var(--dash-text)', margin: '18px 0 8px' }}
    >
      {children}
    </h3>
  );
}

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
          {/* ⚠️ EN TÊTE, avant les champs : déposer un appel d'offres change
              TOUT l'écran d'un coup. Proposé après huit champs, on l'aurait vu
              une fois la saisie faite — c'est-à-dire trop tard. */}
          <AssistantDocumentStart campaignId={campaignId} onPrefill={draft.applyPrefill} />
          <div style={{ height: 18 }} />
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
