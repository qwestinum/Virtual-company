'use client';

/**
 * Liste des rendez-vous, par jour.
 *
 * Deux actions seulement : décommander, et replanifier. « Replanifier » n'est
 * pas un déplacement fait à la place du candidat — c'est décommander puis lui
 * renvoyer un lien : c'est lui qui choisit son créneau, comme la première fois.
 *
 * UNE LIGNE PAR CANDIDATURE, dans son état courant. Les créneaux tombés en
 * cours de route ne s'empilent pas : ils se comptent (« 2 replanifications »).
 * Et un créneau tombé dont le remplaçant est déjà en attente n'est PAS
 * présenté comme une annulation — sinon replanifier deux fois donne à lire
 * deux échecs, alors qu'il ne s'est rien passé de fâcheux.
 *
 * Seule l'annulation SANS relance appelle une action : c'est la seule qui
 * porte un bouton. V1 ne relance jamais toute seule — un candidat qui annule
 * a peut-être renoncé.
 */

import type { InterviewRow } from '@/lib/interviews/board';

export function InterviewList({
  rows,
  onCancel,
  onReschedule,
  busyBookingId,
}: {
  rows: InterviewRow[];
  onCancel: (row: InterviewRow) => void;
  onReschedule: (row: InterviewRow) => void;
  busyBookingId: string | null;
}) {
  if (rows.length === 0) {
    return (
      <p className="font-body text-[13px] italic text-stone-400">
        Aucun rendez-vous sur cette période.
      </p>
    );
  }

  const days = groupByDay(rows);
  return (
    <div className="flex flex-col gap-4">
      {days.map(([day, items]) => (
        <section key={day}>
          <h3 className="mb-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
            {day}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {items.map((row) => (
              <li
                key={row.bookingId}
                className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 ${
                  row.state === 'confirmed'
                    ? 'border-stone-200 bg-white'
                    : 'border-stone-200 bg-stone-50 opacity-80'
                }`}
              >
                <span className="w-14 shrink-0 font-data text-[13px] font-semibold text-stone-800">
                  {timeOf(row.startAt, row.timezone)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-body text-[13.5px] font-semibold text-stone-800">
                    {row.candidateName}
                    <StateBadge row={row} />
                  </p>
                  <p className="truncate font-body text-[12px] text-stone-500">
                    {row.campaignName ?? row.campaignId ?? 'hors campagne'} ·{' '}
                    {row.recruiterName}
                    {row.location ? ` · ${row.location}` : ''}
                    {row.droppedSlots > 0 && row.state !== 'cancelled'
                      ? ` · ${row.droppedSlots} replanification${row.droppedSlots > 1 ? 's' : ''}`
                      : ''}
                  </p>
                </div>
                {row.state === 'confirmed' ? (
                  <>
                    <button
                      type="button"
                      className="rounded-md border border-stone-300 px-2.5 py-1 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-40"
                      disabled={busyBookingId === row.bookingId}
                      onClick={() => onReschedule(row)}
                    >
                      Replanifier
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-stone-300 px-2.5 py-1 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-40"
                      disabled={busyBookingId === row.bookingId}
                      onClick={() => onCancel(row)}
                    >
                      Annuler
                    </button>
                  </>
                ) : row.state === 'cancelled' && row.analysisId ? (
                  <button
                    type="button"
                    className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 font-body text-[12px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                    disabled={busyBookingId === row.bookingId}
                    onClick={() => onReschedule(row)}
                  >
                    Renvoyer un lien
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Ce que la ligne dit d'elle-même. « En attente de réservation » n'est pas un
 * échec : c'est l'état normal entre un créneau libéré et le suivant.
 */
function StateBadge({ row }: { row: InterviewRow }) {
  if (row.state === 'confirmed') {
    return row.droppedSlots > 0 ? (
      <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 font-body text-[10.5px] font-semibold uppercase tracking-wide text-stone-500">
        replanifié
      </span>
    ) : null;
  }
  if (row.state === 'awaiting_rebooking') {
    return (
      <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 font-body text-[10.5px] font-semibold uppercase tracking-wide text-blue-700">
        lien renvoyé — en attente
      </span>
    );
  }
  return (
    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 font-body text-[10.5px] font-semibold uppercase tracking-wide text-amber-800">
      {row.cancelledBy === 'attendee' ? 'annulé par le candidat' : 'annulé'}
    </span>
  );
}

function groupByDay(rows: InterviewRow[]): [string, InterviewRow[]][] {
  const map = new Map<string, InterviewRow[]>();
  for (const row of rows) {
    const key = dayLabel(row.startAt, row.timezone);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return [...map.entries()];
}

function dayLabel(iso: string, timeZone: string): string {
  return safeFormat(iso, timeZone, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
}

function timeOf(iso: string, timeZone: string): string {
  return safeFormat(iso, timeZone, { hour: '2-digit', minute: '2-digit' });
}

/** Le fuseau vient d'une saisie : on ne casse pas l'écran s'il est invalide. */
function safeFormat(
  iso: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Date(iso).toLocaleString('fr-FR', { ...options, timeZone });
  } catch {
    return new Date(iso).toLocaleString('fr-FR', options);
  }
}
