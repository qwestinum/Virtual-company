'use client';

/**
 * Accordéon des 5 blocs éditables d'une campagne (Session 6).
 *
 * Pattern : un seul bloc déplié à la fois pour limiter la charge
 * visuelle et conserver une UX prévisible. Le bloc Seuil est déplié
 * par défaut — c'est celui le plus souvent modifié en démo.
 */

import { useState, type ReactNode } from 'react';

import type { ActiveCampaign } from '@/stores/campaigns-store';
import { VivierPreselectionPanel } from '@/components/vivier/VivierPreselectionPanel';

import { ChannelsEditBlock } from './ChannelsEditBlock';
import { FDPEditBlock } from './FDPEditBlock';
import { FluxEditBlock } from './FluxEditBlock';
import { LifecycleEditBlock } from './LifecycleEditBlock';
import { DecisionThresholdsBlock } from './DecisionThresholdsBlock';
import { ScoringEditBlock } from './ScoringEditBlock';

export type CampaignEditAccordionProps = {
  campaign: ActiveCampaign;
  onClose: () => void;
};

type BlockKey =
  | 'fdp'
  | 'scoring'
  | 'channels'
  | 'flux'
  | 'vivier'
  | 'threshold'
  | 'lifecycle';

export function CampaignEditAccordion({
  campaign,
  onClose,
}: CampaignEditAccordionProps) {
  const [expanded, setExpanded] = useState<BlockKey | null>('threshold');

  const toggle = (key: BlockKey) =>
    setExpanded(expanded === key ? null : key);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <AccordionItem
        title="Fiche de poste"
        subtitle={
          campaign.fdp.isValidated
            ? 'Validée — édition inline'
            : 'En cours de cadrage'
        }
        icon="📄"
        open={expanded === 'fdp'}
        onToggle={() => toggle('fdp')}
      >
        <FDPEditBlock campaign={campaign} />
      </AccordionItem>
      <AccordionItem
        title="Fiche de scoring"
        subtitle={
          campaign.scoringSheet?.isValidated
            ? `${campaign.scoringSheet.criteria.length} critères validés`
            : campaign.scoringSheet
              ? 'Proposée — à revalider'
              : 'Pas encore proposée'
        }
        icon="⚖️"
        open={expanded === 'scoring'}
        onToggle={() => toggle('scoring')}
      >
        <ScoringEditBlock campaign={campaign} />
      </AccordionItem>
      <AccordionItem
        title="Canaux de diffusion"
        subtitle={`${campaign.publishedChannels.length} actif${campaign.publishedChannels.length > 1 ? 's' : ''}`}
        icon="📢"
        open={expanded === 'channels'}
        onToggle={() => toggle('channels')}
      >
        <ChannelsEditBlock campaign={campaign} />
      </AccordionItem>
      <AccordionItem
        title="Flux de réception"
        subtitle={`${campaign.sources.length} flux actif${campaign.sources.length > 1 ? 's' : ''}`}
        icon="📥"
        open={expanded === 'flux'}
        onToggle={() => toggle('flux')}
      >
        <FluxEditBlock campaign={campaign} />
      </AccordionItem>
      {campaign.sources.includes('vivier') ? (
        <AccordionItem
          title="Vivier — présélection"
          subtitle="Short-list issue de votre stock interne"
          icon="🗂️"
          open={expanded === 'vivier'}
          onToggle={() => toggle('vivier')}
        >
          <VivierPreselectionPanel campaignId={campaign.id} />
        </AccordionItem>
      ) : null}
      <AccordionItem
        title="Seuils de décision"
        subtitle={
          campaign.thresholdLow === campaign.thresholdHigh
            ? `Tout automatique au seuil ${campaign.thresholdLow}`
            : `Validation ${campaign.thresholdLow}–${campaign.thresholdHigh} · appliqué aux prochains CV`
        }
        icon="🎚️"
        open={expanded === 'threshold'}
        onToggle={() => toggle('threshold')}
      >
        <DecisionThresholdsBlock campaign={campaign} />
      </AccordionItem>
      <AccordionItem
        title="Cycle de vie"
        subtitle={statusLabel(campaign.status)}
        icon="🛟"
        open={expanded === 'lifecycle'}
        onToggle={() => toggle('lifecycle')}
      >
        <LifecycleEditBlock campaign={campaign} onClose={onClose} />
      </AccordionItem>
    </div>
  );
}

function statusLabel(status: ActiveCampaign['status']): string {
  const map: Record<ActiveCampaign['status'], string> = {
    draft: 'Brouillon',
    in_progress: 'En cours de cadrage',
    active: 'Active — flux ouvert',
    paused: 'Suspendue',
    closed: 'Clôturée',
  };
  return map[status];
}

function AccordionItem({
  title,
  subtitle,
  icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  icon: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        border: `1px solid ${open ? 'var(--dash-border-strong)' : 'var(--dash-border)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--dash-surface)',
        transition: 'border-color 0.15s',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 16px',
          background: open ? 'var(--dash-warm)' : 'transparent',
          border: 'none',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span aria-hidden style={{ fontSize: 18 }}>
          {icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="font-display"
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--dash-text)',
            }}
          >
            {title}
          </div>
          <div
            className="font-body"
            style={{
              fontSize: 12,
              color: 'var(--dash-text-secondary)',
              marginTop: 1,
            }}
          >
            {subtitle}
          </div>
        </div>
        <span
          aria-hidden
          style={{
            color: 'var(--dash-text-tertiary)',
            fontSize: 14,
            transition: 'transform 0.2s',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          ▾
        </span>
      </button>
      {open ? <div style={{ padding: '12px 16px 18px' }}>{children}</div> : null}
    </section>
  );
}
