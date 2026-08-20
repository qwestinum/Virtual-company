'use client';

/**
 * Page de gestion d'un rendez-vous — accessible par le jeton remis à l'invité.
 *
 * Deux actions, volontairement asymétriques : déplacer est réversible et
 * s'affiche en premier ; annuler est définitif, réclame une confirmation, et sa
 * sortie de secours est proposée avant l'action. On ne fait pas d'un geste
 * irréversible le chemin le plus court.
 */
import { useEffect, useState } from 'react';

import { formatDateTime, isValidTimeZone, zoneLabel } from '../format';
import { fill, type SchedulingLabels } from '../labels';
import type { MeetingLocation, Slot } from '../types';
import { Recap, type BookingConfirmation } from './BookingPage';
import { CloseButton } from './CloseButton';
import { SlotPicker } from './SlotPicker';
import { TimezoneBar } from './TimezoneBar';
import { useDetectedTimeZone } from './useDetectedTimeZone';
import { slotsWithinWeek, shiftWeek, todayKey, weekDayKeys, weekWindow } from './week';

export type ManageBooking = {
  startAt: string;
  endAt: string;
  status: 'confirmed' | 'cancelled';
  durationMinutes: number;
  meetingLocation: MeetingLocation | null;
  attendeeTimezone: string;
  organisation: string | null;
};

export type ManagePageProps = {
  manageToken: string;
  booking: ManageBooking | null;
  labels: SchedulingLabels;
  apiBase: string;
};

type View = 'detail' | 'reschedule' | 'confirm-cancel' | 'cancelled';

