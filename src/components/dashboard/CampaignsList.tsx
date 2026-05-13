'use client';

/**
 * Liste des campagnes affichée sous les KPIs (Session 6).
 *
 * Source de vérité : `useCampaignsStore` côté client (les campagnes du
 * DRH). Les métriques par campagne arrivent du dashboard global puis
 * sont mémorisées dans une Map.
 *
 * Une seule campagne dépliée à la fois — cohérent avec la maquette et
 * évite que la page devienne illisible quand il y en a plusieurs.
 */

import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  selectActiveCampaigns,
  useCampaignsStore,
} from '@/stores/campaigns-store';

import { CampaignCard } from './CampaignCard';
import type { DashboardData } from '@/hooks/useDashboardData';

export type CampaignsListProps = {
  candidates: DashboardData['candidates'];
  onEditCampaign: (campaignId: string) => void;
  onCreateCampaign: () => void;
};

const PAGE_SIZE = 5;

type StatusFilter = 'active' | 'paused' | 'draft' | 'closed' | 'all';

const STATUS_FILTERS: { id: StatusFilter; label: string; dot: string }[] = [
  { id: 'active', label: 'Actives', dot: 'var(--dash-green)' },
  { id: 'paused', label: 'Suspendues', dot: 'var(--dash-yellow)' },
  { id: 'draft', label: 'Brouillon', dot: 'var(--dash-text-tertiary)' },
  { id: 'closed', label: 'Clôturées', dot: 'var(--dash-red)' },
  { id: 'all', label: 'Toutes', dot: 'var(--dash-blue)' },
];

