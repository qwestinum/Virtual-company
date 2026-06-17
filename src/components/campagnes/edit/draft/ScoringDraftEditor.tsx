'use client';

/**
 * Éditeur de critères de scoring pour un brouillon de campagne
 * (Session 6 v2).
 *
 * Symétrique de `ScoringEditBlock` mais sans store : l'état est tenu
 * par le parent (CampaignCreateSheet) et chaque mutation rappelle
 * `onChange` avec la nouvelle liste.
 */

import { SourceHint } from '@/components/campagnes/edit/SourceHint';
import { KeywordsInput } from '@/components/scoring/KeywordsInput';
import { VerificationMethodSelector } from '@/components/scoring/VerificationMethodSelector';
import {
  buildCriterion,
  countUntreatedSuggestions,
  DEFAULT_VERIFICATION_METHOD,
  DEFAULT_WEIGHTS,
  SCORING_LEVELS,
  SCORING_LEVEL_COLORS,
  SCORING_LEVEL_LABELS,
  type ScoringCriterion,
  type ScoringLevel,
  type VerificationMethod,
} from '@/types/scoring';

export type ScoringDraftEditorProps = {
  criteria: ScoringCriterion[];
  onChange: (next: ScoringCriterion[]) => void;
  /**
   * Extraits sources des pondérations suggérées, par id de critère (issus du
   * pré-remplissage par document). Affichés en indice discret. Optionnel.
   */
  sourceById?: Record<string, string>;
};

export function ScoringDraftEditor({
  criteria,
  onChange,
  sourceById,
}: ScoringDraftEditorProps) {
  const patch = (
    id: string,
    delta: Partial<
      Pick<
        ScoringCriterion,
        'label' | 'level' | 'weight' | 'verificationMethod' | 'keywords'
      >
    >,
  ) => onChange(criteria.map((c) => (c.id === id ? { ...c, ...delta } : c)));

  const remove = (id: string) =>
    onChange(criteria.filter((c) => c.id !== id));

  // « Traiter » une pondération suggérée = acte léger (un clic).
  // Confirmer → suggere:false (acquise). Rejeter → retrait du critère.
  const confirm = (id: string) =>
    onChange(
      criteria.map((c) => (c.id === id ? { ...c, suggere: false } : c)),
    );
  const confirmAll = () =>
    onChange(criteria.map((c) => (c.suggere ? { ...c, suggere: false } : c)));
  const rejectAll = () => onChange(criteria.filter((c) => !c.suggere));

  const untreated = countUntreatedSuggestions({
    campaignId: 'draft',
    criteria,
    isValidated: false,
  });

  const add = () => {
    const id = `crit_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    onChange([
      ...criteria,
      buildCriterion({
        id,
        label: 'Nouveau critère',
        level: 'important',
      }),
    ]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {untreated > 0 ? (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            padding: '8px 10px',
            borderRadius: 10,
            background: 'var(--dash-purple-light)',
            border: '1px solid var(--dash-purple)',
          }}
        >
          <span
            className="font-body"
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--dash-purple)',
              flex: 1,
              minWidth: 160,
            }}
          >
            ✨ {untreated} pondération{untreated > 1 ? 's' : ''} suggérée
            {untreated > 1 ? 's' : ''} par l’IA à traiter avant le lancement.
          </span>
          <button
            type="button"
            onClick={confirmAll}
            className="font-body"
            style={massBtnStyle('var(--dash-green)')}
          >
            Tout confirmer
          </button>
          <button
            type="button"
            onClick={rejectAll}
            className="font-body"
            style={massBtnStyle('var(--dash-red)')}
          >
            Tout rejeter
          </button>
        </div>
      ) : null}
      {criteria.map((c) => {
        const suggested = c.suggere === true;
        const method: VerificationMethod =
          c.verificationMethod ?? DEFAULT_VERIFICATION_METHOD;
        const showKeywords = method !== 'llm_with_quote';
        const showSuggest =
          method === 'keywords_with_variants' || method === 'hybrid_keywords_llm';
        return (
          <div
            key={c.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 10,
              background: suggested
                ? 'var(--dash-purple-light)'
                : 'var(--dash-warm)',
              border: suggested
                ? '1px solid var(--dash-purple)'
                : '1px solid var(--dash-border)',
            }}
          >
            {suggested ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  className="font-data"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: 'var(--dash-purple)',
                    background: 'var(--dash-surface)',
                    border: '1px solid var(--dash-purple)',
                    borderRadius: 6,
                    padding: '2px 6px',
                  }}
                >
                  ✨ Suggéré par l’IA
                </span>
                <SourceHint
                  source={sourceById?.[c.id]}
                  label={`Source de la suggestion « ${c.label} »`}
                />
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={() => confirm(c.id)}
                  className="font-body"
                  style={massBtnStyle('var(--dash-green)')}
                >
                  Confirmer
                </button>
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  className="font-body"
                  style={massBtnStyle('var(--dash-red)')}
                >
                  Rejeter
                </button>
              </div>
            ) : null}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <input
                type="text"
                value={c.label}
                onChange={(e) => patch(c.id, { label: e.currentTarget.value })}
                className="font-body"
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--dash-text)',
                  padding: '4px 0',
                  outline: 'none',
                  minWidth: 0,
                }}
              />
              <select
                value={c.level}
                onChange={(e) => {
                  const next = e.currentTarget.value as ScoringLevel;
                  patch(c.id, { level: next, weight: DEFAULT_WEIGHTS[next] });
                }}
                className="font-body"
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: SCORING_LEVEL_COLORS[c.level],
                  background: 'var(--dash-surface)',
                  border: `1px solid ${SCORING_LEVEL_COLORS[c.level]}40`,
                  borderRadius: 6,
                  padding: '3px 6px',
                  cursor: 'pointer',
                }}
              >
                {SCORING_LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {SCORING_LEVEL_LABELS[lvl]}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                max={20}
                value={c.weight}
                onChange={(e) =>
                  patch(c.id, { weight: Number(e.currentTarget.value) })
                }
                className="font-data"
                style={{
                  width: 50,
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--dash-text)',
                  background: 'var(--dash-surface)',
                  border: '1px solid var(--dash-border)',
                  borderRadius: 6,
                  padding: '3px 6px',
                  textAlign: 'center',
                }}
              />
              <button
                type="button"
                onClick={() => remove(c.id)}
                aria-label="Supprimer ce critère"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--dash-text-tertiary)',
                  cursor: 'pointer',
                  fontSize: 16,
                  padding: 2,
                }}
              >
                ×
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <VerificationMethodSelector
                value={method}
                onChange={(m) => patch(c.id, { verificationMethod: m })}
              />
              {showKeywords ? (
                <KeywordsInput
                  keywords={c.keywords ?? []}
                  onChange={(kw) => patch(c.id, { keywords: kw })}
                  showSuggest={showSuggest}
                  criterionLabel={c.label}
                  targetMethod={method}
                  label={method === 'hybrid_keywords_llm' ? 'Mots-clés gardiens' : 'Mots-clés'}
                />
              ) : null}
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        className="font-body"
        style={{
          padding: '8px 14px',
          borderRadius: 8,
          border: '1px dashed var(--dash-border-strong)',
          background: 'transparent',
          color: 'var(--dash-text-secondary)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          alignSelf: 'flex-start',
        }}
      >
        + Ajouter un critère
      </button>
    </div>
  );
}

/** Style partagé des boutons « confirmer / rejeter » (unitaire + en masse). */
function massBtnStyle(color: string): React.CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 8,
    border: `1px solid ${color}`,
    background: 'var(--dash-surface)',
    color,
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}
