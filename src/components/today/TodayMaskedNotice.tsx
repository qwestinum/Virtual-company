'use client';

/**
 * Sur *Aujourd'hui* : ce que le filtre de lecture cache, et la porte pour tout
 * revoir (03/10/2026). Affiché dès qu'UN dossier est masqué — pas seulement
 * quand la carte entière est vide.
 */

/** Ce que le filtre cache, dit en une ligne, avec la porte pour tout revoir. */
export function TodayMaskedNotice({
  masked,
  emptied,
  onShowAll,
}: {
  masked: number;
  emptied: boolean;
  onShowAll: () => void;
}) {
  if (masked <= 0) return null;
  const pluriel = masked > 1;
  return (
    <p
      className="font-body"
      data-today-masked={masked}
      style={{ fontSize: 13, color: 'var(--dash-text-secondary)' }}
    >
      {emptied ? 'Rien ne vous attend avec ce filtre — ' : 'Le filtre masque '}
      {masked} dossier{pluriel ? 's' : ''}
      {emptied ? ` attend${pluriel ? 'ent' : ''} ailleurs.` : ' qui attend' + (pluriel ? 'ent' : '') + ' aussi.'}{' '}
      <button type="button" onClick={onShowAll} className="font-semibold underline">
        Voir tout
      </button>
    </p>
  );
}
