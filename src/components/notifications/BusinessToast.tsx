'use client';

/**
 * Toast MÉTIER agrégé (coin bas-droite) — « des candidats attendent votre
 * action ». Anti-harcèlement :
 *   - affiché UNE fois par session (sessionStorage), même après navigation ;
 *   - dismissable (mémorisé pour la session) ;
 *   - rien à afficher = rien de rendu (pas de « tout va bien ») ;
 *   - un SEUL toast même si plusieurs signaux (une section cliquable chacun).
 * Ambre ORQA (en attente, pas d'alarme), fondu court, aucune animation
 * agressive.
 */
import { useEffect, useState } from 'react';

import type { BusinessSignal, BusinessSignalTarget } from '@/types/notifications';

const SESSION_KEY = 'orqa_business_toast_seen_v1';

export function BusinessToast({
  signals,
  onNavigate,
}: {
  signals: BusinessSignal[];
  onNavigate: (target: BusinessSignalTarget) => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (signals.length === 0) return;
    try {
      if (window.sessionStorage.getItem(SESSION_KEY)) return;
      // Marqué « vu » dès l'affichage : une navigation ou un reload ne le
      // re-présentera pas — le badge d'onglet prend le relais.
      window.sessionStorage.setItem(SESSION_KEY, new Date().toISOString());
    } catch {
      // sessionStorage indisponible → on affiche quand même (dismiss local).
    }
    setVisible(true);
  }, [signals]);

  if (!visible || signals.length === 0) return null;

  return (
    <aside
      role="status"
      aria-label="Actions en attente"
      className="absolute bottom-6 right-6 z-40 w-[340px] rounded-xl border border-orqa-ambre/40 bg-orqa-ambre-bg shadow-orqa-lg"
    >
      <header className="flex items-center justify-between gap-2 border-b border-orqa-ambre/20 px-4 py-2.5">
        <p className="font-display text-[13px] font-bold text-orqa-encre">
          <span aria-hidden className="mr-1.5">⏳</span>
          Des candidats attendent votre action
        </p>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Fermer la notification"
          className="rounded-md px-1.5 py-0.5 font-body text-[13px] text-orqa-gris hover:bg-orqa-ambre/10 hover:text-orqa-encre"
        >
          ✕
        </button>
      </header>
      <div className="flex flex-col gap-3 px-4 py-3">
        {signals.map((signal) => (
          <div key={signal.key}>
            <p className="font-body text-[12.5px] leading-relaxed text-orqa-encre">
              {signal.message}
            </p>
            <button
              type="button"
              onClick={() => {
                setVisible(false);
                onNavigate(signal.target);
              }}
              className="mt-1 font-body text-[12px] font-semibold text-orqa-nuit underline decoration-orqa-ciel/60 underline-offset-2 hover:decoration-orqa-ciel"
            >
              → {signal.ctaLabel}
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
