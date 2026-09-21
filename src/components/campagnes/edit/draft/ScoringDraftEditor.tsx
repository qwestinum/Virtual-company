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
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ⚠️ LE BANDEAU EST UN CRAN AU-DESSUS, et ça doit se VOIR : il commande
          TOUS les critères d'en dessous. Posé à plat, à la même largeur et
          dans le même ton qu'eux, il se lisait comme une ligne de plus — on ne
          savait pas sur quoi « Tout confirmer » agissait.
          La hiérarchie se joue sur la STRUCTURE (pleine largeur, liste rentrée
          et rattachée par un filet), pas sur la saturation : un aplat violet
          plein criait plus fort que les critères qu'il commande. Il reprend
          donc le ton des blocs, et les blocs s'allègent d'un cran — ce qui
          distingue le chapeau de son contenu, c'est la place, pas le bruit. */}
      {untreated > 0 ? (
        <div
          role="status"
          data-role="suggestions-master"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            padding: '10px 14px',
            // Un bandeau fermé sur ses quatre côtés, et quatre angles
            // identiques : accolé à la liste par le bas, il se lisait comme
            // l'en-tête d'un tableau, alors qu'il commande des blocs qui ont
            // chacun leur propre cadre arrondi. C'est le filet en dessous qui
            // dit le rattachement, pas une arête partagée.
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
            {untreated > 1 ? 's' : ''} par l’IA, sur les {criteria.length} critère
            {criteria.length > 1 ? 's' : ''} ci-dessous — à traiter avant le
            lancement.
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
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          // Rentrée + filet : la liste est le CONTENU du bandeau, pas sa suite.
          marginLeft: untreated > 0 ? 14 : 0,
          marginTop: untreated > 0 ? 8 : 0,
          paddingLeft: untreated > 0 ? 12 : 0,
          paddingTop: untreated > 0 ? 10 : 0,
          borderLeft:
            untreated > 0
              ? '2px solid color-mix(in srgb, var(--dash-purple) 45%, transparent)'
              : 'none',
        }}
      >
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
              // Un cran plus transparent que le chapeau : c'est lui qui les
              // commande, ils n'ont pas à peser autant.
              background: suggested
                ? 'color-mix(in srgb, var(--dash-purple-light) 45%, var(--dash-surface))'
                : 'var(--dash-warm)',
              border: suggested
                ? '1px solid color-mix(in srgb, var(--dash-purple) 35%, transparent)'
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
    </div>
  );
}

/** Style partagé des boutons « confirmer / rejeter » (unitaire + en masse). */
function massBtnStyle(color: string, background = 'var(--dash-surface)'): React.CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 8,
    border: `1px solid ${color}`,
    background,
    color,
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}
