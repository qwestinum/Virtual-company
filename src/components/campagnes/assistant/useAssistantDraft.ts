'use client';

/**
 * L'état du brouillon en cours de saisie — et sa reprise depuis la base.
 *
 * Deux sources : ce que le recruteur tape (état local) et, pour un brouillon
 * ROUVERT, ce qui est déjà enregistré. La reprise se fait UNE fois, à l'arrivée
 * de la campagne stockée : la rejouer écraserait une saisie déjà faite.
 */

import { useState } from 'react';

import type { RecruiterOption } from '@/lib/campaign/use-recruiter-options';
import { resolveDraftOwner } from '@/lib/campaign/use-recruiter-options';
import type { AssistantFacts } from '@/lib/campagnes/assistant-steps';
import { isMeetingLocationComplete, type MeetingLocation } from '@/lib/scheduling';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import type { CampaignPrefill } from '@/types/campaign-prefill';
import { CV_SOURCE_OPERATIONAL, CV_SOURCES, type CVSource } from '@/types/cv-source';
import type { PublicationChannel } from '@/types/publication-channel';
import {
  buildEmptyFDP,
  computeIsComplete,
  FIELD_KEYS,
  FIELD_LABELS,
  type FDPInProgress,
  type FieldKey,
} from '@/types/field-collection';
import {
  buildCriterion,
  countUntreatedSuggestions,
  type ScoringCriterion,
} from '@/types/scoring';

/** Grille de départ d'une campagne neuve — la même qu'à la création historique. */
const MODELE: Omit<ScoringCriterion, 'id'>[] = [
  { label: 'Expérience pertinente sur le poste', level: 'critique', weight: 8 },
  { label: 'Compétences techniques clés', level: 'tres_important', weight: 6 },
  { label: 'Localisation / mobilité', level: 'important', weight: 4 },
];

export type AssistantDraft = ReturnType<typeof useAssistantDraft>;

