'use client';

/**
 * Corps déplié d'une carte campagne (Session 6).
 *
 * Affiche la grille de 5 stats détaillées, les deux rate boxes (Taux GO
 * et Conversion globale) et la zone d'actions (suspendre, désactiver,
 * éditer, etc.). La maquette met le détail (budget, date, plateformes)
 * dans une troisième box à côté des rates.
 */

import type { ReactNode } from 'react';

import type { CandidateStage } from '@/lib/reporting/candidate-stage';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import type { FieldKey } from '@/types/field-collection';

import { AnimatedCounter } from '@/components/dashboard/AnimatedCounter';
import { DASH_COLORS } from '@/components/dashboard/tokens';

import type { CampaignCardStats } from './CampaignCard';

export type CampaignCardBodyProps = {
  campaign: ActiveCampaign;
  stats: CampaignCardStats;
  onEdit: () => void;
  /** Quadrant cliqué → Candidatures de cette campagne, pré-filtré par étape. */
  onOpenCandidatures?: (stage: CandidateStage | null) => void;
  children: ReactNode;
};

export function CampaignCardBody({
  campaign,
  stats,
  onOpenCandidatures,
  children,
}: CampaignCardBodyProps) {
  const goRate =
    stats.interviews > 0
      ? Math.round((stats.goCount / stats.interviews) * 100)
      : 0;
  const conversionRate =
    stats.candidates > 0
      ? Math.round((stats.goCount / stats.candidates) * 100)
      : 0;

  const salary = pickField(campaign, 'salary_range') ?? '—';
  const targetDate = pickField(campaign, 'start_date') ?? '—';
  const channels = campaign.publishedChannels;

  return (
    <div
      style={{
        padding: '18px 22px 20px',
        borderTop: '1px solid var(--dash-border)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
          gap: 12,
          marginBottom: 18,
        }}
      >
        {/* Quadrant → étape du menu Candidatures (mapping aligné sur la
            sémantique des stats, cf. CampaignsList) : CV reçus = toutes ;
            Shortlistés/Invités = invite ; Entretiens = entretien_fait
            (« Entretien réalisé » cliqué) ; GO = retenu. */}
        <StatBox
          icon="📄"
          color={DASH_COLORS.blue.solid}
          value={stats.candidates}
          label="CV reçus"
          onOpen={onOpenCandidatures ? () => onOpenCandidatures(null) : undefined}
        />
        <StatBox
          icon="⭐"
          color={DASH_COLORS.purple.solid}
          value={stats.shortlisted}
          label="Shortlistés / Invités"
          onOpen={
            onOpenCandidatures ? () => onOpenCandidatures('invite') : undefined
          }
        />
        <StatBox
          icon="🎯"
          color={DASH_COLORS.teal.solid}
          value={stats.interviews}
          label="Entretiens"
          onOpen={
            onOpenCandidatures
              ? () => onOpenCandidatures('entretien_fait')
              : undefined
          }
        />
        <StatBox
          icon="✅"
          color={DASH_COLORS.green.solid}
          value={stats.goCount}
          label="GO"
          onOpen={
            onOpenCandidatures ? () => onOpenCandidatures('retenu') : undefined
          }
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          marginBottom: 18,
        }}
      >
        <RateBox
          background={DASH_COLORS.green.light}
          color={DASH_COLORS.green.solid}
          value={goRate}
          label="Taux GO"
          sub={`${stats.goCount} GO sur ${stats.interviews} entretiens`}
        />
        <RateBox
          background={DASH_COLORS.blue.light}
          color={DASH_COLORS.blue.solid}
          value={conversionRate}
          label="Conversion globale"
          sub="CV reçu → recommandation GO"
        />
        <div
          style={{
            background: 'var(--dash-warm)',
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div
            className="font-body"
            style={{
              fontSize: 12,
              color: 'var(--dash-text-secondary)',
              marginBottom: 6,
            }}
          >
            Détails
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              marginTop: 6,
            }}
          >
            <MetaTag>💰 {salary}</MetaTag>
            <MetaTag>📅 {targetDate}</MetaTag>
            {channels.map((ch) => (
              <MetaTag key={ch}>{ch}</MetaTag>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '14px 16px',
          background: 'var(--dash-warm)',
          borderRadius: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span
          className="font-body"
          style={{
            fontSize: 12,
            color: 'var(--dash-text-secondary)',
            marginRight: 8,
          }}
        >
          Actions :
        </span>
        {children}
      </div>
    </div>
  );
}

function pickField(
  campaign: ActiveCampaign,
  key: FieldKey,
): string | null {
  const field = campaign.fdp.fields[key];
  if (!field) return null;
  const v = field.value;
  if (typeof v === 'string') return v.trim() || null;
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'number') return String(v);
  return null;
}

function StatBox({
  icon,
  color,
  value,
  label,
  onOpen,
}: {
  icon: string;
  color: string;
  value: number;
  label: string;
  /** Clic sur le quadrant → Candidatures pré-filtré. Absent = box statique. */
  onOpen?: () => void;
}) {
  const content = (
    <>
      <span
        aria-hidden
        style={{ fontSize: 18, display: 'block', marginBottom: 6 }}
      >
        {icon}
      </span>
      <div
        className="font-data"
        style={{ fontSize: 24, fontWeight: 800, color }}
      >
        <AnimatedCounter value={value} />
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
    </>
  );
  const baseStyle = {
    background: 'var(--dash-warm)',
    borderRadius: 12,
    padding: '14px 12px',
    textAlign: 'center' as const,
  };
  if (!onOpen) {
    return <div style={baseStyle}>{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Voir les candidatures — ${label}`}
      aria-label={`Voir les candidatures de la campagne — ${label}`}
      className="campaign-statbox"
      style={{
        ...baseStyle,
        border: '1px solid transparent',
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        font: 'inherit',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--dash-border-strong)';
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'transparent';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {content}
    </button>
  );
}

function RateBox({
  background,
  color,
  value,
  label,
  sub,
}: {
  background: string;
  color: string;
  value: number;
  label: string;
  sub: string;
}) {
  return (
    <div
      style={{
        background,
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <div
        className="font-data"
        style={{ fontSize: 32, fontWeight: 800, color }}
      >
        <AnimatedCounter value={value} suffix="%" />
      </div>
      <div>
        <div
          className="font-display"
          style={{ fontSize: 13, fontWeight: 700, color }}
        >
          {label}
        </div>
        <div
          className="font-body"
          style={{
            fontSize: 11,
            color: 'var(--dash-text-secondary)',
            marginTop: 2,
          }}
        >
          {sub}
        </div>
      </div>
    </div>
  );
}

function MetaTag({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="font-data"
      style={{
        fontSize: 11,
        color: 'var(--dash-text-secondary)',
        background: 'var(--dash-surface)',
        padding: '3px 10px',
        borderRadius: 6,
        border: '1px solid var(--dash-border)',
      }}
    >
      {children}
    </span>
  );
}
