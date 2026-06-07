/**
 * Libellés FR des phases du cycle de vie, pour l'UI (dashboard). Séparé de
 * `lifecycle.ts` (moteur pur, sans vocabulaire d'affichage). Utilisé pour
 * expliquer au DRH ce qui bloque l'activation d'une campagne.
 */

import type { PhaseId } from '@/types/campaign-lifecycle';

export const PHASE_LABELS: Record<PhaseId, string> = {
  fdp: 'la fiche de poste',
  scoring: 'la fiche de scoring',
  intake: 'les sources de réception',
  announcement: "l'annonce",
  publication: 'la publication',
};

/** Phrase listant les phases manquantes : « la fiche de poste et le scoring ». */
export function formatMissingPhases(missing: readonly PhaseId[]): string {
  const labels = missing.map((id) => PHASE_LABELS[id]);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(', ')} et ${labels[labels.length - 1]}`;
}
