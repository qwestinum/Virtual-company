'use client';

/**
 * Le rail des six étapes — repère de position ET chemin de retour.
 *
 * Une étape FAITE est cliquable : c'est le retour. Une étape à venir ne l'est
 * pas tant que ce qui la précède n'est pas valide (`canReach`) — on ne saute
 * pas par-dessus un trou, sinon le récapitulatif affiche des blancs.
 */

import {
  ASSISTANT_STEPS,
  STEP_RAIL_LABELS,
  canReach,
  stepIndex,
  type AssistantFacts,
  type AssistantStep,
} from '@/lib/campagnes/assistant-steps';

export function AssistantRail({
  current,
  facts,
  onGo,
}: {
  current: AssistantStep;
  facts: AssistantFacts;
  onGo: (step: AssistantStep) => void;
}) {
  const rangCourant = stepIndex(current);

  return (
    <nav
      aria-label="Étapes de la création"
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '14px 22px',
        borderBottom: '1px solid var(--dash-border)',
        background: 'var(--dash-warm)',
      }}
    >
      {ASSISTANT_STEPS.map((step, i) => {
        const faite = i < rangCourant;
        const ici = step === current;
        const ouvrable = !ici && canReach(step, facts);
        return (
          <div key={step} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
            <button
              type="button"
              data-step={step}
              data-state={ici ? 'current' : faite ? 'done' : 'todo'}
              aria-current={ici ? 'step' : undefined}
              disabled={!ouvrable}
              onClick={() => onGo(step)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                minWidth: 0,
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: ouvrable ? 'pointer' : 'default',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  background: faite
                    ? 'var(--dash-green-light)'
                    : ici
                      ? 'linear-gradient(135deg, var(--dash-blue), var(--dash-purple))'
                      : 'var(--dash-surface)',
                  color: faite ? 'var(--dash-green)' : ici ? '#fff' : 'var(--dash-text-secondary)',
                  border: faite || ici ? 'none' : '1px solid var(--dash-border-strong)',
                }}
              >
                {faite ? '✓' : i + 1}
              </span>
              <span
                className={ici ? 'font-display' : 'font-body'}
                style={{
                  fontSize: 12,
                  fontWeight: ici ? 700 : 600,
                  color: ici ? 'var(--dash-text)' : 'var(--dash-text-secondary)',
                  opacity: ouvrable || ici ? 1 : 0.6,
                  whiteSpace: 'nowrap',
                  textDecoration: ouvrable ? 'underline' : 'none',
                  textUnderlineOffset: 3,
                }}
              >
                {STEP_RAIL_LABELS[step]}
              </span>
            </button>
            {i < ASSISTANT_STEPS.length - 1 ? (
              <span
                aria-hidden
                style={{
                  flex: 1,
                  height: 1,
                  margin: '0 10px',
                  minWidth: 8,
                  background: faite ? 'var(--dash-green)' : 'var(--dash-border)',
                  opacity: faite ? 0.4 : 1,
                }}
              />
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
