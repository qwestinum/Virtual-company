'use client';

/**
 * Action d'un dossier « à valider » : retrouve sa fiche de validation par uid
 * et rend la carte partagée (`ValidationCard` → decideGrayValidation).
 *
 * ⚠️ Le cas « fiche introuvable » n'est PAS un détail d'affichage. Une analyse
 * en zone d'attente et sa ligne de file décrivent le même fait sans que rien
 * ne les relie en base : la seconde peut manquer (diagnostic du 20/09/2026,
 * `docs/ops/diagnostic-validations-orphelines-2026-09-20.md`). L'écran
 * affichait alors « Validation introuvable (déjà traitée ?) » — l'hypothèse
 * exactement INVERSE de la réalité : le dossier n'a pas été traité, il est
 * devenu indécidable. On le dit, et on donne la sortie.
 */

import { useEffect, useState } from 'react';

import { ValidationCard } from '@/components/validations/ValidationCard';
import type { PendingValidation } from '@/types/hitl';
import type { CandidateListItem } from '@/types/reporting';

type State =
  | { kind: 'loading' }
  | { kind: 'found'; validation: PendingValidation }
  | { kind: 'orphan' }
  /** La lecture elle-même a échoué : ne pas conclure à l'absence. */
  | { kind: 'unreadable' };

export function GrayValidationAction({
  item,
  onActed,
}: {
  item: CandidateListItem;
  onActed: () => void;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  // `reload` relance la lecture sans que l'effet n'appelle de setState de
  // façon synchrone (rendus en cascade). Le retour à `loading` appartient au
  // bouton « Réessayer », qui est un gestionnaire de clic, pas un effet.
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/validations', { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setState({ kind: 'unreadable' });
          return;
        }
        const json = (await res.json()) as {
          validations?: PendingValidation[];
        };
        if (cancelled) return;
        const match = json.validations?.find(
          (v) => typeof v.payload?.uid === 'string' && v.payload.uid === item.uid,
        );
        setState(
          match ? { kind: 'found', validation: match } : { kind: 'orphan' },
        );
      } catch {
        if (!cancelled) setState({ kind: 'unreadable' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.uid, reload]);

  const retry = (): void => {
    setState({ kind: 'loading' });
    setReload((n) => n + 1);
  };

  if (state.kind === 'loading') {
    return (
      <p className="font-body text-[12px] text-stone-500">
        Chargement de la validation…
      </p>
    );
  }
  if (state.kind === 'unreadable') {
    return (
      <p className="font-body text-[12px] text-stone-600">
        La file de validation n’a pas pu être lue.{' '}
        <button
          type="button"
          onClick={retry}
          className="font-semibold underline underline-offset-2"
        >
          Réessayer
        </button>
      </p>
    );
  }
  if (state.kind === 'orphan') {
    return <OrphanNotice item={item} onRequeued={onActed} />;
  }
  return <ValidationCard v={state.validation} onSent={() => onActed()} />;
}

/**
 * Dossier en attente sans fiche de validation. On nomme le fait, on ne
 * spécule pas sur sa cause, et on offre la seule action qui le répare.
 * « Classer sans suite » est rendu juste en dessous par `CandidatureActions` —
 * on le nomme plutôt que de le dupliquer.
 */
function OrphanNotice({
  item,
  onRequeued,
}: {
  item: CandidateListItem;
  onRequeued: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requeue = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/validations/requeue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisId: item.id }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        setError(
          json?.message ??
            'La remise en file n’a pas abouti. Rien n’a été modifié.',
        );
        return;
      }
      onRequeued();
    } catch {
      setError('La remise en file n’a pas abouti. Rien n’a été modifié.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-dash-orange/50 bg-dash-orange-light px-4 py-3">
      <p className="font-body text-[13px] leading-relaxed text-dash-text">
        <strong className="font-semibold">
          Ce dossier attend une décision, mais sa fiche de validation est
          introuvable.
        </strong>{' '}
        Elle n’a pas été créée, ou elle a été supprimée. Tant qu’elle manque, la
        candidature reste comptée « à valider » sans pouvoir être tranchée —
        aucun mail n’est parti.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void requeue()}
          disabled={busy}
          className="rounded-lg border border-dash-text bg-dash-text px-4 py-2 font-body text-[13px] font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Remise en file…' : 'Remettre en file'}
        </button>
        <span className="font-body text-[12px] text-dash-text-secondary">
          ou « Classer sans suite » ci-dessous, si le dossier n’a plus lieu
          d’être décidé.
        </span>
      </div>
      {error ? (
        <p
          role="alert"
          className="mt-2 font-body text-[12px] font-semibold text-dash-red"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
