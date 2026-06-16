'use client';

/**
 * Sheet de création d'une campagne en 2 étapes (Session 6 v3).
 *
 * Étape 1 — saisie du nom du poste uniquement. Le Manager (côté UI)
 * lance une pré-recherche L1 sur les FDPs archivées via
 * `/api/fdps/search`. Deux cas :
 *
 *   - Aucun hit : on bascule en édition normale avec une FDP vierge
 *     préfixée du poste saisi.
 *   - Un hit (le plus récent) : on regarde dans `campaigns-store` si la
 *     campagne d'origine est encore présente. Si oui, on pré-remplit
 *     scoring / canaux / flux / seuil depuis elle ; sinon on se
 *     contente de pré-remplir la FDP. Une bannière explique au DRH ce
 *     qui s'est passé et qu'il peut modifier librement.
 *
 * Étape 2 — édition complète des 4 blocs (FDP, Scoring, Canaux, Flux,
 * Seuil) puis « Créer la campagne ».
 */

import { useEffect, useRef, useState } from 'react';

import { canActivate } from '@/lib/campaign/lifecycle';
import { formatMissingPhases } from '@/lib/campaign/phase-labels';
import { postFdpProposal, postManagerScoring } from '@/lib/chat/api-client';
import { pushManagerAcknowledgment } from '@/lib/chat/manager-acknowledgments';
import { generateCampaignId } from '@/lib/dashboard/campaign-id';
import {
  cancelScheduledCampaignPush,
  persistCampaign,
} from '@/lib/db/sync/campaigns-sync';
import type { JobDescription } from '@/lib/storage/job-descriptions';
import {
  useCampaignsStore,
  type ActiveCampaign,
} from '@/stores/campaigns-store';
import type { CVSource } from '@/types/cv-source';
import {
  buildEmptyFDP,
  computeIsComplete,
  type FDPInProgress,
  type FieldKey,
} from '@/types/field-collection';
import type { PublicationChannel } from '@/types/publication-channel';
import {
  buildCriterion,
  type ScoringCriterion,
  type ScoringSheet,
} from '@/types/scoring';

import { ChannelsDraftEditor } from './draft/ChannelsDraftEditor';
import { FluxDraftEditor } from './draft/FluxDraftEditor';
import { ScoringDraftEditor } from './draft/ScoringDraftEditor';
import { ThresholdDraftEditor } from './draft/ThresholdDraftEditor';
import { FDPInlineEditor } from './FDPInlineEditor';

export type CampaignCreateSheetProps = {
  onClose: () => void;
};

const DEFAULT_SCORING_TEMPLATE: Omit<ScoringCriterion, 'id'>[] = [
  { label: 'Expérience pertinente sur le poste', level: 'critique', weight: 8 },
  { label: 'Compétences techniques clés', level: 'tres_important', weight: 6 },
  { label: 'Localisation / mobilité', level: 'important', weight: 4 },
];

type Stage = 'job_title' | 'editing';

