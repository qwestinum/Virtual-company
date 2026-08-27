'use client';

/**
 * Onglet de la file des validations. Le compte affiché est celui des dossiers
 * VISIBLES ; dès qu'un filtre en masque, le total exhaustif reste écrit à côté
 * (« 5 sur 18 ») — un dossier caché doit rester comptabilisé, sans quoi le
 * filtre se lit comme une disparition.
 */

export function SubTabButton({
  active,
  label,
  count,
  total,
  onClick,
}: {
  active: boolean;
  label: string;
  /** Compte VISIBLE (filtre appliqué). */
  count: number;
  /** Compte EXHAUSTIF du sous-onglet. */
  total: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 font-body text-[13px] font-semibold ${
        active
          ? 'border-stone-800 text-stone-900'
          : 'border-transparent text-stone-500 hover:text-stone-700'
      }`}
    >
      {label} ({count === total ? count : `${count} sur ${total}`})
    </button>
  );
}
