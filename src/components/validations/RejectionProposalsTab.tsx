'use client';

/**
 * Sous-onglet « Propositions de refus ».
 *
 * Les mêmes cartes que « À examiner » — `ValidationCard` est réutilisée telle
 * quelle, sans variante ni fourche : accepter une proposition depuis ce
 * sous-onglet suit donc exactement le chemin d'acceptation normal. La seule
 * chose ajoutée est une couche de SÉLECTION par-dessus, qui n'entre jamais
 * dans la carte.
 *
 * Ce que le sous-onglet ne fait pas : décider. Il regroupe et propose. Le refus
 * ne part qu'après la confirmation nominative (cf. BulkRejectDialog).
 */

import { useRef, useState } from 'react';

import { runBulkReject } from '@/lib/hitl/bulk-reject';
import type { PendingValidation } from '@/types/hitl';

import { BulkRejectDialog } from './BulkRejectDialog';
import { ValidationCard } from './ValidationCard';

/** Au-delà, on le DIT plutôt que de laisser la page ramer sans explication. */
const CROWDED_QUEUE = 200;

export function RejectionProposalsTab({
  items,
  onSent,
  onBatchDone,
}: {
  items: PendingValidation[];
  onSent: (v: PendingValidation, message: string) => void;
  /** Retire du hub les validations effectivement traitées + rend le bilan. */
  onBatchDone: (treatedIds: string[], message: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  // Garde SYNCHRONE : `disabled={running}` ne prend effet qu'au re-render
  // suivant. Les claims serveur empêchent déjà tout second mail, mais laisser
  // partir deux fournées produirait un rapport d'exécution incompréhensible.
  const runningRef = useRef(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = items.length > 0 && selected.size === items.length;
  const chosen = items.filter((v) => selected.has(v.id));

  const runBatch = async (sendMail: boolean) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setProgress({ done: 0, total: chosen.length });
    try {
      const batchId = `bulk_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      const report = await runBulkReject(chosen, {
        sendMail,
        batchId,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      const treated = report.outcomes.filter((o) => o.ok).map((o) => o.id);
      setSelected(new Set());
      setConfirming(false);
      onBatchDone(
        treated,
        report.failed === 0
          ? `${report.succeeded} candidature${report.succeeded > 1 ? 's' : ''} refusée${report.succeeded > 1 ? 's' : ''}.`
          : `${report.succeeded} refusée${report.succeeded > 1 ? 's' : ''}, ${report.failed} en échec — les candidatures concernées sont restées en attente.`,
      );
    } finally {
      setRunning(false);
      runningRef.current = false;
      setProgress(null);
    }
  };

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-stone-200 px-4 py-8 text-center font-body text-[13px] italic text-stone-400">
        Aucune proposition de refus. Le seuil se règle dans les paramètres de
        décision de chaque campagne.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length > CROWDED_QUEUE ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-body text-[12.5px] text-amber-800">
          File inhabituellement chargée ({items.length} propositions) —
          l&apos;affichage peut être lent. C&apos;est le signe qu&apos;un seuil
          est peut-être trop haut, ou qu&apos;une campagne n&apos;a pas été
          traitée depuis longtemps.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 font-body text-[12.5px] font-semibold text-stone-600">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() =>
              setSelected(
                allSelected ? new Set() : new Set(items.map((v) => v.id)),
              )
            }
          />
          Tout sélectionner ({items.length})
        </label>
      </div>

      {chosen.length > 0 ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 shadow-sm">
          <span className="font-body text-[13px] font-semibold text-rose-800">
            {chosen.length} sélectionnée{chosen.length > 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-md border border-stone-300 bg-white px-2.5 py-1 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-50"
            >
              Tout désélectionner
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md bg-rose-600 px-3 py-1 font-body text-[12px] font-semibold text-white hover:bg-rose-700"
            >
              Refuser ces {chosen.length}
            </button>
          </div>
        </div>
      ) : null}

      {items.map((v) => (
        <div key={v.id} className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={selected.has(v.id)}
            onChange={() => toggle(v.id)}
            className="mt-4"
            aria-label={`Sélectionner ${v.candidateName}`}
          />
          <div className="min-w-0 flex-1">
            <ValidationCard v={v} onSent={onSent} />
          </div>
        </div>
      ))}

      {confirming ? (
        <BulkRejectDialog
          items={chosen}
          running={running}
          progress={progress}
          onConfirm={(sendMail) => void runBatch(sendMail)}
          onCancel={() => (running ? undefined : setConfirming(false))}
        />
      ) : null}
    </div>
  );
}
