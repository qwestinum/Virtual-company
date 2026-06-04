'use client';

/**
 * Carte « Candidats » avec filtres et lignes scrollables (Session 6).
 *
 * Filtres :
 *   - Statut : tous / shortlistés (score ≥ 75) / entretiens
 *   - Campagne : un select listant les campagnes actives + « Toutes »
 *
 * Limite d'affichage par défaut : 12 lignes (la maquette en montre 9).
 */

import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  markCandidateInterview,
  markCandidateValidation,
  type InterviewMark,
  type ValidationMark,
} from '@/lib/dashboard/candidate-actions';
import type { CandidateRow } from '@/lib/dashboard/derive-metrics';
import {
  selectActiveCampaigns,
  useCampaignsStore,
} from '@/stores/campaigns-store';

import { ScoreRing } from './ScoreRing';
import { StatusPill, type PillKind } from './StatusPill';
import { avatarColorFor } from './tokens';

export type CandidatesCardProps = {
  candidates: CandidateRow[];
  onAction?: () => void;
};

type StatusFilter = 'all' | 'shortlisted' | 'interview_done';
type CampaignFilter = 'all' | 'actives' | 'none' | string;
// 'all'     = aucun filtre campagne
// 'actives' = candidats dont la campagne est en statut 'active'
// 'none'    = candidats sans campagne (uploads isolés, IMAP orphelins)
// string    = id d'une campagne spécifique

const SHORTLIST_THRESHOLD = 75;

export function CandidatesCard({
  candidates,
  onAction,
}: CandidatesCardProps) {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [campaignId, setCampaignId] = useState<CampaignFilter>('all');
  const campaigns = useCampaignsStore(useShallow(selectActiveCampaigns));

  // Index nom/id des campagnes pour le label « X — nom » + set des ids
  // actifs pour le filtre "Campagnes actives".
  const campaignOptions = useMemo(
    () =>
      [...campaigns]
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
        .map((c) => ({
          id: c.id,
          label: `${c.id} — ${c.name}`,
          isActive: c.status === 'active',
        })),
    [campaigns],
  );
  const activeCampaignIds = useMemo(
    () => new Set(campaignOptions.filter((o) => o.isActive).map((o) => o.id)),
    [campaignOptions],
  );

  // Étape 1 : filtre campagne d'abord pour que les compteurs de statut
  // reflètent l'intersection (sinon les nombres ne correspondent pas à
  // ce qui est affiché).
  const inCampaign = candidates.filter((c) => {
    if (campaignId === 'all') return true;
    if (campaignId === 'actives') {
      return c.campaignId != null && activeCampaignIds.has(c.campaignId);
    }
    if (campaignId === 'none') return c.campaignId == null;
    return c.campaignId === campaignId;
  });

  const counts = {
    all: inCampaign.length,
    shortlisted: inCampaign.filter((c) => c.score >= SHORTLIST_THRESHOLD)
      .length,
    interview_done: inCampaign.filter((c) => c.status === 'interview_done')
      .length,
  };

  const filtered = inCampaign.filter((c) => {
    if (status === 'all') return true;
    if (status === 'shortlisted') return c.score >= SHORTLIST_THRESHOLD;
    return c.status === status;
  });

  return (
    <section
      style={{
        background: 'var(--dash-surface)',
        border: '1px solid var(--dash-border)',
        borderRadius: 16,
        padding: 22,
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <h3
          className="font-display"
          style={{
            fontSize: 17,
            fontWeight: 800,
            margin: 0,
            color: 'var(--dash-text)',
          }}
        >
          Candidats
        </h3>
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <CampaignSelect
            value={campaignId}
            options={campaignOptions}
            onChange={setCampaignId}
          />
          <Filters current={status} counts={counts} onChange={setStatus} />
        </div>
      </div>
      {filtered.length === 0 ? (
        <EmptyHint />
      ) : (
        filtered.slice(0, 12).map((c, i) => (
          <CandidateLine
            key={c.id}
            candidate={c}
            delayMs={i * 40}
            onAction={onAction}
          />
        ))
      )}
    </section>
  );
}

function CampaignSelect({
  value,
  options,
  onChange,
}: {
  value: CampaignFilter;
  options: { id: string; label: string; isActive: boolean }[];
  onChange: (v: CampaignFilter) => void;
}) {
  const activeCount = options.filter((o) => o.isActive).length;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.currentTarget.value as CampaignFilter)}
      aria-label="Filtrer par campagne"
      className="font-body"
      style={{
        padding: '6px 28px 6px 10px',
        borderRadius: 8,
        border: '1px solid var(--dash-border)',
        background: 'var(--dash-warm)',
        color: 'var(--dash-text)',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        maxWidth: 240,
      }}
    >
      <option value="all">Toutes les campagnes</option>
      <option value="actives">
        Campagnes actives ({activeCount})
      </option>
      <option value="none">Sans campagne</option>
      {options.length > 0 ? <option disabled>──────────</option> : null}
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.isActive ? '🟢 ' : ''}
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function Filters({
  current,
  counts,
  onChange,
}: {
  current: StatusFilter;
  counts: Record<StatusFilter, number>;
  onChange: (f: StatusFilter) => void;
}) {
  const items: { id: StatusFilter; label: string }[] = [
    { id: 'all', label: 'Tous' },
    { id: 'shortlisted', label: 'Shortlistés' },
    { id: 'interview_done', label: 'Entretiens' },
  ];
  return (
    <div
      style={{
        display: 'flex',
        gap: 3,
        background: 'var(--dash-warm)',
        borderRadius: 10,
        padding: 3,
      }}
    >
      {items.map((it) => {
        const active = it.id === current;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            className="font-body"
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              background: active ? 'var(--dash-surface)' : 'transparent',
              color: active
                ? 'var(--dash-text)'
                : 'var(--dash-text-tertiary)',
              boxShadow: active ? '0 1px 4px rgba(0,0,0,0.06)' : undefined,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              transition: 'all 0.15s',
            }}
          >
            {it.label}
            <span
              className="font-data"
              style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 4,
                background: active ? 'var(--dash-blue-light)' : 'transparent',
                color: active ? 'var(--dash-blue)' : 'inherit',
              }}
            >
              {counts[it.id]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CandidateLine({
  candidate,
  delayMs,
  onAction,
}: {
  candidate: CandidateRow;
  delayMs: number;
  onAction?: () => void;
}) {
  // Décide quels boutons proposer selon l'état courant.
  const isShortlisted =
    candidate.recommendation === 'go' &&
    candidate.interviewMarked == null &&
    candidate.validationMarked == null;
  const isAwaitingValidation =
    candidate.interviewMarked === 'realized' &&
    candidate.validationMarked == null;
  const isValidated = candidate.validationMarked === 'validated';

  const onInterview = async (status: InterviewMark) => {
    await markCandidateInterview({
      uid: candidate.id,
      candidateName: candidate.name,
      campaignId: candidate.campaignId,
      status,
    });
    onAction?.();
  };
  const onValidation = async (status: ValidationMark) => {
    await markCandidateValidation({
      uid: candidate.id,
      candidateName: candidate.name,
      campaignId: candidate.campaignId,
      status,
    });
    onAction?.();
  };

  return (
    <div
      className="dash-fade-in"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '11px 14px',
        borderRadius: 12,
        background: 'var(--dash-warm)',
        border: '1px solid transparent',
        marginBottom: 4,
        animationDelay: `${delayMs}ms`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar initials={candidate.initials} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className="font-display"
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--dash-text)',
              }}
            >
              {candidate.name}
            </span>
            {isValidated ? <RecBadge value="go" /> : null}
          </div>
          <div
            className="font-body"
            style={{
              fontSize: 12,
              color: 'var(--dash-text-secondary)',
              marginTop: 1,
            }}
          >
            {candidate.role ?? 'Sans campagne'}
            {candidate.campaignId ? ` (${candidate.campaignId})` : ''} ·{' '}
            {relativeTime(candidate.receivedAt)}
          </div>
        </div>
        <StatusPill kind={candidate.status as PillKind} />
        <ScoreRing score={candidate.score} />
      </div>
      {isShortlisted ? (
        <ActionPair
          variant="interview"
          onConfirm={() => onInterview('realized')}
          onReject={() => onInterview('missed')}
        />
      ) : isAwaitingValidation ? (
        <ActionPair
          variant="validation"
          onConfirm={() => onValidation('validated')}
          onReject={() => onValidation('rejected')}
        />
      ) : null}
    </div>
  );
}

