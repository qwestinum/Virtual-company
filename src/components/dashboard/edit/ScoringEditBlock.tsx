'use client';

/**
 * Édition de la grille de scoring pour n'importe quelle campagne
 * (Session 6 v3 — fix : avant, le bloc dépendait du scoring-store qui
 * ne porte qu'une seule fiche active à la fois, et bloquait l'édition
 * dès qu'on ouvrait le sheet sur une campagne autre que celle du chat).
 *
 * Implémentation : draft local initialisé depuis `campaign.scoringSheet`,
 * commit via `addCampaign({...with new scoringSheet})`. Aucune
 * interaction avec le scoring-store. Si la campagne n'a pas encore de
 * fiche, on en propose une vide que le DRH peut peupler à la main.
 */

import { useState } from 'react';

import { MethodBadge } from '@/components/scoring/MethodBadge';
import { pushManagerAcknowledgment } from '@/lib/chat/manager-acknowledgments';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import { useCampaignsStore } from '@/stores/campaigns-store';
import {
  buildCriterion,
  DEFAULT_WEIGHTS,
  SCORING_LEVELS,
  SCORING_LEVEL_COLORS,
  SCORING_LEVEL_LABELS,
  type ScoringCriterion,
  type ScoringLevel,
  type ScoringSheet,
} from '@/types/scoring';

import { SaveBanner, SaveFooter } from './SaveBanner';

const FLASH_MS = 3000;

export type ScoringEditBlockProps = {
  campaign: ActiveCampaign;
};

export function ScoringEditBlock({ campaign }: ScoringEditBlockProps) {
  return (
    <ScoringEditInner
      key={`${campaign.id}-${campaign.updatedAt}`}
      campaign={campaign}
    />
  );
}