export function CampaignCreateSheet({ onClose }: CampaignCreateSheetProps) {
  const addCampaign = useCampaignsStore((s) => s.addCampaign);
  const removeCampaign = useCampaignsStore((s) => s.removeCampaign);
  const activateCampaign = useCampaignsStore((s) => s.activateCampaign);
  const existingIds = useCampaignsStore((s) => s.order);
  const getCampaignById = useCampaignsStore((s) => s.getById);

  const [campaignId] = useState(() => generateCampaignId(existingIds));
  const [stage, setStage] = useState<Stage>('job_title');
  const [jobTitle, setJobTitle] = useState('');
  const [searching, setSearching] = useState(false);
  const [matchHint, setMatchHint] = useState<{
    sourceId: string;
    sourceName: string;
    copiedScoring: boolean;
    copiedChannels: boolean;
    copiedFlux: boolean;
  } | null>(null);

  const [fdp, setFdp] = useState<FDPInProgress>(() =>
    buildEmptyFDP(campaignId),
  );
  const [criteria, setCriteria] = useState<ScoringCriterion[]>(() =>
    DEFAULT_SCORING_TEMPLATE.map((c, i) =>
      buildCriterion({ id: `crit_${i}`, ...c }),
    ),
  );
  const [channels, setChannels] = useState<PublicationChannel[]>([]);
  // Aucun flux par défaut : le DRH active explicitement ses sources de réception
  // (cohérent avec le reste — pas de « manuel » implicite).
  const [sources, setSources] = useState<CVSource[]>([]);
  const [mailboxIds, setMailboxIds] = useState<string[]>([]);
  const [threshold, setThreshold] = useState(75);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Persistance en cours : verrouille le bouton et affiche « Enregistrement… ».
  // La création n'est déclarée réussie qu'APRÈS confirmation serveur.
  const [submitting, setSubmitting] = useState(false);
  // Étape post-création : la campagne est enregistrée (en brouillon) et on
  // propose de l'activer. `created` porte le snapshot renvoyé par addCampaign.
  const [created, setCreated] = useState<ActiveCampaign | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);
  const createdOnceRef = useRef(false);
  // Proposition par l'IA (parité avec le chat Manager) — opt-in par bouton.
  const [proposingFdp, setProposingFdp] = useState(false);
  const [proposingScoring, setProposingScoring] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const patchField = (key: FieldKey, value: unknown) => {
    setFdp((current) => {
      const filled = isFilled(value);
      const nextFields = {
        ...current.fields,
        [key]: {
          ...current.fields[key]!,
          value,
          status: (filled ? 'filled' : 'empty') as 'filled' | 'empty',
        },
      };
      return {
        ...current,
        fields: nextFields,
        isComplete: computeIsComplete(nextFields),
      };
    });
  };

  const onContinue = async () => {
    const title = jobTitle.trim();
    if (!title) return;
    setSearching(true);
    // Initialise toujours la FDP avec l'intitulé saisi.
    setFdp((current) => {
      const next = {
        ...current.fields,
        job_title: {
          ...current.fields.job_title!,
          value: title,
          status: 'filled' as const,
        },
      };
      return {
        ...current,
        fields: next,
        isComplete: computeIsComplete(next),
      };
    });

    let hit: JobDescription | null = null;
    try {
      const res = await fetch(
        `/api/fdps/search?q=${encodeURIComponent(title)}`,
        { cache: 'no-store' },
      );
      if (res.ok) {
        const json = (await res.json()) as { hits?: JobDescription[] };
        hit = json.hits?.[0] ?? null;
      }
    } catch {
      // Mode offline / Supabase absent → on bascule sans pré-remplissage.
    }

    if (hit) {
      // Reprend les fields de la FDP archivée (sauf campaignId qui reste
      // celui de la nouvelle campagne).
      setFdp((current) => {
        const merged = { ...current.fields };
        for (const key of Object.keys(hit!.fdp.fields)) {
          const incoming = hit!.fdp.fields[key as FieldKey];
          if (!incoming) continue;
          merged[key as FieldKey] = {
            ...incoming,
            // L'intitulé saisi en étape 1 prime sur celui archivé.
            value:
              key === 'job_title' ? title : incoming.value,
            status: incoming.value != null ? 'filled' : 'empty',
          };
        }
        return {
          ...current,
          fields: merged,
          isComplete: computeIsComplete(merged),
        };
      });

      // Si la campagne d'origine est encore dans le store, on copie les
      // autres réglages. Sinon on se contente de la FDP.
      const sourceCamp = getCampaignById(hit.id);
      const copiedScoring =
        sourceCamp?.scoringSheet?.criteria != null &&
        sourceCamp.scoringSheet.criteria.length > 0;
      const copiedChannels =
        sourceCamp != null && sourceCamp.publishedChannels.length > 0;
      const copiedFlux =
        sourceCamp != null && sourceCamp.sources.length > 0;

      if (sourceCamp) {
        if (copiedScoring) {
          setCriteria(
            sourceCamp.scoringSheet!.criteria.map((c) => ({ ...c })),
          );
        }
        if (copiedChannels) setChannels([...sourceCamp.publishedChannels]);
        if (copiedFlux) setSources([...sourceCamp.sources]);
        setThreshold(sourceCamp.threshold);
      }
      setMatchHint({
        sourceId: hit.id,
        sourceName: sourceCamp?.name ?? hit.title,
        copiedScoring,
        copiedChannels,
        copiedFlux,
      });
    } else {
      setMatchHint(null);
    }

    setStage('editing');
    setSearching(false);
  };

  // Propose une fiche de poste de départ via l'IA et l'applique aux SEULS champs
  // vides (préserve ce que le DRH a déjà saisi). Dégradation douce en cas d'échec.
  const onProposeFdp = async () => {
    const title =
      jobTitle.trim() ||
      (typeof fdp.fields.job_title?.value === 'string'
        ? (fdp.fields.job_title.value as string).trim()
        : '');
    if (!title) return;
    setProposingFdp(true);
    setProposeError(null);
    try {
      const { fields } = await postFdpProposal({
        jobTitle: title,
        known: collectKnown(fdp),
      });
      setFdp((current) => {
        const next = { ...current.fields };
        for (const key of Object.keys(fields) as FieldKey[]) {
          const field = next[key];
          if (!field) continue;
          // N'écrase jamais un champ déjà rempli par le DRH.
          if (field.status === 'filled' && isFilled(field.value)) continue;
          const value = fields[key];
          if (!isFilled(value)) continue;
          next[key] = { ...field, value, status: 'filled' };
        }
        return {
          ...current,
          fields: next,
          isComplete: computeIsComplete(next),
        };
      });
    } catch {
      setProposeError(
        'Proposition indisponible (service IA non configuré ou erreur). Vous pouvez saisir les champs manuellement.',
      );
    } finally {
      setProposingFdp(false);
    }
  };

  // Propose une grille de scoring à partir de la fiche courante (réutilise le
  // mécanisme du chat). Remplace les critères placeholders.
  const onProposeScoring = async () => {
    setProposingScoring(true);
    setProposeError(null);
    try {
      const { criteria: proposed } = await postManagerScoring({ fdp });
      if (proposed.length > 0) setCriteria(proposed);
    } catch {
      setProposeError(
        'Proposition de grille indisponible (service IA non configuré ou erreur). Vous pouvez éditer la grille manuellement.',
      );
    } finally {
      setProposingScoring(false);
    }
  };

  const onSubmit = async () => {
    // Validation : flux email exige au moins une mailbox.
    if (sources.includes('email') && mailboxIds.length === 0) {
      setSubmitError(
        'Le flux email exige au moins une boîte mail associée. Sélectionnez-en une ou désactivez le flux.',
      );
      return;
    }
    setSubmitError(null);
    const inferredName =
      jobTitle.trim() ||
      (typeof fdp.fields.job_title?.value === 'string'
        ? (fdp.fields.job_title.value as string).trim()
        : '') ||
      'Nouvelle campagne';
    const isComplete = computeIsComplete(fdp.fields);
    const finalFdp: FDPInProgress = {
      ...fdp,
      isComplete,
      isValidated: isComplete,
    };
    const scoringSheet: ScoringSheet = {
      campaignId,
      criteria,
      isValidated: criteria.length > 0,
    };
    // Création en BROUILLON : une campagne neuve n'est jamais activée d'office
    // (il manque souvent un flux de réception). On enregistre puis on propose
    // l'activation à l'étape suivante.
    const campaign = addCampaign({
      fdp: finalFdp,
      name: inferredName,
      scoringSheet,
      publishedChannels: channels,
      // L'intake est confirmé d'après les SOURCES de réception choisies (submit
      // délibéré du formulaire), jamais d'après les canaux de DIFFUSION.
      sourcesConfirmed: sources.length > 0,
      sources,
      threshold,
      status: isComplete ? 'in_progress' : 'draft',
    });

    // PERSISTANCE CONFIRMÉE (zéro perte silencieuse). On a écrit la campagne
    // dans le store local (optimiste, pour la réactivité), mais on ne déclare
    // PAS le succès tant que Supabase n'a pas confirmé. On reprend la main sur
    // la persistance : on annule le push de fond debouncé (sinon il rejouerait
    // le PUT après un éventuel rollback) et on attend la confirmation.
    cancelScheduledCampaignPush(campaign.id);
    setSubmitting(true);
    const outcome = await persistCampaign(campaign);
    setSubmitting(false);
    if (!outcome.ok) {
      // Échec DUR : on annule l'entrée locale (pas de fantôme qui paraît
      // sauvegardé et disparaît au reload) et on laisse l'utilisateur réessayer
      // sans rien ressaisir (l'état du formulaire est intact).
      removeCampaign(campaign.id);
      setSubmitError(
        `La campagne n'a pas pu être enregistrée (${outcome.error}). ` +
          `Rien n'a été perdu : vos saisies sont conservées, réessayez.`,
      );
      return;
    }

    // Confirmé (persisté, ou 503 démo volatile assumée) : on peut prendre acte
    // et enchaîner les effets de bord best-effort.
    if (!createdOnceRef.current) {
      createdOnceRef.current = true;
      pushManagerAcknowledgment({
        kind: 'campaign_created',
        campaignId,
        campaignName: inferredName,
      });
    }
    // Associe les mailboxes en parallèle après la création — best-effort.
    if (mailboxIds.length > 0) {
      await Promise.all(
        mailboxIds.map((mid) =>
          fetch(`/api/mailboxes/${encodeURIComponent(mid)}/associate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ campaignId }),
          }).catch(() => null),
        ),
      );
    }
    setActivateError(null);
    setCreated(campaign);
  };

  // Active la campagne enregistrée (verrou `canActivate` côté store). Succès →
  // prise d'acte « lancée » + fermeture. Échec → message (ne devrait pas arriver
  // tant que le bouton n'est proposé que lorsque l'activation est permise).
  const onActivate = () => {
    if (!created) return;
    const ok = activateCampaign(created.id);
    if (ok) {
      pushManagerAcknowledgment({
        kind: 'campaign_activated',
        campaignId: created.id,
        campaignName: created.name,
      });
      onClose();
    } else {
      setActivateError(
        'Activation impossible pour le moment — complétez les éléments requis puis réessayez.',
      );
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Créer une nouvelle campagne"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(2px)',
          border: 'none',
          cursor: 'pointer',
        }}
      />
      <aside
        style={{
          position: 'relative',
          width: 'min(640px, 100%)',
          height: '100%',
          background: 'var(--dash-surface)',
          boxShadow: '-20px 0 40px rgba(0,0,0,0.15)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Header campaignId={campaignId} onClose={onClose} />
        {created ? (
          <CreatedStep
            campaign={created}
            activateError={activateError}
            onActivate={onActivate}
            onEdit={() => {
              setActivateError(null);
              setCreated(null);
            }}
            onClose={onClose}
          />
        ) : stage === 'job_title' ? (
          <JobTitleStep
            title={jobTitle}
            onChange={setJobTitle}
            onContinue={onContinue}
            searching={searching}
          />
        ) : (
          <EditingStage
            jobTitle={jobTitle}
            matchHint={matchHint}
            fdp={fdp}
            patchField={patchField}
            onProposeFdp={onProposeFdp}
            proposingFdp={proposingFdp}
            onProposeScoring={onProposeScoring}
            proposingScoring={proposingScoring}
            proposeError={proposeError}
            criteria={criteria}
            setCriteria={setCriteria}
            channels={channels}
            setChannels={setChannels}
            sources={sources}
            setSources={setSources}
            mailboxIds={mailboxIds}
            setMailboxIds={setMailboxIds}
            threshold={threshold}
            setThreshold={setThreshold}
            submitError={submitError}
            submitting={submitting}
            onCancel={onClose}
            onSubmit={onSubmit}
          />
        )}
      </aside>
    </div>
  );
}

function Header({
  campaignId,
  onClose,
}: {
  campaignId: string;
  onClose: () => void;
}) {
  return (
    <header
      style={{
        padding: '20px 22px 14px',
        borderBottom: '1px solid var(--dash-border)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <div>
        <h2
          className="font-display"
          style={{
            fontSize: 19,
            fontWeight: 800,
            margin: '0 0 4px',
            color: 'var(--dash-text)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span
            className="font-data"
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--dash-text-tertiary)',
              background: 'var(--dash-hover)',
              padding: '2px 8px',
              borderRadius: 6,
              letterSpacing: '0.04em',
            }}
          >
            {campaignId}
          </span>
          Nouvelle campagne
        </h2>
        <p
          className="font-body"
          style={{
            fontSize: 12,
            color: 'var(--dash-text-secondary)',
            margin: 0,
          }}
        >
          Saisissez d&apos;abord le poste — on regarde s&apos;il existe une
          campagne comparable à reprendre.
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: 22,
          color: 'var(--dash-text-tertiary)',
          padding: 4,
        }}
      >
        ×
      </button>
    </header>
  );
}

function JobTitleStep({
  title,
  onChange,
  onContinue,
  searching,
}: {
  title: string;
  onChange: (v: string) => void;
  onContinue: () => void;
  searching: boolean;
}) {
  const canContinue = title.trim().length > 0 && !searching;
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: '24px 22px',
      }}
    >
      <SectionTitle icon="📌">Poste à pourvoir</SectionTitle>
      <input
        type="text"
        value={title}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder="ex. Développeur Backend Senior"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canContinue) onContinue();
        }}
        className="font-body"
        style={{
          padding: '12px 14px',
          borderRadius: 10,
          border: '1px solid var(--dash-border-strong)',
          background: 'var(--dash-warm)',
          fontSize: 14,
          color: 'var(--dash-text)',
          outline: 'none',
        }}
      />
      <p
        className="font-body"
        style={{
          fontSize: 12,
          color: 'var(--dash-text-tertiary)',
          margin: 0,
        }}
      >
        Si une campagne comparable existe déjà dans vos archives, on
        préremplit automatiquement la fiche, la grille de scoring, les
        canaux et les flux. Vous pourrez tout modifier avant de valider.
      </p>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: 'auto',
          paddingTop: 16,
        }}
      >
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className="font-display"
          style={{
            padding: '10px 20px',
            borderRadius: 10,
            border: 'none',
            background: canContinue
              ? 'linear-gradient(135deg, var(--dash-blue), var(--dash-purple))'
              : 'var(--dash-hover)',
            color: canContinue ? '#fff' : 'var(--dash-text-tertiary)',
            fontSize: 13,
            fontWeight: 700,
            cursor: canContinue ? 'pointer' : 'not-allowed',
            boxShadow: canContinue
              ? '0 2px 10px rgba(47,110,235,0.3)'
              : undefined,
          }}
        >
          {searching ? 'Recherche…' : 'Continuer'}
        </button>
      </div>
    </div>
  );
}

/**
 * Étape post-création : la campagne est enregistrée (brouillon). On propose de
 * l'activer si le verrou `canActivate` le permet, sinon on explique ce qui
 * manque et on offre de revenir compléter la campagne.
 */
function CreatedStep({
  campaign,
  activateError,
  onActivate,
  onEdit,
  onClose,
}: {
  campaign: ActiveCampaign;
  activateError: string | null;
  onActivate: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const gate = canActivate(campaign.lifecycle);
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: '24px 22px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span aria-hidden style={{ fontSize: 22, lineHeight: 1 }}>
          ✅
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
            Campagne enregistrée
          </h3>
          <p
            className="font-body"
            style={{
              margin: '2px 0 0',
              fontSize: 12,
              color: 'var(--dash-text-secondary)',
            }}
          >
            {campaign.id} — « {campaign.name} » est en brouillon.
          </p>
        </div>
      </div>

      {gate.ok ? (
        <p
          className="font-body"
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--dash-text-secondary)',
          }}
        >
          Tout est prêt. Activez-la pour démarrer la diffusion et la veille du CV
          Analyzer — ou gardez-la en brouillon pour plus tard.
        </p>
      ) : (
        <div
          className="font-body"
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: 'var(--dash-yellow-light)',
            border: '1px solid var(--dash-yellow)',
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--dash-text-secondary)',
          }}
        >
          Pour activer cette campagne, il reste à compléter :{' '}
          <strong style={{ color: 'var(--dash-text)' }}>
            {formatMissingPhases(gate.missing)}
          </strong>
          . Vous pouvez la garder en brouillon et la compléter plus tard.
        </div>
      )}

      {activateError ? (
        <div
          role="alert"
          className="font-body"
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            background: 'var(--dash-red-light)',
            color: 'var(--dash-red)',
            fontSize: 12,
            fontWeight: 600,
            border: '1px solid var(--dash-red)',
          }}
        >
          {activateError}
        </div>
      ) : null}

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 10,
          marginTop: 'auto',
          paddingTop: 16,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="font-body"
          style={{
            padding: '9px 16px',
            borderRadius: 8,
            border: '1px solid var(--dash-border)',
            background: 'var(--dash-surface)',
            color: 'var(--dash-text-secondary)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Garder en brouillon
        </button>
        {gate.ok ? (
          <button
            type="button"
            onClick={onActivate}
            className="font-display"
            style={{
              padding: '9px 18px',
              borderRadius: 8,
              border: 'none',
              background:
                'linear-gradient(135deg, var(--dash-green), var(--dash-green))',
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 2px 10px rgba(21,163,100,0.3)',
            }}
          >
            Activer la campagne
          </button>
        ) : (
          <button
            type="button"
            onClick={onEdit}
            className="font-display"
            style={{
              padding: '9px 18px',
              borderRadius: 8,
              border: 'none',
              background:
                'linear-gradient(135deg, var(--dash-blue), var(--dash-purple))',
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 2px 10px rgba(47,110,235,0.3)',
            }}
          >
            Compléter la campagne
          </button>
        )}
      </div>
    </div>
  );
}

function EditingStage({
  jobTitle,
  matchHint,
  fdp,
  patchField,
  onProposeFdp,
  proposingFdp,
  onProposeScoring,
  proposingScoring,
  proposeError,
  criteria,
  setCriteria,
  channels,
  setChannels,
  sources,
  setSources,
  mailboxIds,
  setMailboxIds,
  threshold,
  setThreshold,
  submitError,
  submitting,
  onCancel,
  onSubmit,
}: {
  jobTitle: string;
  matchHint: MatchHint | null;
  fdp: FDPInProgress;
  patchField: (key: FieldKey, value: unknown) => void;
  onProposeFdp: () => void;
  proposingFdp: boolean;
  onProposeScoring: () => void;
  proposingScoring: boolean;
  proposeError: string | null;
  criteria: ScoringCriterion[];
  setCriteria: (next: ScoringCriterion[]) => void;
  channels: PublicationChannel[];
  setChannels: (next: PublicationChannel[]) => void;
  sources: CVSource[];
  setSources: (next: CVSource[]) => void;
  mailboxIds: string[];
  setMailboxIds: (next: string[]) => void;
  threshold: number;
  setThreshold: (next: number) => void;
  submitError: string | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px 22px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {matchHint ? <MatchBanner hint={matchHint} /> : <NoMatchHint />}
        {proposeError ? <ProposeError message={proposeError} /> : null}

        <SectionRow>
          <SectionTitle icon="📄">Fiche de poste</SectionTitle>
          <ProposeButton
            label="Proposer la fiche"
            loading={proposingFdp}
            onClick={onProposeFdp}
          />
        </SectionRow>
        <FDPInlineEditor fdp={fdp} onPatch={patchField} />

        <SectionRow>
          <SectionTitle icon="⚖️">Fiche de scoring</SectionTitle>
          <ProposeButton
            label="Proposer la grille"
            loading={proposingScoring}
            onClick={onProposeScoring}
          />
        </SectionRow>
        <ScoringDraftEditor criteria={criteria} onChange={setCriteria} />

        <SectionTitle icon="📢">Canaux de diffusion</SectionTitle>
        <ChannelsDraftEditor selected={channels} onChange={setChannels} />

        <SectionTitle icon="📥">Flux de réception</SectionTitle>
        <FluxDraftEditor
          selected={sources}
          onChange={setSources}
          mailboxIds={mailboxIds}
          onMailboxesChange={setMailboxIds}
        />

        <SectionTitle icon="🎚️">Seuil d&apos;acceptation</SectionTitle>
        <ThresholdDraftEditor value={threshold} onChange={setThreshold} />
      </div>
      <footer
        style={{
          padding: '14px 22px',
          borderTop: '1px solid var(--dash-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {submitError ? (
          <div
            role="alert"
            className="font-body"
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: 'var(--dash-red-light)',
              color: 'var(--dash-red)',
              fontSize: 12,
              fontWeight: 600,
              border: '1px solid var(--dash-red)',
            }}
          >
            {submitError}
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span
            className="font-body"
            style={{
              fontSize: 12,
              color: 'var(--dash-text-tertiary)',
              maxWidth: 280,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            Poste : <strong>{jobTitle || '—'}</strong>
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="font-body"
              style={{
                padding: '9px 16px',
                borderRadius: 8,
                border: '1px solid var(--dash-border)',
                background: 'var(--dash-surface)',
                color: 'var(--dash-text-secondary)',
                fontSize: 13,
                fontWeight: 600,
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.6 : 1,
              }}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="font-display"
              style={{
                padding: '9px 18px',
                borderRadius: 8,
                border: 'none',
                background: submitting
                  ? 'var(--dash-hover)'
                  : 'linear-gradient(135deg, var(--dash-blue), var(--dash-purple))',
                color: submitting ? 'var(--dash-text-tertiary)' : '#fff',
                fontSize: 13,
                fontWeight: 700,
                cursor: submitting ? 'not-allowed' : 'pointer',
                boxShadow: submitting
                  ? undefined
                  : '0 2px 10px rgba(47,110,235,0.3)',
              }}
            >
              {submitting ? 'Enregistrement…' : 'Créer la campagne'}
            </button>
          </div>
        </div>
      </footer>
    </>
  );
}

type MatchHint = {
  sourceId: string;
  sourceName: string;
  copiedScoring: boolean;
  copiedChannels: boolean;
  copiedFlux: boolean;
};

function MatchBanner({ hint }: { hint: MatchHint }) {
  const pieces: string[] = ['la fiche'];
  if (hint.copiedScoring) pieces.push('la grille de scoring');
  if (hint.copiedChannels) pieces.push('les canaux');
  if (hint.copiedFlux) pieces.push('les flux');
  const summary =
    pieces.length === 1
      ? pieces[0]
      : pieces.slice(0, -1).join(', ') + ' et ' + pieces[pieces.length - 1];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        borderRadius: 10,
        background: 'var(--dash-blue-light)',
        color: 'var(--dash-blue)',
        border: '1px solid var(--dash-blue)',
      }}
    >
      <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>
        🔁
      </span>
      <div
        className="font-body"
        style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dash-blue)' }}
      >
        <strong style={{ fontWeight: 700 }}>
          Campagne comparable trouvée :
        </strong>{' '}
        {hint.sourceId} — « {hint.sourceName} ». On a préremplit {summary}
        {' '}— vous pouvez tout modifier avant de valider.
      </div>
    </div>
  );
}

function SectionTitle({
  icon,
  children,
}: {
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <h3
      className="font-display"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13,
        fontWeight: 700,
        color: 'var(--dash-text)',
        margin: '6px 0 -2px',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      <span aria-hidden style={{ fontSize: 14 }}>
        {icon}
      </span>
      {children}
    </h3>
  );
}

/** Ligne titre de section + action à droite (bouton « Proposer »). */
function SectionRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      {children}
    </div>
  );
}

/** Bouton de proposition IA (opt-in), avec état de chargement. */
function ProposeButton({
  label,
  loading,
  onClick,
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="font-body"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid var(--dash-purple)',
        background: loading ? 'var(--dash-hover)' : 'var(--dash-purple-light)',
        color: 'var(--dash-purple)',
        fontSize: 12,
        fontWeight: 700,
        cursor: loading ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden>✨</span>
      {loading ? 'Proposition…' : label}
    </button>
  );
}

/** Rappel affiché quand aucune campagne comparable n'a été trouvée. */
function NoMatchHint() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        borderRadius: 10,
        background: 'var(--dash-hover)',
        border: '1px solid var(--dash-border)',
      }}
    >
      <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>
        ✨
      </span>
      <div
        className="font-body"
        style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dash-text-secondary)' }}
      >
        <strong style={{ fontWeight: 700 }}>
          Aucune campagne comparable.
        </strong>{' '}
        Proposez une fiche de poste et une grille de scoring de départ avec les
        boutons ✨ — chaque valeur reste ajustable — ou saisissez tout
        manuellement.
      </div>
    </div>
  );
}

/** Message d'erreur discret pour un échec de proposition IA. */
function ProposeError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="font-body"
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        background: 'var(--dash-yellow-light)',
        color: 'var(--dash-text-secondary)',
        fontSize: 12,
        border: '1px solid var(--dash-yellow)',
      }}
    >
      {message}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Collecte les champs déjà remplis (pour cohérence de la proposition). */
function collectKnown(
  fdp: FDPInProgress,
): Partial<Record<FieldKey, unknown>> {
  const out: Partial<Record<FieldKey, unknown>> = {};
  for (const key of Object.keys(fdp.fields) as FieldKey[]) {
    const field = fdp.fields[key];
    if (field && field.status === 'filled' && isFilled(field.value)) {
      out[key] = field.value;
    }
  }
  return out;
}

function isFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
