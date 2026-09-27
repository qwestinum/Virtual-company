'use client';

/**
 * Ouvre LE rapport d'analyse d'une candidature — le PDF d'audit, en inline.
 *
 * ⚠️ UN SEUL format, et c'est celui-ci (23/09/2026). Le rapport se lisait sous
 * deux formes selon la porte empruntée : ce PDF depuis la fiche candidature,
 * et un markdown dépouillé depuis la fiche de validation — la porte où l'on
 * décide. Deux rendus du même fait, dont le plus pauvre servait au geste le
 * plus lourd de conséquences.
 *
 * L'endpoint sert le PDF en `attachment` (téléchargement) ; on le récupère en
 * blob et on ouvre l'URL blob → la visionneuse du navigateur l'AFFICHE au lieu
 * de l'enregistrer. Popup-safe : fenêtre ouverte AVANT l'await.
 *
 * Rend `false` quand le rapport n'a pas pu être servi (analyse introuvable,
 * réseau) : l'appelant DIT ce qui se passe plutôt que de laisser un bouton
 * mort.
 */
export async function openReportInline(analysisId: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const win = window.open('about:blank', '_blank');
  try {
    const res = await fetch(
      `/api/reporting/audit/candidates/${encodeURIComponent(analysisId)}/report`,
    );
    if (!res.ok) {
      win?.close();
      return false;
    }
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url;
    else window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  } catch {
    win?.close();
    return false;
  }
}
