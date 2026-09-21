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

import { MODELE, rempli } from './draft-defauts';

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
  // ⚠️ Réservation NATIVE par défaut : c'est le seul régime qu'on installe
  // désormais (Cal.com est en extinction). Le laisser décoché obligeait à
  // cocher à chaque campagne ce qu'on veut toujours — et une campagne créée
  // sans y penser partait sur le régime qu'on quitte.
  const [schedulingNative, setSchedulingNative] = useState(true);
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
    // ⚠️ Sur un BROUILLON, `scheduling_native` en base ne porte AUCUNE
    // intention : le flag ne voyage jamais dans un snapshot (invariant du
    // module de réservation), il n'est écrit que par le PATCH ciblé, à
    // l'activation. Une campagne pas encore lancée porte donc toujours le
    // défaut de la base — `false`. Le relire comme un choix ramenait
    // silencieusement une reprise de brouillon sur Cal.com, le régime qu'on
    // quitte. On ne redescend jamais : on garde le natif.
    if (stored.schedulingNative) setSchedulingNative(true);
    setThresholdLow(stored.thresholdLow);
    setThresholdHigh(stored.thresholdHigh);
  }

  const patchField = (key: FieldKey, value: unknown) => {
    setFdp((current) => {
      const fields = {
        ...current.fields,
        [key]: {
          ...current.fields[key]!,
          value,
          status: (rempli(value) ? 'filled' : 'empty') as 'filled' | 'empty',
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
     * Complète les champs ENCORE VIDES (proposition du modèle sur l'intitulé).
     * ⚠️ N'écrase JAMAIS une saisie : ce que le recruteur a écrit prime sur ce
     * que le modèle propose, toujours.
     */
    fillEmptyFields: (fields: Partial<Record<FieldKey, unknown>>) => {
      setFdp((current) => {
        const next = { ...current.fields };
        for (const key of Object.keys(fields) as FieldKey[]) {
          const champ = next[key];
          if (!champ || (champ.status === 'filled' && rempli(champ.value))) continue;
          const valeur = fields[key];
          if (!rempli(valeur)) continue;
          next[key] = { ...champ, value: valeur, status: 'filled' };
        }
        return { ...current, fields: next, isComplete: computeIsComplete(next) };
      });
    },
    /**
     * Reprend une campagne COMPARABLE : sa fiche, et ce qu'on a pu en lire de
     * plus (grille, canaux, flux). L'intitulé saisi PRIME sur celui de
     * l'archive — c'est lui qu'on est en train de recruter.
     */
    applyComparable: (input: {
      fdp: FDPInProgress;
      criteria?: ScoringCriterion[];
      channels?: PublicationChannel[];
      sources?: CVSource[];
    }) => {
      setFdp(input.fdp);
      if (input.criteria && input.criteria.length > 0) setCriteria(input.criteria);
      if (input.channels && input.channels.length > 0) setChannels(input.channels);
      if (input.sources && input.sources.length > 0) setSources(input.sources);
    },
    /**
     * « Repartir à zéro » — parité avec le chat Manager : une fiche préremplie
     * offre TOUJOURS une sortie pour repartir vierge. On garde l'intitulé (on
     * recrute toujours le même poste), on remet le reste à son état d'origine.
     */
    resetExceptTitle: () => {
      const titreCourant = fdp.fields.job_title?.value;
      setFdp(() => {
        const vierge = buildEmptyFDP(resumeId ?? 'CAMP-BROUILLON');
        if (!rempli(titreCourant)) return vierge;
        const fields = {
          ...vierge.fields,
          job_title: { ...vierge.fields.job_title!, value: titreCourant, status: 'filled' as const },
        };
        return { ...vierge, fields, isComplete: computeIsComplete(fields) };
      });
      setCriteria(MODELE.map((c, i) => buildCriterion({ id: `crit_${i}`, ...c })));
      setChannels([]);
      setSources(CV_SOURCES.filter((x) => CV_SOURCE_OPERATIONAL[x]));
      setPrefillExtraction(null);
    },
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
