/**
 * Styles et petits utilitaires du panneau « Annonce générique ».
 *
 * Extraits pour tenir la règle « un composant, un fichier, 200 lignes » : ce
 * sont des constantes de présentation, elles n'ont pas à disputer la place à la
 * logique du panneau.
 */
import type { CSSProperties } from 'react';

/** Message d'erreur lisible tiré d'une réponse d'API, sans jamais lever. */
export async function readApiError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as
    | { message?: string; error?: string }
    | null;
  return data?.message ?? data?.error ?? `HTTP ${res.status}`;
}

/** « le 21/08/2026 à 14:32 », chaîne vide si la date est absente. */
export function formatPublishedAt(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return ` le ${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export const panelStyle: CSSProperties = {
  marginTop: 8,
  padding: 14,
  borderRadius: 10,
  background: 'var(--dash-warm)',
  border: '1px solid var(--dash-border)',
};
export const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 10,
  color: 'var(--dash-text-secondary)',
};
export const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--dash-text-secondary)',
  margin: '10px 0 4px',
};
export const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  font: 'inherit',
  fontSize: 13,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--dash-border)',
  background: '#fff',
  color: 'var(--dash-text)',
};
export const ghostBtn: CSSProperties = {
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 600,
  padding: '7px 12px',
  borderRadius: 8,
  border: '1px solid var(--dash-border-strong)',
  background: '#fff',
  color: 'var(--dash-text)',
  cursor: 'pointer',
  textDecoration: 'none',
};
export const primaryBtn: CSSProperties = {
  ...ghostBtn,
  border: '1px solid var(--dash-green)',
  background: 'var(--dash-green)',
  color: '#fff',
};
export const errorStyle: CSSProperties = {
  fontSize: 12.5,
  color: '#9c2b2b',
  background: '#fdf1f1',
  border: '1px solid #f3d5d5',
  borderRadius: 8,
  padding: '7px 10px',
  margin: '0 0 8px',
};

export const tagsStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--dash-text-secondary)',
  margin: '8px 0 0',
};
