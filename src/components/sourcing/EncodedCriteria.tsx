'use client';

import { useState } from 'react';

import type { NotEncodedCriterion } from '@/types/sourcing';

const VISIBLE_NOT_ENCODED = 3;

/** Ce que la requête cherche, et ce qu'elle ne cherche pas — dit AVANT de lancer. */
export function EncodedCriteria({ encoded, notEncoded }: { encoded: string[]; notEncoded: NotEncodedCriterion[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? notEncoded : notEncoded.slice(0, VISIBLE_NOT_ENCODED);
  const hidden = notEncoded.length - shown.length;

  return (
    <div className="flex flex-col gap-1 font-body text-[12px] text-stone-600">
      <p>
        <span className="font-semibold text-stone-700">Critères encodés : </span>
        {encoded.length > 0 ? encoded.join(' · ') : 'aucun'}
      </p>
      {notEncoded.length > 0 ? (
        <p>
          <span className="font-semibold text-stone-700">Non encodés : </span>
          {shown.map((n) => `${n.label} (${n.reason})`).join(' · ')}
          {hidden > 0 ? (
            <>
              {' · '}
              <button type="button" onClick={() => setExpanded(true)} className="font-semibold text-stone-700 hover:text-stone-900">
                {hidden} de plus ▾
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
