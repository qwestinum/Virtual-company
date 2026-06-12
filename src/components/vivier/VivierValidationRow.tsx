'use client';

/**
 * Une ligne de la section Validation vivier (Session V3, §5.2/5.3).
 * Vue COMPACTE par défaut (identité, score, fraîcheur, badge d'historique) ;
 * vue DÉTAILLÉE au clic (filtres durs + entités, tags, historique de
 * sollicitation, lien vers le dossier). Décisions unitaires + case de sélection
 * pour les décisions en masse. Composant autonome (données par props).
 */

import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import { useState } from 'react';

import { freshnessLabel } from '@/lib/vivier/freshness-label';
import type { ShortlistEntry } from '@/types/vivier-preselection';

type Detail = {
  tags: string[];
  cvFileName: string | null;
  cvText: string | null;
  history: {
    campaignId: string;
    state: 'identified' | 'contacted' | 'rejected';
    contactedAt: string | null;
    appliedAt: string | null;
  }[];
};

/** Badge d'historique : contacté ailleurs auparavant (hors campagne courante). */
function priorContact(
  history: Detail['history'],
  currentCampaignId: string,
): string | null {
  const prior = history.find(
    (h) => h.state === 'contacted' && h.campaignId !== currentCampaignId && h.contactedAt,
  );
  if (!prior?.contactedAt) return null;
  return `contacté ${freshnessLabel(prior.contactedAt)} (${prior.campaignId})`;
}

export function VivierValidationRow({
  entry,
  campaignId,
  selected,
  busy,
  onToggleSelect,
  onDecide,
}: {
  entry: ShortlistEntry;
  campaignId: string;
  selected: boolean;
  busy: boolean;
  onToggleSelect: () => void;
  onDecide: (decision: 'accept' | 'reject') => void;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const score = Math.round(entry.relevanceScore * 100);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      try {
        const res = await fetch(`/api/vivier/${entry.candidateId}`);
        if (res.ok) {
          const d = await res.json();
          setDetail({
            tags: d.candidate?.tags ?? [],
            cvFileName: d.candidate?.cvFileName ?? null,
            cvText: d.candidate?.cvText ?? null,
            history: d.history ?? [],
          });
        }
      } catch {
        /* silencieux : le détail reste indisponible */
      }
    }
  }

  const badge = detail ? priorContact(detail.history, campaignId) : null;

  return (
    <li className="rounded-lg border border-stone-200 bg-white">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 shrink-0 accent-emerald-600"
          aria-label={`Sélectionner ${entry.nom}`}
        />
        <button
          type="button"
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
          <span className="min-w-0">
            <span className="block truncate font-body text-[13px] font-semibold text-stone-800">
              {entry.nom}
            </span>
            <span className="block truncate font-body text-[11px] text-stone-400">
              {entry.email}
              {badge ? ` · ${badge}` : ''}
            </span>
          </span>
        </button>
        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 font-body text-[12px] font-semibold text-emerald-700">
          {score}%
        </span>
        <span className="hidden shrink-0 font-body text-[11px] text-stone-500 sm:inline">
          {freshnessLabel(entry.updatedAt)}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onDecide('accept')}
            disabled={busy}
            title="Accepter la prise de contact"
            className="rounded-md bg-emerald-600 p-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Check className="h-4 w-4" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={() => onDecide('reject')}
            disabled={busy}
            title="Rejeter"
            className="rounded-md border border-stone-200 p-1.5 text-stone-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-stone-100 px-3 py-3 font-body text-[12px] text-stone-600">
          <p className="mb-1 text-stone-500">
            Similarité {Math.round(entry.similarity * 100)}% · fraîcheur ×
            {entry.freshnessFactor.toFixed(2)}
          </p>
          {entry.passedFilters.length > 0 ? (
            <p className="mb-1">
              <span className="font-semibold">Filtres durs : </span>
              {entry.passedFilters
                .map((f) => `${f.label} (${f.matchedTerms.join(', ')})`)
                .join(' · ')}
            </p>
          ) : null}
          {detail?.tags.length ? (
            <p className="mb-1">
              <span className="font-semibold">Tags : </span>
              {detail.tags.join(', ')}
            </p>
          ) : null}
          {detail?.history
            .filter((h) => h.appliedAt)
            .map((h) => (
              <p key={`applied-${h.campaignId}`} className="mb-1 text-emerald-700">
                A postulé à la campagne {h.campaignId} le{' '}
                {freshnessLabel(h.appliedAt as string)}
              </p>
            ))}

          {/* Accès au CV : ouverture du fichier d'origine + aperçu du texte. */}
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <a
              href={`/api/vivier/${entry.candidateId}/cv`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-emerald-700 hover:underline"
            >
              Ouvrir le CV{detail?.cvFileName ? ` (${detail.cvFileName})` : ''}
            </a>
            <a href="/vivier" className="text-stone-500 hover:underline">
              Ouvrir le dossier vivier
            </a>
          </div>
          {detail?.cvText ? (
            <details className="mt-1">
              <summary className="cursor-pointer select-none font-semibold text-stone-600">
                Aperçu du CV (texte extrait)
              </summary>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-stone-200 bg-stone-50 p-2 font-body text-[11px] leading-relaxed text-stone-700">
                {detail.cvText}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
