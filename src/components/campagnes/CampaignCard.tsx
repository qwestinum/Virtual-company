'use client';

/**
 * Carte d'une campagne avec head clickable et body dépliable
 * (Session 6).
 *
 * La head montre 4 mini-stats à droite (Candidats / passés par l’invitation / retenus /
 * Conversion) qui restent visibles même quand la carte est repliée.
 * Le body montre la grille 5 stats, les rate boxes (taux de retenus et
 * Conversion globale) et les boutons d'action.
 */

import type { CandidateStage } from '@/lib/reporting/candidate-stage';
import type { ActiveCampaign } from '@/stores/campaigns-store';

import { AnimatedCounter } from '@/components/dashboard/AnimatedCounter';
import { StatusPill, type PillKind } from '@/components/dashboard/StatusPill';
import { DASH_COLORS } from '@/components/dashboard/tokens';

import {
  CampaignCardDetail,
  type CampaignCardCounters,
} from './CampaignCardDetail';
import {
  CampaignStatusActions,
  type CampaignActionStatus,
} from './CampaignStatusActions';

export type CampaignCardProps = {
  campaign: ActiveCampaign;
  /**
   * Compteurs livrés AVEC la liste (appel groupé) : les chiffres d'une carte
   * ne doivent jamais apparaître après elle. `null` tant que la lecture
   * groupée n'a pas répondu — la carte se replie alors sur son en-tête.
   */
  counters: CampaignCardCounters | null;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
};

export function CampaignCard({
  campaign,
  counters,
  expanded,
  onToggle,
  onEdit,
}: CampaignCardProps) {
  const pillKind: PillKind = pillKindOf(campaign.status);

  const iconKey = campaign.status === 'paused' ? 'paused' : campaign.status === 'draft' || campaign.status === 'in_progress' ? 'draft' : 'active';
  const description = describeCampaign(campaign);

  return (
    <article
      style={{
        background: 'var(--dash-surface)',
        border: `1px solid ${expanded ? 'var(--dash-border-strong)' : 'var(--dash-border)'}`,
        borderRadius: 16,
        overflow: 'hidden',
        marginBottom: 10,
        boxShadow: expanded ? '0 4px 20px rgba(0,0,0,0.05)' : undefined,
        transition: 'all 0.2s',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          textAlign: 'left',
          cursor: 'pointer',
          padding: '18px 22px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <CampaignIcon kind={iconKey} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 3,
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
              {campaign.id}
            </span>
            <span
              className="font-display"
              style={{
                fontSize: 17,
                fontWeight: 800,
                color: 'var(--dash-text)',
              }}
            >
              {campaign.name}
            </span>
            <StatusPill kind={pillKind} />
          </div>
          <div
            className="font-body"
            style={{
              fontSize: 13,
              color: 'var(--dash-text-secondary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {description}
          </div>
        </div>
        <span
          aria-hidden
          style={{
            color: 'var(--dash-text-tertiary)',
            fontSize: 16,
            flexShrink: 0,
            transition: 'transform 0.2s',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          ▾
        </span>
      </button>
      {/* ⚠️ La lecture du détail est conditionnée au DÉPLIAGE : une liste de
          quinze campagnes ne déclenche aucune requête, et la liste n'ouvre
          qu'une carte à la fois. */}
      {expanded ? (
        <CampaignCardDetail
          campaignId={campaign.id}
          expanded={expanded}
          counters={counters}
          actions={
            <CampaignStatusActions
              status={campaign.status as CampaignActionStatus}
              campaignId={campaign.id}
              onEdit={onEdit}
            />
          }
        />
      ) : null}
    </article>
  );
}

function pillKindOf(status: ActiveCampaign['status']): PillKind {
  if (status === 'active') return 'active';
  if (status === 'paused') return 'paused';
  if (status === 'closed') return 'closed';
  return 'draft';
}

function describeCampaign(campaign: ActiveCampaign): string {
  const skills = campaign.fdp.fields.key_skills?.value;
  const seniority = campaign.fdp.fields.seniority?.value;
  const parts: string[] = [];
  if (Array.isArray(skills)) {
    const tags = skills
      .filter((s): s is string => typeof s === 'string')
      .slice(0, 3);
    if (tags.length > 0) parts.push(tags.join(', '));
  } else if (typeof skills === 'string') {
    parts.push(skills);
  }
  if (typeof seniority === 'string' && seniority.trim()) parts.push(seniority);
  return parts.length > 0 ? parts.join(' — ') : 'Campagne en cours de cadrage';
}

function CampaignIcon({
  kind,
}: {
  kind: 'active' | 'paused' | 'draft';
}) {
  const map = {
    active: {
      bg: 'linear-gradient(135deg, var(--dash-green), var(--dash-teal))',
      shadow: 'rgba(21,163,100,0.3)',
      emoji: '⚡',
    },
    paused: {
      bg: 'linear-gradient(135deg, var(--dash-yellow), var(--dash-orange))',
      shadow: 'rgba(213,160,0,0.3)',
      emoji: '⏸',
    },
    draft: {
      bg: 'linear-gradient(135deg, var(--dash-text-tertiary), var(--dash-text-secondary))',
      shadow: 'rgba(101,98,93,0.3)',
      emoji: '📝',
    },
  } as const;
  const spec = map[kind];
  return (
    <div
      aria-hidden
      style={{
        width: 44,
        height: 44,
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 20,
        color: '#fff',
        flexShrink: 0,
        background: spec.bg,
        boxShadow: `0 3px 12px ${spec.shadow}`,
      }}
    >
      {spec.emoji}
    </div>
  );
}
