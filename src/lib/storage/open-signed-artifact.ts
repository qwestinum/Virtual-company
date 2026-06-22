'use client';

/**
 * Ouvre un artefact (CV, rapport…) via un lien signé ÉPHÉMÈRE généré côté
 * serveur (`GET /api/artifacts/[id]/signed-url`). Le bucket est privé : plus
 * d'URL publique permanente.
 *
 * Popup-safe : on ouvre une fenêtre blanche SYNCHRONE d'abord (sinon le popup
 * blocker bloque l'ouverture faite après l'`await`), puis on la redirige vers
 * l'URL signée. Renvoie `false` si l'accès a échoué — l'appelant peut alors
 * retomber sur un téléchargement local.
 */
export async function openSignedArtifact(artifactId: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const win = window.open('about:blank', '_blank');
  try {
    const res = await fetch(
      `/api/artifacts/${encodeURIComponent(artifactId)}/signed-url`,
    );
    if (!res.ok) {
      win?.close();
      return false;
    }
    const data = (await res.json()) as { url?: string };
    if (!data.url) {
      win?.close();
      return false;
    }
    if (win) win.location.href = data.url;
    else window.open(data.url, '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    win?.close();
    return false;
  }
}
