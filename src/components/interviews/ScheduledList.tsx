'use client';

/**
 * Onglet « Programmés » — les rendez-vous, avec en TÊTE ceux qui sont passés
 * sans pointage.
 *
 * L'ordre n'est pas chronologique par principe : ce qui attend une action
 * passe devant. Un entretien d'hier que personne n'a pointé bloque toute la
 * suite du dossier ; le mettre en bas de page, sous les rendez-vous à venir,
 * revient à le cacher.
 *
 * Le système ne transitionne JAMAIS un rendez-vous passé tout seul : sans
 * pointage humain il reste `scheduled` et le signal insiste. Constater une
 * absence est un jugement, pas une conséquence de l'horloge.
 */

import type { ScheduledRow } from '@/lib/interviews/pipeline-rows';

export type ScheduledItem = ScheduledRow & {
  campaignName: string | null;
  ownerName: string | null;
};

const SECTIONS: {
  key: ScheduledRow['section'];
  title: string;
  hint?: string;
}[] = [
  {
    key: 'a_pointer',
    title: 'À pointer',
    hint: 'Entretiens passés : dites ce qui s’est produit.',
  },
  { key: 'a_venir', title: 'À venir' },
  {
    key: 'verdict_attendu',
    title: 'Entretien fait — en attente de verdict',
  },
];

export function ScheduledList({
  rows,
  busyId,
  onRealized,
  onMissed,
  onVerdict,
  onDismiss,
  onReschedule,
  onCancel,
}: {
  rows: ScheduledItem[];
  busyId: string | null;
  onRealized: (row: ScheduledItem) => void;
  onMissed: (row: ScheduledItem) => void;
  onVerdict: (row: ScheduledItem, decision: 'validated' | 'rejected') => void;
  onDismiss: (row: ScheduledItem) => void;
  onReschedule: (row: ScheduledItem) => void;
  onCancel: (row: ScheduledItem) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="font-body text-[13px] italic text-stone-400">
        Aucun entretien programmé.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {SECTIONS.map((section) => {
        const items = rows.filter((r) => r.section === section.key);
        if (items.length === 0) return null;
        return (
          <section key={section.key}>
            <h3 className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
              {section.title} ({items.length})
            </h3>
            {section.hint ? (
              <p className="mb-1.5 font-body text-[12px] text-stone-500">
                {section.hint}
              </p>
            ) : null}
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {items.map((row) => (
                <li
                  key={row.briefId}
                  className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 ${
                    section.key === 'a_pointer'
                      ? 'border-amber-200 bg-amber-50/40'
                      : 'border-stone-200 bg-white'
                  }`}
                >
                  <span className="w-40 shrink-0 font-data text-[12.5px] font-semibold text-stone-800">
                    {formatSlot(row.interviewStartAt)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-body text-[13.5px] font-semibold text-stone-800">
                      {row.candidateName}
                    </p>
                    <p className="truncate font-body text-[12px] text-stone-500">
                      {/* Identifiant en tête : c'est la référence qui circule
                          dans les mails candidats et le journal. */}
                      {row.campaignId ? (
                        <span className="font-data text-stone-600">
                          {row.campaignId}
                        </span>
                      ) : (
                        'hors campagne'
                      )}
                      {row.campaignName ? ` · ${row.campaignName}` : ''}
                      {row.ownerName ? ` · ${row.ownerName}` : ''}
                      {row.interviewLocation ? ` · ${row.interviewLocation}` : ''}
                    </p>
                  </div>

                  {section.key === 'a_pointer' ? (
                    <>
                      <Action
                        disabled={busyId === row.briefId}
                        tone="positive"
                        onClick={() => onRealized(row)}
                      >
                        Entretien réalisé
                      </Action>
                      <Action
                        disabled={busyId === row.briefId}
                        onClick={() => onMissed(row)}
                      >
                        Candidat absent
                      </Action>
                    </>
                  ) : null}

                  {section.key === 'a_venir' ? (
                    <>
                      <Action
                        disabled={busyId === row.briefId || !row.analysisId}
                        onClick={() => onReschedule(row)}
                      >
                        Replanifier
                      </Action>
                      <Action
                        disabled={busyId === row.briefId || !row.bookingUid}
                        onClick={() => onCancel(row)}
                      >
                        Annuler
                      </Action>
                    </>
                  ) : null}

                  {section.key === 'verdict_attendu' ? (
                    <>
                      <Action
                        disabled={busyId === row.briefId}
                        tone="positive"
                        onClick={() => onVerdict(row, 'validated')}
                      >
                        GO définitif
                      </Action>
                      <Action
                        disabled={busyId === row.briefId}
                        tone="negative"
                        onClick={() => onVerdict(row, 'rejected')}
                      >
                        Non retenu
                      </Action>
                    </>
                  ) : null}

                  <Action disabled={!row.analysisId} onClick={() => onDismiss(row)}>
                    Classer sans suite
                  </Action>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Action({
  tone = 'neutral',
  disabled,
  onClick,
  children,
}: {
  tone?: 'positive' | 'negative' | 'neutral';
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const cls =
    tone === 'positive'
      ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
      : tone === 'negative'
        ? 'border-rose-300 text-rose-700 hover:bg-rose-50'
        : 'border-stone-300 text-stone-600 hover:bg-stone-50';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 font-body text-[12px] font-semibold disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}

function formatSlot(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
