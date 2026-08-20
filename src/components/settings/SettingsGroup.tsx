'use client';

/**
 * Intertitre de famille dans /settings.
 *
 * Treize sections à plat, même repliées, restent une liste à lire en entier.
 * Regroupées par ce qu'on vient y faire (« qui décide », « qui écrit à qui »,
 * « avec quoi »), on saute directement à la bonne famille.
 */

export function SettingsGroup({ label }: { label: string }) {
  return (
    <h2 className="mt-2 font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
      {label}
    </h2>
  );
}
