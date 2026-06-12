'use client';

/**
 * Lien de navigation « Validations vivier » avec badge global (Session V3, §5).
 * Autonome : charge une fois le total de prises de contact en attente (toutes
 * campagnes). Pas de badge si 0 ou si l'API est indisponible (démo sans DB).
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

export function VivierValidationsLink() {
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let active = true;
    fetch('/api/vivier/validations')
      .then((res) => (res.ok ? res.json() : { total: 0 }))
      .then((data: { total?: number }) => {
        if (active) setPending(data.total ?? 0);
      })
      .catch(() => {
        /* silencieux : pas de badge */
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <Link
      href="/validations-vivier"
      className="flex items-center gap-1.5 font-body text-[13px] font-semibold text-stone-900/85 transition-opacity hover:opacity-70"
    >
      Validations vivier
      {pending > 0 ? (
        <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-emerald-600 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">
          {pending}
        </span>
      ) : null}
    </Link>
  );
}
