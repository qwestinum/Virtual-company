'use client';

/** Transparence d'une recherche vivier : origine des correspondances, écartés sous le seuil. */

export type VivierRunMetaData = {
  indexedCount: number;
  deterministicCount: number;
  semanticCount: number;
  belowThreshold: number;
};

export function VivierRunMeta({ meta }: { meta: VivierRunMetaData }) {
  return (
    <p className="font-body text-[11px] text-stone-400">
      {meta.deterministicCount} correspondance
      {meta.deterministicCount > 1 ? 's' : ''} de titre ·{' '}
      {meta.semanticCount} titre{meta.semanticCount > 1 ? 's' : ''} proche
      {meta.semanticCount > 1 ? 's' : ''}
      {meta.belowThreshold > 0
        ? ` · ${meta.belowThreshold} sous le seuil`
        : ''}{' '}
      (sur {meta.indexedCount} indexé{meta.indexedCount > 1 ? 's' : ''}).
    </p>
  );
}
