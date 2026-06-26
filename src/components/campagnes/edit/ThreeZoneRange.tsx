'use client';

/**
 * Slider à DEUX poignées sur une SEULE piste (HITL 3 zones, lot 2).
 *
 * Deux <input type=range> superposés sur la même piste : leur rail est
 * transparent (`pointer-events:none`) et seules les POIGNÉES sont
 * interactives (`pointer-events:auto`) — c'est le motif standard du
 * double-range natif. La piste affiche les 3 zones (rouge refus auto / ambre
 * validation / vert acceptation auto) via un dégradé à bords nets qui suit les
 * seuils en direct. Invariant bas ≤ haut garanti ici (les poignées ne se
 * croisent pas). La poignée BASSE a un z-index supérieur → toujours saisissable
 * quand les deux se chevauchent (poignées collées).
 */

export type ThreeZoneRangeProps = {
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
  /** Appelé à la relâche (persistance débouncée côté appelant). Optionnel. */
  onCommit?: () => void;
};

const CSS = `
.tzr { position: relative; height: 30px; }
.tzr-track {
  position: absolute; left: 0; right: 0; top: 12px; height: 6px;
  border-radius: 3px;
}
.tzr-input {
  position: absolute; left: 0; top: 0; width: 100%; height: 30px;
  margin: 0; background: transparent; pointer-events: none;
  -webkit-appearance: none; appearance: none;
}
.tzr-input:focus { outline: none; }
.tzr-input::-webkit-slider-runnable-track { background: transparent; height: 30px; }
.tzr-input::-moz-range-track { background: transparent; height: 30px; }
.tzr-input::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; pointer-events: auto;
  width: 18px; height: 18px; border-radius: 50%; margin-top: 6px;
  background: #fff; border: 2px solid var(--dash-text-secondary);
  box-shadow: 0 1px 3px rgba(0,0,0,0.3); cursor: pointer;
}
.tzr-input::-moz-range-thumb {
  pointer-events: auto; width: 18px; height: 18px; border-radius: 50%;
  background: #fff; border: 2px solid var(--dash-text-secondary);
  box-shadow: 0 1px 3px rgba(0,0,0,0.3); cursor: pointer;
}
`;

export function ThreeZoneRange({
  low,
  high,
  onChange,
  onCommit,
}: ThreeZoneRangeProps) {
  const onLow = (v: number) => onChange(Math.min(v, high), high);
  const onHigh = (v: number) => onChange(low, Math.max(v, low));
  const commit = () => onCommit?.();

  return (
    <div className="tzr">
      <style>{CSS}</style>
      <div
        className="tzr-track"
        style={{
          background: `linear-gradient(to right,
            var(--dash-red) 0 ${low}%,
            var(--dash-orange) ${low}% ${high}%,
            var(--dash-green) ${high}% 100%)`,
        }}
      />
      {/* Poignée BASSE — z-index supérieur (saisissable même collée à la haute). */}
      <input
        className="tzr-input"
        style={{ zIndex: 4 }}
        type="range"
        min={0}
        max={100}
        step={1}
        value={low}
        onChange={(e) => onLow(Number(e.currentTarget.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        aria-label="Seuil bas (refus automatique en dessous)"
      />
      {/* Poignée HAUTE. */}
      <input
        className="tzr-input"
        style={{ zIndex: 3 }}
        type="range"
        min={0}
        max={100}
        step={1}
        value={high}
        onChange={(e) => onHigh(Number(e.currentTarget.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        aria-label="Seuil haut (acceptation automatique au-dessus)"
      />
    </div>
  );
}
