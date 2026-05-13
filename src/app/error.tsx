'use client';

/**
 * Error boundary racine — filet de sécurité runtime.
 *
 * Convention Next.js App Router : `app/error.tsx` enveloppe les routes
 * frères/sœurs dans une React Error Boundary. Si jamais `<Lobby />`
 * (ou n'importe quel composant client de la home) throw à l'hydratation
 * ou au render, l'utilisateur voit cette page minimaliste plutôt qu'un
 * écran blanc ou un 500 brut. Lien direct vers `/rh` pour qu'il puisse
 * continuer son travail.
 *
 * Le composant doit être client (`'use client'`) parce qu'il reçoit
 * `error` (Error) et `reset` (fn) en props depuis le runtime React.
 */

import Link from 'next/link';
import { useEffect } from 'react';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log côté navigateur — utile pour debug Vercel via la devtools
    // console quand le serveur n'a plus de visibilité sur l'erreur.
    console.error('[RootError] Lobby render failed:', error);
  }, [error]);

  return (
    <main
      className="relative flex min-h-[100svh] flex-col items-center justify-center px-6 py-10"
      style={{
        background:
          'radial-gradient(ellipse at top, #fdfcf9 0%, #f3f1ec 70%, #ebe8e1 100%)',
      }}
    >
      <div className="mx-auto flex max-w-md flex-col items-center gap-5 text-center">
        <div
          aria-hidden
          className="flex h-14 w-14 items-center justify-center rounded-2xl text-[26px] text-white shadow-sm"
          style={{ background: 'linear-gradient(135deg, #FFB000, #FF8A00)' }}
        >
          🧑‍💼
        </div>

        <div>
          <p className="font-display text-[10.5px] uppercase tracking-[0.18em] text-stone-500 font-semibold">
            QWESTINUM — Entreprise virtuelle
          </p>
          <h1 className="font-display text-[24px] font-bold tracking-tight text-stone-900 leading-tight mt-1">
            Accueil temporairement indisponible
          </h1>
          <p className="font-body text-[14px] text-stone-600 mt-3 leading-relaxed">
            Le Lobby n&apos;a pas pu s&apos;afficher. Vous pouvez accéder
            directement au département RH, ou recharger l&apos;accueil.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/rh"
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 font-display text-[13px] font-bold text-white shadow-sm transition-transform hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, #FFB000, #FF8A00)' }}
          >
            Aller au département RH
            <span aria-hidden>→</span>
          </Link>
          <button
            type="button"
            onClick={reset}
            className="rounded-xl border border-stone-300 bg-white px-4 py-2 font-body text-[13px] font-semibold text-stone-800 hover:bg-stone-50"
          >
            Recharger
          </button>
        </div>

        {error.digest ? (
          <p className="font-data text-[10.5px] text-stone-400">
            ref&nbsp;: {error.digest}
          </p>
        ) : null}
      </div>
    </main>
  );
}
