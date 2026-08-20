/**
 * Feuille de style des surfaces publiques — CSS brut, volontairement.
 *
 * Pas de framework, pas de jeton de design emprunté à l'application hôte : le
 * module doit pouvoir être installé ailleurs sans traîner un système de style.
 * Tout ce qui peut varier passe par quatre variables CSS que l'hôte peut
 * redéfinir depuis l'extérieur (`--sched-accent` en tête).
 *
 * Priorité au téléphone : ces pages s'ouvrent depuis un email, sur un écran
 * tenu à une main. Les cibles tactiles font au moins 44 px, la grille de
 * créneaux tient en trois colonnes, et rien n'exige de zoomer.
 *
 * L'identité visuelle de l'installation (logo, couleur d'accent) n'est PAS
 * codée en dur ici : elle arrive par `brandRootStyle`, qui redéfinit la
 * variable d'accent sur la racine. Sans configuration, la palette par défaut
 * s'applique — et le mode sombre continue de fonctionner.
 */
import type { CSSProperties } from 'react';

import type { ResolvedBranding } from '../runtime';

/**
 * Style de racine porteur de l'accent choisi. Retourne un objet VIDE quand
 * rien n'est configuré : on ne veut pas écraser la variable du thème (ni,
 * surtout, sa version sombre) avec une valeur nulle.
 */
export function brandRootStyle(brand: ResolvedBranding | null): CSSProperties {
  if (!brand?.accentColor) return {};
  return { ['--sched-accent' as string]: brand.accentColor } as CSSProperties;
}

