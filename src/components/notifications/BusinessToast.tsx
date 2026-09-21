'use client';

/**
 * Toast MÉTIER agrégé (coin bas-droite) — « des actions vous attendent ».
 *
 * Le titre ne nomme plus les candidats : tous les signaux ne portent pas sur
 * un dossier (un jour férié non bloqué est un RÉGLAGE à corriger), et un
 * bandeau qui annonce autre chose que son contenu se fait ignorer.
 *
 * Anti-harcèlement :
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
    // ⚠️ `pointer-events-none` sur le CADRE, `pointer-events-auto` sur ce qui
    // se clique dedans. Sans ça, le bandeau — posé en bas à droite sur ~230 px
    // — AVALE les clics destinés à la page : il recouvrait le bouton
    // « Activer la campagne » de l'assistant de création, et cliquer dessus
    // atteignait la notification. Défaut trouvé en cliquant (S30.6), invisible
    // à la lecture : les deux composants ne se connaissent pas. Une notice
    // n'est pas une porte — elle informe, elle ne doit rien intercepter.
    <aside
      role="status"
      aria-label="Actions en attente"
      className="pointer-events-none absolute bottom-6 right-6 z-40 w-[340px] rounded-xl border border-dash-orange/40 bg-dash-orange-light"
    >
      <header className="flex items-center justify-between gap-2 border-b border-dash-orange/20 px-4 py-2.5">
        <p className="font-display text-[13px] font-bold text-dash-text">
          <span aria-hidden className="mr-1.5">⏳</span>
          Des actions vous attendent
        </p>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Fermer la notification"
          className="pointer-events-auto rounded-md px-1.5 py-0.5 font-body text-[13px] text-dash-text-secondary hover:bg-dash-orange/10 hover:text-dash-text"
        >
          ✕
        </button>
      </header>
      <div className="flex flex-col gap-3 px-4 py-3">
        {signals.map((signal) => (
          <div key={signal.key}>
            <p className="font-body text-[12.5px] leading-relaxed text-dash-text">
              {signal.message}
            </p>
            <button
              type="button"
              onClick={() => {
                setVisible(false);
                onNavigate(signal.target);
              }}
              className="pointer-events-auto mt-1 font-body text-[12px] font-semibold text-dash-text underline decoration-dash-blue/60 underline-offset-2 hover:decoration-dash-blue"
            >
              → {signal.ctaLabel}
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
