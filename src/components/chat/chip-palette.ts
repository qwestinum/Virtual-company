/**
 * Palette cyclique pour les chips d'un même groupe.
 *
 * Chaque chip d'un ChipSet reçoit une couleur dérivée de sa position
 * dans `options`. La palette tourne sur 5 teintes pour rester lisible
 * sur des groupes de 2-5 chips (la limite imposée par le contrat
 * ChipSetSchema). Au-delà, le cycle reprend — sans collision visuelle
 * gênante.
 *
 * Choix des teintes : indigo (Manager) → emerald (validation) → amber
 * (ajustement) → rose (alerte douce) → sky (alternative). Toutes en
 * variante 50/700/200 pour rester sobres en pastel mais lisibles.
 */

export type ChipPaletteEntry = {
  bg: string;
  text: string;
  border: string;
  hover: string;
};

export const CHIP_PALETTE: ReadonlyArray<ChipPaletteEntry> = [
  {
    bg: 'bg-indigo-50',
    text: 'text-indigo-700',
    border: 'border-indigo-200',
    hover: 'hover:bg-indigo-100 hover:border-indigo-300',
  },
  {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    hover: 'hover:bg-emerald-100 hover:border-emerald-300',
  },
  {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    hover: 'hover:bg-amber-100 hover:border-amber-300',
  },
  {
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    border: 'border-rose-200',
    hover: 'hover:bg-rose-100 hover:border-rose-300',
  },
  {
    bg: 'bg-sky-50',
    text: 'text-sky-700',
    border: 'border-sky-200',
    hover: 'hover:bg-sky-100 hover:border-sky-300',
  },
];

export function chipPaletteByIndex(index: number): ChipPaletteEntry {
  if (!Number.isFinite(index) || index < 0) return CHIP_PALETTE[0];
  return CHIP_PALETTE[index % CHIP_PALETTE.length];
}
