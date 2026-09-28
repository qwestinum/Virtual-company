'use client';

/**
 * Un résultat de la recherche par mot-clé (28/09/2026) — traité comme un
 * profil proposé : dépliable (pourquoi, synthèse, historique, CV) et porteur
 * des MÊMES gestes (« CV », « Écarter », « Inviter »). Un profil déjà
 * contacté ou déjà écarté pour cette campagne le dit, et ne propose plus que
 * ce qui a encore un sens.
 */

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import type { VivierKeywordResult } from '@/types/vivier-keyword-search';

import { MembershipBadge, Snippet } from './VivierKeywordParts';
import { VivierActions } from './VivierActions';
import { VivierProfileDetail } from './VivierProfileDetail';

export function VivierKeywordResultRow({
  result: r,
  campaignId,
  why,
  busy,
  locked,
  onPreview,
  onReject,
  onInvite,
}: {
  result: VivierKeywordResult;
  campaignId: string;
  why: string[];
  busy: boolean;
  locked: boolean;
  onPreview: () => void;
  onReject: () => void;
  onInvite: () => void;
}) {
  const [open, setOpen] = useState(false);
  const name = [r.prenom, r.nom].filter(Boolean).join(' ') || r.nom;
  // Un profil écarté pour cette campagne peut encore être invité (on change
  // d'avis) ; un profil proposé ou contacté se traite ailleurs.
  const decidable = r.membership === 'none' || r.membership === 'rejected';

  return (
    <li className="rounded-md border border-stone-200 bg-white">
      <div className="flex items-start justify-between gap-3 p-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          data-role="vivier-expand"
          title={open ? 'Replier' : 'Synthèse et historique'}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          <ChevronDown
            className={`mt-0.5 h-4 w-4 shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
          <span className="min-w-0">
            <span className="block truncate font-body text-[13px] font-semibold text-stone-800">{name}</span>
            <span className="block truncate font-body text-[11px] text-stone-500">{r.title ?? 'Poste non précisé'}</span>
          </span>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {r.membership !== 'none' ? <MembershipBadge membership={r.membership} /> : null}
          {decidable ? (
            <VivierActions
              busy={busy}
              locked={locked}
              onPreview={onPreview}
              onReject={r.membership === 'none' ? onReject : undefined}
              onInvite={onInvite}
            />
          ) : null}
        </div>
      </div>
      <div className="px-2.5 pb-2.5">
        <Snippet text={r.snippet} />
      </div>
      {open ? <VivierProfileDetail candidateId={r.candidateId} campaignId={campaignId} why={why} onPreview={onPreview} /> : null}
    </li>
  );
}
