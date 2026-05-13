/**
 * Mapping nommé des couleurs du dashboard (Session 6).
 *
 * Les composants utilisent ces clés (`'blue'`, `'green'`, etc.) plutôt
 * que les valeurs hex en dur. Toutes les valeurs concrètes vivent dans
 * `globals.css` sous forme de custom properties `--dash-*` — ce fichier
 * n'expose que les noms CSS via `var(...)`.
 *
 * Permet :
 *   - de typer fortement les choix de couleur dans les composants ;
 *   - de garder le thème modifiable en un seul endroit (CSS).
 */

export type DashColor =
  | 'blue'
  | 'purple'
  | 'green'
  | 'orange'
  | 'red'
  | 'pink'
  | 'teal'
  | 'indigo'
  | 'yellow';

export type DashColorPair = {
  /** Couleur de remplissage / texte saturé. */
  solid: string;
  /** Variante claire pour les fonds de badge/icône. */
  light: string;
};

export const DASH_COLORS: Record<DashColor, DashColorPair> = {
  blue: { solid: 'var(--dash-blue)', light: 'var(--dash-blue-light)' },
  purple: {
    solid: 'var(--dash-purple)',
    light: 'var(--dash-purple-light)',
  },
  green: { solid: 'var(--dash-green)', light: 'var(--dash-green-light)' },
  orange: {
    solid: 'var(--dash-orange)',
    light: 'var(--dash-orange-light)',
  },
  red: { solid: 'var(--dash-red)', light: 'var(--dash-red-light)' },
  pink: { solid: 'var(--dash-pink)', light: 'var(--dash-pink-light)' },
  teal: { solid: 'var(--dash-teal)', light: 'var(--dash-teal-light)' },
  indigo: {
    solid: 'var(--dash-indigo)',
    light: 'var(--dash-indigo-light)',
  },
  yellow: {
    solid: 'var(--dash-yellow)',
    light: 'var(--dash-yellow-light)',
  },
};

/**
 * Palette ordonnée pour l'attribution déterministe d'une couleur à un
 * avatar candidat — index = (code du premier caractère) % length.
 */
export const AVATAR_PALETTE: DashColor[] = [
  'blue',
  'purple',
  'green',
  'orange',
  'pink',
  'teal',
  'indigo',
];

export function avatarColorFor(initials: string): DashColorPair {
  if (!initials) return DASH_COLORS.blue;
  const idx = initials.charCodeAt(0) % AVATAR_PALETTE.length;
  return DASH_COLORS[AVATAR_PALETTE[idx]];
}

/**
 * Convention de couleur de score : ≥75 vert, ≥50 orange, sinon rouge.
 * Cohérent avec la maquette validée.
 */
export function colorForScore(score: number): DashColorPair {
  if (score >= 75) return DASH_COLORS.green;
  if (score >= 50) return DASH_COLORS.orange;
  return DASH_COLORS.red;
}
