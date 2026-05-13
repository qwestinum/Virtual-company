'use client';

/**
 * Carte d'une campagne avec head clickable et body dépliable
 * (Session 6).
 *
 * La head montre 4 mini-stats à droite (Candidats / Shortlistés / GO /
 * Conversion) qui restent visibles même quand la carte est repliée.
 * Le body montre la grille 5 stats, les rate boxes (Taux GO et
 * Conversion globale) et les boutons d'action.
 */

import type { ActiveCampaign } from '@/stores/campaigns-store';

import { AnimatedCounter } from './AnimatedCounter';
import { CampaignCardBody } from './CampaignCardBody';
import { StatusPill, type PillKind } from './StatusPill';
import { DASH_COLORS } from './tokens';
import {
  CampaignStatusActions,
  type CampaignActionStatus,
} from './CampaignStatusActions';

export type CampaignCardStats = {
  candidates: number;
  shortlisted: number;
  invited: number;
  interviews: number;
  goCount: number;
};

export type CampaignCardProps = {
  campaign: ActiveCampaign;
  stats: CampaignCardStats;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
};

export function CampaignCard({
  campaign,
  stats,
  expanded,
  onToggle,
  onEdit,
}: CampaignCardProps) {
  const pillKind: PillKind = pillKindOf(campaign.status);
  const conversion =
    stats.candidates > 0
      ? Math.round((stats.goCount / stats.candidates) * 100)
      : 0;

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
        <QuickStats
          candidates={stats.candidates}
          shortlisted={stats.shortlisted}
          goCount={stats.goCount}
          conversion={conversion}
        />
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
      {expanded ? (
        <CampaignCardBody campaign={campaign} stats={stats} onEdit={onEdit}>
          <CampaignStatusActions
            status={campaign.status as CampaignActionStatus}
            campaignId={campaign.id}
            onEdit={onEdit}
          />
        </CampaignCardBody>
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

function QuickStats({
  candidates,
  shortlisted,
  goCount,
  conversion,
}: {
  candidates: number;
  shortlisted: number;
  goCount: number;
  conversion: number;
}) {
  const conversionColor =
    conversion > 20
      ? DASH_COLORS.green.solid
      : conversion > 10
        ? DASH_COLORS.orange.solid
        : DASH_COLORS.red.solid;
  return (
    <div
      className="hidden-on-narrow"
      style={{
        display: 'flex',
        gap: 24,
        alignItems: 'center',
        flexShrink: 0,
      }}
    >
      <MiniStat
        value={candidates}
        color={DASH_COLORS.blue.solid}
        label="Candidats"
      />
      <MiniStat
        value={shortlisted}
        color={DASH_COLORS.purple.solid}
        label="Shortlistés"
      />
      <MiniStat
        value={goCount}
        color={DASH_COLORS.green.solid}
        label="GO"
      />
      <MiniStat
        value={conversion}
        suffix="%"
        color={conversionColor}
        label="Conversion"
      />
    </div>
  );
}

function MiniStat({
  value,
  suffix,
  color,
  label,
}: {
  value: number;
  suffix?: string;
  color: string;
  label: string;
}) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        className="font-data"
        style={{
          fontSize: 22,
          fontWeight: 800,
          lineHeight: 1,
          color,
        }}
      >
        <AnimatedCounter value={value} suffix={suffix} />
      </div>
      <div
        className="font-body"
        style={{
          fontSize: 11,
          color: 'var(--dash-text-tertiary)',
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
}