export const SCHEDULING_CSS = `
.sched-root {
  --sched-accent: #2f6d7a;
  --sched-accent-ink: #ffffff;
  --sched-ink: #22201b;
  --sched-muted: #6b6862;
  --sched-line: #e3e0d8;
  --sched-surface: #ffffff;
  --sched-paper: #f7f6f2;
  --sched-soft: #e4f0f2;
  --sched-warn: #8a6413;
  --sched-warn-bg: #f7eed6;
  --sched-stop: #9c4331;
  --sched-stop-bg: #f7e6e1;
  --sched-radius: 10px;

  min-height: 100vh;
  margin: 0;
  padding: 20px 16px 56px;
  background: var(--sched-paper);
  color: var(--sched-ink);
  font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.sched-shell { max-width: 460px; margin: 0 auto; }
.sched-brand { max-width: 460px; margin: 0 auto 14px; text-align: center; }
.sched-brand img { max-height: 44px; max-width: 200px; width: auto; height: auto; }
.sched-card {
  background: var(--sched-surface);
  border: 1px solid var(--sched-line);
  border-radius: var(--sched-radius);
  padding: 18px 16px 20px;
}
.sched-org {
  font-size: 11px; text-transform: uppercase; letter-spacing: .11em;
  color: var(--sched-muted); margin: 0 0 2px;
}
.sched-title { font-size: 21px; font-weight: 600; line-height: 1.22; margin: 0 0 4px; }
.sched-meta { font-size: 13px; color: var(--sched-muted); margin: 0; }
.sched-note { font-size: 13px; color: var(--sched-muted); }

.sched-tz {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  background: var(--sched-soft); border-radius: 8px;
  padding: 8px 10px; margin: 14px 0 6px; font-size: 13px;
}
.sched-tz-btn {
  font: inherit; color: var(--sched-accent); background: none; border: 0;
  padding: 4px; text-decoration: underline; cursor: pointer; min-height: 32px;
}
.sched-tz-select {
  width: 100%; margin-top: 8px; padding: 10px; font: inherit;
  border: 1px solid var(--sched-line); border-radius: 8px;
  background: var(--sched-surface); color: var(--sched-ink); min-height: 44px;
}

.sched-week {
  display: flex; align-items: center; justify-content: space-between;
  margin: 12px 0 2px; font-size: 14px; font-weight: 600;
}
.sched-week-btn {
  font: inherit; background: none; border: 1px solid var(--sched-line);
  border-radius: 8px; color: var(--sched-ink); cursor: pointer;
  min-width: 44px; min-height: 40px; line-height: 1;
}
.sched-week-btn[disabled] { opacity: .35; cursor: default; }

.sched-day {
  font-size: 12px; text-transform: uppercase; letter-spacing: .06em;
  color: var(--sched-muted); margin: 18px 0 8px;
}
.sched-slots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.sched-slot {
  font: inherit; font-size: 15px; font-variant-numeric: tabular-nums;
  min-height: 46px; border: 1px solid var(--sched-line); border-radius: 8px;
  background: var(--sched-surface); color: var(--sched-ink); cursor: pointer;
}
.sched-slot[aria-pressed="true"] {
  background: var(--sched-accent); border-color: var(--sched-accent);
  color: var(--sched-accent-ink); font-weight: 600;
}
.sched-slot:focus-visible, .sched-btn:focus-visible, .sched-week-btn:focus-visible,
.sched-tz-btn:focus-visible, .sched-input:focus-visible, .sched-tz-select:focus-visible {
  outline: 2px solid var(--sched-accent); outline-offset: 2px;
}

.sched-form { margin-top: 20px; border-top: 1px solid var(--sched-line); padding-top: 16px; }
.sched-chosen { font-size: 13px; color: var(--sched-muted); margin-bottom: 12px; }
.sched-chosen strong { display: block; font-size: 16px; color: var(--sched-ink); font-weight: 600; }
.sched-label { display: block; font-size: 13px; color: var(--sched-muted); margin: 10px 0 4px; }
.sched-input {
  width: 100%; padding: 12px; font: inherit; min-height: 46px;
  border: 1px solid var(--sched-line); border-radius: 8px;
  background: var(--sched-surface); color: var(--sched-ink);
}
.sched-btn {
  display: block; width: 100%; margin-top: 14px; padding: 14px;
  font: inherit; font-size: 16px; font-weight: 600; min-height: 50px;
  border: 1px solid var(--sched-accent); border-radius: 8px;
  background: var(--sched-accent); color: var(--sched-accent-ink); cursor: pointer;
}
.sched-btn[disabled] { opacity: .55; cursor: default; }
.sched-btn--ghost { background: none; color: var(--sched-accent); }
.sched-btn--danger { background: none; color: var(--sched-stop); border-color: var(--sched-stop); }

.sched-legal { font-size: 11.5px; line-height: 1.5; color: var(--sched-muted); margin: 14px 0 0; }

.sched-banner { border-radius: 8px; padding: 10px 12px; font-size: 13.5px; margin: 0 0 14px; }
.sched-banner--warn { background: var(--sched-warn-bg); color: var(--sched-warn); }
.sched-banner--stop { background: var(--sched-stop-bg); color: var(--sched-stop); }

.sched-center { text-align: center; padding: 26px 8px 10px; }
.sched-mark { font-size: 30px; line-height: 1; }
.sched-center h2 { font-size: 18px; margin: 12px 0 6px; }
.sched-center p { font-size: 14px; color: var(--sched-muted); margin: 0 auto; max-width: 32ch; }

.sched-recap { background: var(--sched-paper); border-radius: 8px; padding: 12px 14px; margin: 16px 0 0; }
.sched-recap dt {
  font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
  color: var(--sched-muted); margin-top: 10px;
}
.sched-recap dt:first-child { margin-top: 0; }
.sched-recap dd { margin: 2px 0 0; font-size: 14.5px; word-break: break-word; }
.sched-recap dd a { color: var(--sched-accent); }

.sched-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

@media (prefers-color-scheme: dark) {
  .sched-root {
    --sched-ink: #e8e5db; --sched-muted: #a19d92; --sched-line: #34322a;
    --sched-surface: #1e1d17; --sched-paper: #16150f; --sched-soft: #16333a;
    --sched-accent: #64b6c4; --sched-accent-ink: #10201f;
    --sched-warn: #d8ad4d; --sched-warn-bg: #33280e;
    --sched-stop: #e08d76; --sched-stop-bg: #38211a;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sched-root * { transition: none !important; animation: none !important; }
}
`;
