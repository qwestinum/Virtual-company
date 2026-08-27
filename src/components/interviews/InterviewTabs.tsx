'use client';

/**
 * Navigation de l'onglet « Entretiens ».
 *
 * Les compteurs comptent les lignes RENDUES, et quand un filtre en masque, le
 * total exhaustif reste écrit à côté (« 5 sur 18 ») — un dossier caché doit
 * rester comptabilisé.
 *
 * ⚠️ Le badge d'ALERTE (rendez-vous passés non pointés) reste sur le TOTAL,
 * jamais sur la vue filtrée : un filtre de confort qui masquerait des dossiers
 * en souffrance ferait perdre au signal sa fonction.
 */

export type InterviewTabKey = 'scheduled' | 'awaiting' | 'verdict';

export type InterviewTabCount = {
  key: InterviewTabKey;
  label: string;
  /** Lignes visibles (filtre appliqué). */
  count: number;
  /** Lignes du sous-onglet, filtre ignoré. */
  total: number;
  /** Compte d'alerte — TOUJOURS calculé sur l'ensemble. */
  alert?: number;
};

export function InterviewTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: InterviewTabCount[];
  active: InterviewTabKey;
  onSelect: (key: InterviewTabKey) => void;
}) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-stone-200">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onSelect(tab.key)}
          className={`-mb-px border-b-2 px-3 py-2 font-body text-[13px] font-semibold ${
            active === tab.key
              ? 'border-stone-800 text-stone-900'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          {tab.label}
          <span className="ml-1.5 text-stone-400">
            {tab.count === tab.total
              ? tab.count
              : `${tab.count} sur ${tab.total}`}
          </span>
          {tab.alert && tab.alert > 0 ? (
            <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 align-middle font-data text-[10px] font-bold text-white">
              {tab.alert}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