export function CampaignsList({
  candidates,
  onEditCampaign,
  onCreateCampaign,
}: CampaignsListProps) {
  const rawCampaigns = useCampaignsStore(useShallow(selectActiveCampaigns));
  // Tri par récence (createdAt desc). Fallback sur l'ordre d'insertion si
  // createdAt est manquant (campagnes seedées sans timestamp).
  const allCampaigns = useMemo(
    () =>
      [...rawCampaigns].sort((a, b) =>
        (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
      ),
    [rawCampaigns],
  );

  // Filtre statut — par défaut « Actives » pour démarrer en focus sur
  // ce qui tourne. `draft` agrège draft + in_progress (cadrage en
  // cours) pour éviter de fragmenter la vue à l'écran.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const campaigns = useMemo(() => {
    if (statusFilter === 'all') return allCampaigns;
    if (statusFilter === 'draft') {
      return allCampaigns.filter(
        (c) => c.status === 'draft' || c.status === 'in_progress',
      );
    }
    return allCampaigns.filter((c) => c.status === statusFilter);
  }, [allCampaigns, statusFilter]);

  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(campaigns.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageCampaigns = campaigns.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );
  const [expandedId, setExpandedId] = useState<string | null>(
    pageCampaigns[0]?.id ?? null,
  );

  // Compteurs basés sur la liste totale (pas filtrée) pour informer
  // l'utilisateur du volume disponible derrière chaque chip.
  const statusCounts = useMemo(
    () => ({
      active: allCampaigns.filter((c) => c.status === 'active').length,
      paused: allCampaigns.filter((c) => c.status === 'paused').length,
      draft: allCampaigns.filter(
        (c) => c.status === 'draft' || c.status === 'in_progress',
      ).length,
      closed: allCampaigns.filter((c) => c.status === 'closed').length,
      all: allCampaigns.length,
    }),
    [allCampaigns],
  );

  // Indexe les candidats par campagne pour donner des stats live à
  // chaque CampaignCard sans appel API supplémentaire (la route globale
  // a déjà tout chargé).
  //
  // Sémantique alignée sur derive-metrics (KPIs globaux) :
  //   - shortlisted : aboveThreshold (recommendation === 'go') ET pas
  //                   marqué « non validé » au verdict final ;
  //   - invited     : a au moins reçu une invitation — proxy par
  //                   « statut !== analyzed » (analysé = pre-invite) ;
  //   - interviews  : DRH a cliqué « Entretien réalisé » ;
  //   - goCount     : DRH a cliqué « Validation définitive ».
  //
  // Bug fixé en Session 6 v4 : goCount partait sur recommendation === 'go',
  // ce qui montrait « 6 GO » dans la carte alors que la liste candidats
  // n'en affichait que ceux validés. Maintenant les deux vues s'accordent.
  const statsByCampaign = useMemo(() => {
    const map = new Map<
      string,
      {
        candidates: number;
        shortlisted: number;
        invited: number;
        interviews: number;
        goCount: number;
      }
    >();
    for (const c of candidates) {
      if (!c.campaignId) continue;
      const cur = map.get(c.campaignId) ?? {
        candidates: 0,
        shortlisted: 0,
        invited: 0,
        interviews: 0,
        goCount: 0,
      };
      cur.candidates += 1;
      if (
        c.recommendation === 'go' &&
        c.validationMarked !== 'rejected'
      ) {
        cur.shortlisted += 1;
      }
      if (c.status !== 'analyzed') cur.invited += 1;
      if (c.interviewMarked === 'realized') cur.interviews += 1;
      if (c.validationMarked === 'validated') cur.goCount += 1;
      map.set(c.campaignId, cur);
    }
    return map;
  }, [candidates]);

  const selectStatus = (next: StatusFilter) => {
    if (next === statusFilter) return;
    setStatusFilter(next);
    setPage(0);
    setExpandedId(null);
  };

  return (
    <section style={{ marginBottom: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <AddCampaignButton onClick={onCreateCampaign} />
          <h2
            className="font-display"
            style={{
              fontSize: 20,
              fontWeight: 800,
              margin: 0,
              color: 'var(--dash-text)',
            }}
          >
            Campagnes
          </h2>
        </div>
        <StatusFilterChips
          current={statusFilter}
          counts={statusCounts}
          onChange={selectStatus}
        />
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          onCreate={onCreateCampaign}
          filter={statusFilter}
          totalCampaigns={allCampaigns.length}
          onReset={() => selectStatus('all')}
        />
      ) : (
        <>
          {pageCampaigns.map((camp) => (
            <CampaignCard
              key={camp.id}
              campaign={camp}
              stats={
                statsByCampaign.get(camp.id) ?? {
                  candidates: 0,
                  shortlisted: 0,
                  invited: 0,
                  interviews: 0,
                  goCount: 0,
                }
              }
              expanded={expandedId === camp.id}
              onToggle={() =>
                setExpandedId(expandedId === camp.id ? null : camp.id)
              }
              onEdit={() => onEditCampaign(camp.id)}
            />
          ))}
          {totalPages > 1 ? (
            <Pager
              page={safePage}
              total={totalPages}
              onPrev={() => setPage(Math.max(0, safePage - 1))}
              onNext={() => setPage(Math.min(totalPages - 1, safePage + 1))}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function AddCampaignButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Ajouter une nouvelle campagne"
      className="font-display"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px 6px 8px',
        borderRadius: 999,
        border: 'none',
        cursor: 'pointer',
        background:
          'linear-gradient(135deg, var(--dash-blue), var(--dash-purple))',
        color: '#fff',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.02em',
        boxShadow: '0 2px 10px rgba(47,110,235,0.3)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.22)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        +
      </span>
      Nouvelle campagne
    </button>
  );
}

function Pager({
  page,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
        marginTop: 14,
      }}
    >
      <PagerBtn label="‹ Précédent" onClick={onPrev} disabled={page === 0} />
      <span
        className="font-data"
        style={{
          fontSize: 12,
          color: 'var(--dash-text-secondary)',
        }}
      >
        Page {page + 1} / {total}
      </span>
      <PagerBtn
        label="Suivant ›"
        onClick={onNext}
        disabled={page >= total - 1}
      />
    </div>
  );
}

function PagerBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-body"
      style={{
        padding: '6px 14px',
        borderRadius: 8,
        border: '1px solid var(--dash-border)',
        background: disabled ? 'var(--dash-hover)' : 'var(--dash-surface)',
        color: disabled
          ? 'var(--dash-text-tertiary)'
          : 'var(--dash-text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {label}
    </button>
  );
}

function StatusFilterChips({
  current,
  counts,
  onChange,
}: {
  current: StatusFilter;
  counts: Record<StatusFilter, number>;
  onChange: (next: StatusFilter) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Filtrer les campagnes par statut"
      style={{
        display: 'flex',
        gap: 3,
        padding: 3,
        background: 'var(--dash-warm)',
        borderRadius: 10,
        flexWrap: 'wrap',
      }}
    >
      {STATUS_FILTERS.map((filter) => {
        const active = filter.id === current;
        const count = counts[filter.id];
        return (
          <button
            key={filter.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(filter.id)}
            className="font-body"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              background: active ? 'var(--dash-surface)' : 'transparent',
              color: active ? 'var(--dash-text)' : 'var(--dash-text-tertiary)',
              boxShadow: active ? '0 1px 4px rgba(0,0,0,0.06)' : undefined,
              transition: 'all 0.15s',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: filter.dot,
              }}
            />
            {filter.label}
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
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({
  onCreate,
  filter,
  totalCampaigns,
  onReset,
}: {
  onCreate: () => void;
  filter: StatusFilter;
  totalCampaigns: number;
  onReset: () => void;
}) {
  // Cas 1 — vraiment vide (aucune campagne au total).
  if (totalCampaigns === 0) {
    return (
      <div
        style={{
          background: 'var(--dash-surface)',
          border: '1px dashed var(--dash-border-strong)',
          borderRadius: 16,
          padding: '36px 22px',
          textAlign: 'center',
          color: 'var(--dash-text-secondary)',
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 8 }} aria-hidden>
          📋
        </div>
        <p className="font-body" style={{ margin: 0, fontSize: 14 }}>
          Aucune campagne pour l&apos;instant.
        </p>
        <button
          type="button"
          onClick={onCreate}
          className="font-display"
          style={{
            marginTop: 14,
            padding: '8px 16px',
            borderRadius: 999,
            border: 'none',
            cursor: 'pointer',
            background:
              'linear-gradient(135deg, var(--dash-blue), var(--dash-purple))',
            color: '#fff',
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          + Créer la première campagne
        </button>
      </div>
    );
  }
  // Cas 2 — il y a des campagnes mais aucune dans ce filtre.
  const filterLabel = STATUS_FILTERS.find((f) => f.id === filter)?.label ?? '';
  return (
    <div
      style={{
        background: 'var(--dash-surface)',
        border: '1px dashed var(--dash-border-strong)',
        borderRadius: 16,
        padding: '30px 22px',
        textAlign: 'center',
        color: 'var(--dash-text-secondary)',
      }}
    >
      <div style={{ fontSize: 24, marginBottom: 6 }} aria-hidden>
        🔍
      </div>
      <p className="font-body" style={{ margin: 0, fontSize: 13 }}>
        Aucune campagne dans le filtre « {filterLabel.toLowerCase()} ».
      </p>
      <button
        type="button"
        onClick={onReset}
        className="font-body"
        style={{
          marginTop: 12,
          padding: '6px 14px',
          borderRadius: 8,
          border: '1px solid var(--dash-border)',
          background: 'var(--dash-surface)',
          color: 'var(--dash-text-secondary)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Voir toutes les campagnes
      </button>
    </div>
  );
}
