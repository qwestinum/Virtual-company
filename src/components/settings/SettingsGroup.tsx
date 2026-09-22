'use client';

/**
 * FAMILLE de réglages dans /settings — repliable.
 *
 * Treize sections à plat, même repliées, restent une liste à lire en entier.
 * Regroupées par ce qu'on vient y faire (« qui décide », « qui écrit à qui »,
 * « avec quoi »), on saute directement à la bonne famille — et depuis le
 * 22/09/2026, on peut replier celles dont on n'a pas besoin.
 *
 * ⚠️ DÉPLIÉES PAR DÉFAUT, contrairement aux sections qu'elles contiennent.
 * Les sections partent repliées pour que la page devienne une liste qu'on
 * parcourt ; replier AUSSI les familles cacherait la page entière derrière
 * quatre titres, et il faudrait deux clics pour atteindre n'importe quel
 * réglage.
 *
 * ⚠️ Le compte de sections est écrit sur l'intertitre. Replier une famille
 * fait disparaître ce qu'elle contient : sans le nombre, on ne sait plus si on
 * a caché deux réglages ou six.
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useId } from 'react';

export function SettingsGroup({
  label,
  open = true,
  onToggle,
  count,
  children,
}: {
  label: string;
  open?: boolean;
  onToggle?: () => void;
  /** Combien de sections la famille contient. */
  count?: number;
  children?: React.ReactNode;
}) {
  const panneau = useId();

  // Sans bascule, la famille reste l'intertitre qu'elle a toujours été.
  if (!onToggle) {
    return (
      <h2 className="mt-2 font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
        {label}
      </h2>
    );
  }

  return (
    <div className="mt-2">
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panneau}
          data-settings-group={label}
          className="flex w-full items-center gap-2 rounded-lg py-1 text-left font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500 hover:text-stone-800"
        >
          {open ? (
            <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
          )}
          {label}
          {count !== undefined ? (
            <span className="font-data text-[10px] font-semibold normal-case tracking-normal text-stone-400">
              {count} réglage{count > 1 ? 's' : ''}
            </span>
          ) : null}
        </button>
      </h2>
      {open ? (
        <div id={panneau} className="mt-3 flex flex-col gap-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