export function ManagePage({ manageToken, booking, labels, apiBase }: ManagePageProps) {
  const [view, setView] = useState<View>(
    booking?.status === 'cancelled' ? 'cancelled' : 'detail',
  );
  const detected = useDetectedTimeZone();
  const [chosenZone, setChosenZone] = useState<string | null>(null);
  const timeZone =
    chosenZone ??
    (detected
      ? isValidTimeZone(detected)
        ? detected
        : (booking?.attendeeTimezone ?? 'UTC')
      : null);
  const [current, setCurrent] = useState(booking);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!booking || !current) {
    return (
      <Card organisation={null}>
        <Centered mark="🔒" title={labels.goneTitle} body={labels.goneBody} />
      </Card>
    );
  }

  if (!timeZone) {
    return (
      <Card organisation={current.organisation}>
        <p className="sched-note">{labels.loadingSlots}</p>
      </Card>
    );
  }

  if (view === 'cancelled') {
    return (
      <Card organisation={current.organisation}>
        <Centered
          mark="—"
          title={labels.cancelledTitle}
          body={labels.cancelledBody}
        />
        {/* Même cul-de-sac que la confirmation : plus rien à faire ici. */}
        <CloseButton labels={labels} />
      </Card>
    );
  }

  if (view === 'confirm-cancel') {
    return (
      <Card organisation={current.organisation}>
        <h1 className="sched-title">{labels.cancelTitle}</h1>
        <Recap
          confirmation={asConfirmation(current, timeZone)}
          labels={labels}
          manageCta={null}
        />
        <p className="sched-note" style={{ marginTop: 12 }}>
          {labels.cancelWarning}
        </p>
        {banner ? (
          <p className="sched-banner sched-banner--stop" role="alert">
            {banner}
          </p>
        ) : null}
        <button
          type="button"
          className="sched-btn sched-btn--danger"
          disabled={busy}
          onClick={() => {
            void (async () => {
              setBusy(true);
              setBanner(null);
              try {
                const response = await fetch(
                  `${apiBase}/bookings/${encodeURIComponent(manageToken)}/cancel`,
                  { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
                );
                if (response.ok || response.status === 409) {
                  setView('cancelled');
                  return;
                }
                setBanner(
                  response.status === 429 ? labels.errorRateLimited : labels.errorGeneric,
                );
              } catch {
                setBanner(labels.errorGeneric);
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          {labels.cancelConfirm}
        </button>
        <button
          type="button"
          className="sched-btn sched-btn--ghost"
          onClick={() => setView('detail')}
        >
          {labels.cancelBack}
        </button>
      </Card>
    );
  }

  if (view === 'reschedule') {
    return (
      <Reschedule
        manageToken={manageToken}
        booking={current}
        labels={labels}
        apiBase={apiBase}
        timeZone={timeZone}
        onTimeZone={setChosenZone}
        onDone={(next) => {
          setCurrent({ ...current, startAt: next.startAt, endAt: next.endAt });
          setView('detail');
        }}
        onBack={() => setView('detail')}
      />
    );
  }

  return (
    <Card organisation={current.organisation}>
      <h1 className="sched-title">{labels.manageTitle}</h1>
      <Recap
        confirmation={asConfirmation(current, timeZone)}
        labels={labels}
        manageCta={null}
      />
      <TimezoneBar timeZone={timeZone} labels={labels} onChange={setChosenZone} />
      <button
        type="button"
        className="sched-btn sched-btn--ghost"
        onClick={() => setView('reschedule')}
      >
        {labels.rescheduleCta}
      </button>
      <button
        type="button"
        className="sched-btn sched-btn--danger"
        onClick={() => setView('confirm-cancel')}
      >
        {labels.cancelCta}
      </button>
    </Card>
  );
}

// ─── Déplacement ────────────────────────────────────────────────────────

function Reschedule({
  manageToken,
  booking,
  labels,
  apiBase,
  timeZone,
  onTimeZone,
  onDone,
  onBack,
}: {
  manageToken: string;
  booking: ManageBooking;
  labels: SchedulingLabels;
  apiBase: string;
  timeZone: string;
  onTimeZone: (zone: string) => void;
  onDone: (next: { startAt: string; endAt: string }) => void;
  onBack: () => void;
}) {
  const [weekDay, setWeekDay] = useState(() => todayKey(timeZone));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestKey = `${timeZone}|${weekDay}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    if (loadedKey === requestKey) return;
    let cancelled = false;
    const days = weekDayKeys(weekDay);
    const window = weekWindow(days);

    void (async () => {
      try {
        const response = await fetch(
          `${apiBase}/bookings/${encodeURIComponent(manageToken)}/slots?from=${encodeURIComponent(
            window.from,
          )}&to=${encodeURIComponent(window.to)}`,
        );
        if (cancelled) return;
        if (!response.ok) {
          setSlots([]);
          setBanner(
            response.status === 429 ? labels.errorRateLimited : labels.errorGeneric,
          );
        } else {
          const payload = (await response.json()) as { slots?: Slot[] };
          if (cancelled) return;
          setSlots(slotsWithinWeek(payload.slots ?? [], days, timeZone));
        }
      } catch {
        if (!cancelled) {
          setSlots([]);
          setBanner(labels.errorGeneric);
        }
      } finally {
        if (!cancelled) setLoadedKey(requestKey);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiBase, manageToken, labels, timeZone, weekDay, requestKey, loadedKey]);

  return (
    <Card organisation={booking.organisation}>
      <h1 className="sched-title">{labels.rescheduleTitle}</h1>
      <p className="sched-meta">
        {fill(labels.rescheduleCurrent, {
          when: `${formatDateTime(booking.startAt, timeZone)} (${fill(
            labels.timezoneLabel,
            { zone: zoneLabel(timeZone) },
          )})`,
        })}
      </p>
      {banner ? (
        <p className="sched-banner sched-banner--warn" role="status">
          {banner}
        </p>
      ) : null}

      <TimezoneBar
        timeZone={timeZone}
        labels={labels}
        onChange={(zone) => {
          onTimeZone(zone);
          setSelected(null);
        }}
      />

      <div className="sched-week">
        <button
          type="button"
          className="sched-week-btn"
          aria-label={labels.previousWeek}
          onClick={() => setWeekDay(shiftWeek(weekDay, -1))}
        >
          ‹
        </button>
        <span>{fill(labels.weekOf, { date: weekDay })}</span>
        <button
          type="button"
          className="sched-week-btn"
          aria-label={labels.nextWeek}
          onClick={() => setWeekDay(shiftWeek(weekDay, 1))}
        >
          ›
        </button>
      </div>

      <SlotPicker
        slots={slots}
        timeZone={timeZone}
        labels={labels}
        selectedStartAt={selected?.startAt ?? null}
        onSelect={setSelected}
        loading={loading}
      />

      {selected ? (
        <button
          type="button"
          className="sched-btn"
          disabled={busy}
          onClick={() => {
            void (async () => {
              setBusy(true);
              setBanner(null);
              try {
                const response = await fetch(
                  `${apiBase}/bookings/${encodeURIComponent(manageToken)}/reschedule`,
                  {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ startAt: selected.startAt }),
                  },
                );
                if (response.ok) {
                  const payload = (await response.json()) as {
                    booking: { startAt: string; endAt: string };
                  };
                  onDone(payload.booking);
                  return;
                }
                if (response.status === 429) {
                  setBanner(labels.errorRateLimited);
                  return;
                }
                const payload = (await response.json().catch(() => ({}))) as {
                  reason?: string;
                };
                setBanner(
                  payload.reason === 'slot_taken' || payload.reason === 'invalid_slot'
                    ? labels.errorSlotTaken
                    : labels.errorGeneric,
                );
                setSelected(null);
                setLoadedKey(null); // invalide la grille → rechargement
              } catch {
                setBanner(labels.errorGeneric);
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          {fill(labels.rescheduleConfirm, {
            when: formatDateTime(selected.startAt, timeZone),
          })}
        </button>
      ) : null}

      <button type="button" className="sched-btn sched-btn--ghost" onClick={onBack}>
        {labels.rescheduleKeep}
      </button>
    </Card>
  );
}

// ─── Fragments ──────────────────────────────────────────────────────────

function Card({
  organisation,
  children,
}: {
  organisation: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="sched-shell">
      <div className="sched-card">
        {organisation ? <p className="sched-org">{organisation}</p> : null}
        {children}
      </div>
    </div>
  );
}

function Centered({ mark, title, body }: { mark: string; title: string; body: string }) {
  return (
    <div className="sched-center">
      <div className="sched-mark" aria-hidden="true">
        {mark}
      </div>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function asConfirmation(booking: ManageBooking, timeZone: string): BookingConfirmation {
  return {
    startAt: booking.startAt,
    endAt: booking.endAt,
    timeZone,
    meetingLocation: booking.meetingLocation,
    manageUrl: null,
  };
}