export function useAssistantDraft({
  resumeId,
  stored,
  recruiterOptions,
  currentUserId,
}: {
  resumeId: string | null;
  stored: ActiveCampaign | null;
  recruiterOptions: RecruiterOption[] | null;
  currentUserId: string | null;
}) {
  const [fdp, setFdp] = useState<FDPInProgress>(() =>
    buildEmptyFDP(resumeId ?? 'CAMP-BROUILLON'),
  );
  const [criteria, setCriteria] = useState<ScoringCriterion[]>(() =>
    MODELE.map((c, i) => buildCriterion({ id: `crit_${i}`, ...c })),
  );
  const [channels, setChannels] = useState<PublicationChannel[]>([]);
  // ⚠️ Cochés D'EMBLÉE : ce sont les trois seules façons de recevoir des
  // candidatures qui marchent, et les trois sont souhaitables par défaut.
  // Partir de zéro obligeait à re-cocher à chaque campagne ce qu'on veut
  // toujours. Un brouillon ROUVERT garde ses propres choix (l'hydratation
  // écrase ce défaut).
  const [sources, setSources] = useState<CVSource[]>(() =>
    CV_SOURCES.filter((s) => CV_SOURCE_OPERATIONAL[s]),
  );
  const [mailboxIds, setMailboxIds] = useState<string[]>([]);
  const [ownerChoice, setOwnerChoice] = useState<string | null | undefined>(undefined);
  const [schedulingNative, setSchedulingNative] = useState(false);
  const [meetingLocation, setMeetingLocation] = useState<MeetingLocation | null>(null);
  const [thresholdLow, setThresholdLow] = useState(10);
  const [thresholdHigh, setThresholdHigh] = useState(90);
  const [hydratedFrom, setHydratedFrom] = useState<string | null>(null);
  /** Archive de traçabilité du pré-remplissage par document (null si saisie). */
  const [prefillExtraction, setPrefillExtraction] = useState<CampaignPrefill | null>(null);

  // Reprise d'un brouillon : UNE fois, quand la campagne arrive du store.
  // Pendant le rendu, pas dans un effet — un effet laisserait voir un écran
  // vide avant de le remplir.
  if (stored && hydratedFrom !== stored.id) {
    setHydratedFrom(stored.id);
    setFdp(stored.fdp);
    if (stored.scoringSheet) setCriteria(stored.scoringSheet.criteria);
    setChannels(stored.publishedChannels);
    setSources(stored.sources);
    setOwnerChoice(stored.ownerUserId);
    setSchedulingNative(stored.schedulingNative);
    setThresholdLow(stored.thresholdLow);
    setThresholdHigh(stored.thresholdHigh);
  }

  const patchField = (key: FieldKey, value: unknown) => {
    setFdp((current) => {
      const rempli = value != null && value !== '' && !(Array.isArray(value) && value.length === 0);
      const fields = {
        ...current.fields,
        [key]: {
          ...current.fields[key]!,
          value,
          status: (rempli ? 'filled' : 'empty') as 'filled' | 'empty',
        },
      };
      return { ...current, fields, isComplete: computeIsComplete(fields) };
    });
  };

  const owner = resolveDraftOwner(ownerChoice, recruiterOptions, currentUserId);
  const ownerOption = recruiterOptions?.find((o) => o.id === owner) ?? null;
  const titre = String(fdp.fields.job_title?.value ?? '').trim();

  const facts: AssistantFacts = {
    jobTitle: titre,
    missingFdpLabels: FIELD_KEYS.filter(
      (k) => fdp.fields[k]?.required !== false && fdp.fields[k]?.status !== 'filled',
    ).map((k) => FIELD_LABELS[k]),
    criteriaCount: criteria.length,
    untreatedSuggestions: countUntreatedSuggestions({ campaignId: '', criteria, isValidated: false }),
    sourceCount: sources.length,
    emailSource: sources.includes('email'),
    mailboxCount: mailboxIds.length,
    thresholdLow,
    thresholdHigh,
    schedulingNative,
    // `null` quand on ne sait pas (liste pas chargée, module injoignable) : une
    // ignorance ne bloque jamais quelqu'un qui avance.
    ownerHasAvailability: ownerOption ? (ownerOption.hasAvailability ?? null) : null,
    meetingLocationComplete:
      meetingLocation === null || isMeetingLocationComplete(meetingLocation),
  };

  return {
    prefillExtraction,
    /**
     * Pré-remplissage par document : il POSE le brouillon, il n'enregistre
     * rien. Les pondérations arrivent marquées « suggéré par l'IA » ; une
     * extraction sans aucun critère laisse la grille par défaut plutôt qu'un
     * écran vide.
     */
    applyPrefill: (input: {
      fdp: FDPInProgress;
      criteria: ScoringCriterion[];
      extraction: CampaignPrefill;
    }) => {
      setFdp(input.fdp);
      if (input.criteria.length > 0) setCriteria(input.criteria);
      setPrefillExtraction(input.extraction);
    },
    /**
     * Le brouillon rouvert est-il RÉELLEMENT chargé ?
     *
     * ⚠️ Sans ce drapeau, l'appelant décide de l'étape de reprise sur l'état
     * d'AVANT l'hydratation (React relance le rendu après une écriture d'état
     * en phase de rendu, mais la passe en cours voit encore l'ancien) : il
     * concluait « tout est vide » et déposait sur la première étape. Défaut
     * attrapé par S30.5.
     */
    hydrated: stored === null || hydratedFrom === stored.id,
    fdp,
    patchField,
    criteria,
    setCriteria,
    channels,
    setChannels,
    sources,
    setSources,
    mailboxIds,
    setMailboxIds,
    ownerChoice,
    setOwnerChoice,
    owner,
    ownerOption,
    schedulingNative,
    setSchedulingNative,
    meetingLocation,
    setMeetingLocation,
    thresholdLow,
    thresholdHigh,
    setThresholds: (low: number, high: number) => {
      setThresholdLow(low);
      setThresholdHigh(high);
    },
    facts,
  };
}