function ScoringEditInner({ campaign }: ScoringEditBlockProps) {
  const initialCriteria: ScoringCriterion[] =
    campaign.scoringSheet?.criteria ?? [];
  const [criteria, setCriteria] = useState<ScoringCriterion[]>(initialCriteria);
  const [flash, setFlash] = useState<string | null>(null);
  const addCampaign = useCampaignsStore((s) => s.addCampaign);

  const isInitial = campaign.scoringSheet == null && criteria.length === 0;
  const dirty =
    !isInitial && !sameCriteria(criteria, initialCriteria);
  // On peut enregistrer si la grille a changé OU si elle n'est pas encore
  // VALIDÉE (l'enregistrement la valide → débloque l'activation). Sans ça, une
  // grille déjà peuplée mais non validée restait non enregistrable, forçant le
  // DRH à ajouter un critère factice pour activer le bouton.
  const canSave =
    criteria.length > 0 && (dirty || campaign.scoringSheet?.isValidated !== true);

  const updateCriterion = (
    id: string,
    delta: Partial<Pick<ScoringCriterion, 'label' | 'level' | 'weight'>>,
  ) => setCriteria(criteria.map((c) => (c.id === id ? { ...c, ...delta } : c)));

  const removeCriterion = (id: string) =>
    setCriteria(criteria.filter((c) => c.id !== id));

  const addCriterion = () => {
    const id = `crit_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    setCriteria([
      ...criteria,
      buildCriterion({
        id,
        label: 'Nouveau critère',
        level: 'important',
      }),
    ]);
  };

  const onSave = () => {
    const sheet: ScoringSheet = {
      campaignId: campaign.id,
      criteria,
      isValidated: criteria.length > 0,
    };
    addCampaign({
      fdp: campaign.fdp,
      name: campaign.name,
      status: campaign.status,
      scoringSheet: sheet,
      publishedChannels: campaign.publishedChannels,
      sourcesConfirmed: campaign.sourcesConfirmed,
      threshold: campaign.threshold,
    });
    pushManagerAcknowledgment({
      kind: 'scoring_updated',
      campaignId: campaign.id,
      campaignName: campaign.name,
    });
    setFlash(
      `Grille enregistrée — ${criteria.length} critère${criteria.length > 1 ? 's' : ''} actifs sur les prochaines analyses.`,
    );
    window.setTimeout(() => setFlash(null), FLASH_MS);
  };

  return (
    <div>
      <SaveBanner message={flash} />
      {criteria.length === 0 ? (
        <p
          className="font-body"
          style={{
            fontSize: 12,
            color: 'var(--dash-text-secondary)',
            marginBottom: 12,
          }}
        >
          Pas encore de grille pour cette campagne. Ajoutez vos critères
          ci-dessous puis validez — la grille sera prise en compte par le CV
          Analyzer dès la prochaine candidature.
        </p>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {criteria.map((criterion) => (
          <CriterionRow
            key={criterion.id}
            criterion={criterion}
            onUpdate={(patch) => updateCriterion(criterion.id, patch)}
            onRemove={() => removeCriterion(criterion.id)}
          />
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 12,
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={addCriterion}
          className="font-body"
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px dashed var(--dash-border-strong)',
            background: 'transparent',
            color: 'var(--dash-text-secondary)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Ajouter un critère
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="font-display"
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            background: canSave
              ? 'linear-gradient(135deg, var(--dash-blue), var(--dash-purple))'
              : 'var(--dash-hover)',
            color: canSave ? '#fff' : 'var(--dash-text-tertiary)',
            cursor: canSave ? 'pointer' : 'not-allowed',
            fontSize: 12,
            fontWeight: 700,
            boxShadow: canSave
              ? '0 2px 10px rgba(47,110,235,0.3)'
              : undefined,
          }}
        >
          Enregistrer la grille
        </button>
      </div>
    </div>
  );
}

function CriterionRow({
  criterion,
  onUpdate,
  onRemove,
}: {
  criterion: ScoringCriterion;
  onUpdate: (patch: Partial<Pick<ScoringCriterion, 'label' | 'level' | 'weight'>>) => void;
  onRemove: () => void;
}) {
  const levelColor = SCORING_LEVEL_COLORS[criterion.level];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto auto auto auto',
        gap: 8,
        alignItems: 'center',
        padding: '8px 10px',
        borderRadius: 10,
        background: 'var(--dash-warm)',
        border: '1px solid var(--dash-border)',
      }}
    >
      <input
        type="text"
        value={criterion.label}
        onChange={(e) => onUpdate({ label: e.currentTarget.value })}
        className="font-body"
        style={{
          background: 'transparent',
          border: 'none',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--dash-text)',
          padding: '4px 0',
          outline: 'none',
          minWidth: 0,
        }}
      />
      {/* Badge méthode de vérification (lecture seule côté dashboard — édition
          complète dans l'éditeur de fiche du chat). */}
      <MethodBadge method={criterion.verificationMethod} />
      <select
        value={criterion.level}
        onChange={(e) => {
          const next = e.currentTarget.value as ScoringLevel;
          onUpdate({ level: next, weight: DEFAULT_WEIGHTS[next] });
        }}
        className="font-body"
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: levelColor,
          background: 'var(--dash-surface)',
          border: `1px solid ${levelColor}40`,
          borderRadius: 6,
          padding: '3px 6px',
          cursor: 'pointer',
        }}
      >
        {SCORING_LEVELS.map((lvl) => (
          <option key={lvl} value={lvl}>
            {SCORING_LEVEL_LABELS[lvl]}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={0}
        max={20}
        step={1}
        value={criterion.weight}
        onChange={(e) => onUpdate({ weight: Number(e.currentTarget.value) })}
        className="font-data"
        style={{
          width: 50,
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--dash-text)',
          background: 'var(--dash-surface)',
          border: '1px solid var(--dash-border)',
          borderRadius: 6,
          padding: '3px 6px',
          textAlign: 'center',
        }}
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Supprimer ce critère"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--dash-text-tertiary)',
          cursor: 'pointer',
          fontSize: 16,
          padding: 2,
        }}
      >
        ×
      </button>
    </div>
  );
}

function sameCriteria(a: ScoringCriterion[], b: ScoringCriterion[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id ||
      a[i].label !== b[i].label ||
      a[i].level !== b[i].level ||
      a[i].weight !== b[i].weight
    )
      return false;
  }
  return true;
}

/**
 * SaveFooter inutilisé ici mais ré-exporté pour conserver la cohérence
 * d'API avec les autres blocs si jamais on revient à un pattern footer.
 */
export { SaveFooter };
