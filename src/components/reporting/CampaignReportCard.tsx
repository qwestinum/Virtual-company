'use client';

/**
 * Ligne d'une campagne clôturée (cf. docs/specs/reporting.md §3.3). Lisible en
 * 5 s : poste + référence, période, volumes, issue, actions Générer / Envoyer
 * (+ menu Régénérer). Lecture seule.
 *
 * ⚠️ LA LIGNE DE CANDIDATURES, importée (`ListRow`). C'était une carte à cinq
 * étages — titre, donneur, volumes, mentions, barre d'actions — qui prenait
 * cinq fois la hauteur d'une ligne de candidature pour la même information, et
 * ne ressemblait à rien d'autre dans le produit.
 */

import { Download, MoreVertical, RefreshCw, Send } from 'lucide-react';
import { useState } from 'react';

import { ListRow } from '@/components/ui/ListRow';
import { SegmentedCounts } from '@/components/ui/SegmentedCounts';
import { formatFrDate } from '@/lib/reporting/audit-display';
import {
  CAMPAIGN_ISSUE_LABELS,
  donneurOrdreLabel,
  generatedMention,
  sentMention,
} from '@/lib/reporting/campaign-report-display';
import type { CampaignReportSummary } from '@/types/reporting';

export function CampaignReportCard({
  summary,
  onOpen,
  onGenerate,
  onRegenerate,
  onSend,
  onShowHistory,
}: {
  summary: CampaignReportSummary;
  onOpen: () => void;
  onGenerate: () => void;
  onRegenerate: () => void;
  onSend: () => void;
  onShowHistory: () => void;
}) {
  const { volumes } = summary;
  const sent = sentMention(summary);
  const generated = generatedMention(summary);
  const recruited = summary.issue === 'recruited';

  return (
    // ⚠️ La ligne ouvre le rapport, et elle porte des boutons : c'est donc un
    // conteneur `role="button"`, jamais un `<button>` — un bouton dans un
    // bouton n'est pas du HTML, et poser les actions PAR-DESSUS la ligne les
    // ferait chevaucher la pastille d'issue.
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer"
    >
      <ListRow
        testId={summary.campaignId}
        // Pas de pavé d'initiales : l'objet de la ligne est une CAMPAGNE, pas
        // une personne. « BA » pour « Business Analyst » la faisait passer
        // pour un candidat dans une liste de candidats.
        title={summary.jobTitle}
        // La puce ne s'affiche que s'il y a quelqu'un : une puce « — » occupe
        // la place d'une information sans en porter aucune.
        pill={summary.donneurOrdre ? donneurOrdreLabel(summary) : null}
        reference={summary.campaignId}
        meta={`${formatFrDate(summary.launchedAt)} – ${formatFrDate(
          summary.closedAt,
        )} · ${summary.durationDays} jours`}
        right={
          <>
            {/* ⚠️ L'ENTONNOIR EN SEGMENTS COLORÉS, la géométrie du
                mini-pipeline de Candidatures. C'étaient cinq nombres gris de
                même poids qu'il fallait lire un par un ; le segment porte la
                couleur de l'étape et le nombre la reprend. */}
            <span className="hidden lg:block">
              <SegmentedCounts
                items={[
                  { label: 'reçues', count: volumes.received, color: 'var(--dash-blue)' },
                  { label: 'retenus', count: volumes.retained, color: 'var(--dash-green)' },
                  { label: 'écartés', count: volumes.rejected, color: 'var(--dash-red)' },
                  { label: 'en attente', count: volumes.enAttente, color: 'var(--dash-yellow)' },
                  ...(volumes.classeeSansSuite > 0
                    ? [
                        {
                          label: 'sans suite',
                          count: volumes.classeeSansSuite,
                          color: 'var(--dash-text-tertiary)',
                        },
                      ]
                    : []),
                ]}
              />
            </span>

            <span
              className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 font-body text-[11px] font-semibold"
              style={
                recruited
                  ? { background: 'var(--dash-green-light)', color: 'var(--dash-green)' }
                  : { background: 'var(--dash-warm)', color: 'var(--dash-text-secondary)' }
              }
            >
              {recruited
                ? `${CAMPAIGN_ISSUE_LABELS.recruited} (${summary.recruitedCount})`
                : CAMPAIGN_ISSUE_LABELS.no_hire}
            </span>

            <span
              className="flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <Secondaire
                onClick={onGenerate}
                icon={<Download className="h-3.5 w-3.5" aria-hidden />}
              >
                Générer
              </Secondaire>
              <Secondaire
                onClick={onSend}
                icon={<Send className="h-3.5 w-3.5" aria-hidden />}
              >
                Envoyer
              </Secondaire>
              <Menu
                onRegenerate={onRegenerate}
                onShowHistory={sent ? onShowHistory : undefined}
                sent={sent}
                generated={generated}
              />
            </span>
          </>
        }
      />
    </div>
  );
}

/** Action secondaire : bordure fine, pas de couleur pleine, pas d'ombre. */
function Secondaire({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 font-body text-[12px] font-semibold"
      style={{ borderColor: 'var(--dash-border-strong)', color: 'var(--dash-text-secondary)' }}
    >
      {icon}
      {children}
    </button>
  );
}

function Menu({
  onRegenerate,
  onShowHistory,
  sent,
  generated,
}: {
  onRegenerate: () => void;
  onShowHistory?: () => void;
  sent: string | null;
  generated: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="grid h-8 w-8 place-items-center rounded-lg"
        style={{ color: 'var(--dash-text-tertiary)' }}
        aria-label="Plus d’options"
      >
        <MoreVertical className="h-4 w-4" aria-hidden />
      </button>
      {open ? (
        <>
          <span className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <span
            className="absolute right-0 z-20 mt-1 flex w-56 flex-col rounded-lg border bg-white py-1 shadow-lg"
            style={{ borderColor: 'var(--dash-border)' }}
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onRegenerate();
              }}
              className="flex items-center gap-2 px-3 py-1.5 text-left font-body text-[13px]"
              style={{ color: 'var(--dash-text)' }}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Régénérer
            </button>
            {/* Les mentions « envoyé le… » / « généré le… » vivaient sur la
                carte et l'allongeaient d'une ligne pour une information qu'on
                consulte rarement. Elles restent, ici. */}
            {sent ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onShowHistory?.();
                }}
                className="px-3 py-1.5 text-left font-body text-[12px]"
                style={{ color: 'var(--dash-text-secondary)' }}
              >
                {sent}
              </button>
            ) : null}
            {generated ? (
              <span
                className="px-3 py-1.5 font-body text-[12px]"
                style={{ color: 'var(--dash-text-tertiary)' }}
              >
                {generated}
              </span>
            ) : null}
          </span>
        </>
      ) : null}
    </span>
  );
}