function ActionPair({
  variant,
  onConfirm,
  onReject,
}: {
  variant: 'interview' | 'validation';
  onConfirm: () => void;
  onReject: () => void;
}) {
  const labels =
    variant === 'interview'
      ? { confirm: 'Entretien réalisé', reject: 'Non réalisé' }
      : { confirm: 'Validation définitive', reject: 'Non validé' };
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        paddingLeft: 50, // s'aligne sous le nom (après l'avatar)
      }}
    >
      <button
        type="button"
        onClick={onConfirm}
        className="font-body"
        style={{
          padding: '6px 12px',
          borderRadius: 7,
          border: 'none',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 700,
          background: 'var(--dash-green-light)',
          color: 'var(--dash-green)',
        }}
      >
        ✓ {labels.confirm}
      </button>
      <button
        type="button"
        onClick={onReject}
        className="font-body"
        style={{
          padding: '6px 12px',
          borderRadius: 7,
          border: 'none',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 700,
          background: 'var(--dash-red-light)',
          color: 'var(--dash-red)',
        }}
      >
        ✗ {labels.reject}
      </button>
    </div>
  );
}

function Avatar({ initials }: { initials: string }) {
  const color = avatarColorFor(initials);
  return (
    <div
      aria-hidden
      className="font-display"
      style={{
        width: 36,
        height: 36,
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        fontWeight: 800,
        color: '#fff',
        flexShrink: 0,
        background: `linear-gradient(135deg, ${color.solid}, ${color.solid}cc)`,
        boxShadow: `0 2px 8px ${color.solid}30`,
      }}
    >
      {initials}
    </div>
  );
}

function RecBadge({ value }: { value: 'go' | 'no-go' }) {
  const isGo = value === 'go';
  return (
    <span
      className="font-data"
      style={{
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 6,
        letterSpacing: '0.5px',
        background: isGo ? 'var(--dash-green-light)' : 'var(--dash-red-light)',
        color: isGo ? 'var(--dash-green)' : 'var(--dash-red)',
      }}
    >
      {isGo ? '✓ GO' : '✗ NO-GO'}
    </span>
  );
}

function EmptyHint() {
  return (
    <div
      className="font-body"
      style={{
        padding: '32px 16px',
        textAlign: 'center',
        color: 'var(--dash-text-tertiary)',
        fontSize: 13,
      }}
    >
      Pas encore de candidat à afficher.
    </div>
  );
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return 'à l’instant';
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'il y a 1j';
  return `il y a ${days}j`;
}
