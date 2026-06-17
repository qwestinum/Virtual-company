'use client';

/**
 * Indice de traçabilité discret (pré-remplissage par document).
 *
 * Petite icône « ⓘ » qui révèle au survol l'EXTRAIT SOURCE — le passage exact
 * du document qui a justifié une valeur ou une pondération suggérée. Pas de bloc
 * permanent (l'UI reste sobre) ; priorité d'usage aux pondérations suggérées,
 * où le jugement du LLM est la source la plus utile à relire. La donnée source
 * est captée systématiquement (cf. `campaigns.prefill_extraction`) ; cet
 * affichage est purement conditionnel.
 */
export type SourceHintProps = {
  /** Extrait source ; si vide/absent, rien n'est rendu. */
  source: string | null | undefined;
  /** Libellé accessible (ex. « Source : Management »). */
  label?: string;
};

export function SourceHint({ source, label }: SourceHintProps) {
  const text = source?.trim();
  if (!text) return null;
  return (
    <span
      title={`D'après le document : « ${text} »`}
      aria-label={label ?? `Extrait source : ${text}`}
      role="note"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        borderRadius: 8,
        background: 'var(--dash-purple-light)',
        color: 'var(--dash-purple)',
        fontSize: 10,
        fontWeight: 700,
        cursor: 'help',
        flexShrink: 0,
      }}
    >
      ⓘ
    </span>
  );
}
