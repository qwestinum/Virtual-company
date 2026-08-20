'use client';

/**
 * Page publique de réservation.
 *
 * Le point délicat de cet écran n'est pas l'affichage, c'est ce qui se passe
 * quand la réservation échoue. Deux verdicts peuvent tomber au moment précis où
 * l'invité valide : le créneau vient d'être pris, ou les disponibilités ont
 * changé sous ses pieds. Dans les deux cas on RESTE sur place, on rafraîchit la
 * grille et on CONSERVE ce qui a été saisi. Renvoyer quelqu'un à un formulaire
 * vide parce qu'une course a été perdue, c'est lui faire payer notre
 * concurrence.
 */
import { useEffect, useState } from 'react';

import { formatDateTime, formatShortDate, formatTimeRange, isValidTimeZone, zoneLabel } from '../format';
import { fill, type SchedulingLabels } from '../labels';
import type { BookingPageState, LinkDisplay, MeetingLocation, Slot } from '../types';
import { SlotPicker } from './SlotPicker';
import { useDetectedTimeZone } from './useDetectedTimeZone';
import { TimezoneBar } from './TimezoneBar';
import { slotsWithinWeek, shiftWeek, todayKey, weekDayKeys, weekWindow } from './week';

export type BookingConfirmation = {
  startAt: string;
  endAt: string;
  timeZone: string;
  meetingLocation: MeetingLocation | null;
  manageUrl: string | null;
};

export type BookingPageProps = {
  token: string;
  state: BookingPageState;
  labels: SchedulingLabels;
  /** Racine des appels — injectée pour que le module ne présume pas des routes. */
  apiBase: string;
  /** Rappel du rendez-vous si le lien a déjà servi. */
  existing?: BookingConfirmation | null;
};

export function BookingPage(props: BookingPageProps) {
  if (props.state.status === 'degraded') {
    return (
      <Shell display={props.state.display}>
        <Centered
          mark="🕓"
          title={props.labels.degradedTitle}
          body={props.labels.degradedBody}
        />
      </Shell>
    );
  }

  if (props.state.status === 'gone') {
    return (
      <Shell display={props.state.display}>
        {props.existing ? (
          <>
            <Centered
              mark="✓"
              title={props.labels.alreadyBookedTitle}
              body={props.labels.alreadyBookedBody}
            />
            <Recap
              confirmation={props.existing}
              labels={props.labels}
              manageCta={props.labels.manageCta}
            />
          </>
        ) : (
          <Centered
            mark="🔒"
            title={props.labels.goneTitle}
            body={props.labels.goneBody}
          />
        )}
      </Shell>
    );
  }

  return <OpenBooking {...props} state={props.state} />;
}

// ─── État ouvert ────────────────────────────────────────────────────────

type OpenState = Extract<BookingPageState, { status: 'open' }>;

function OpenBooking({
  token,
  state,
  labels,
  apiBase,
}: BookingPageProps & { state: OpenState }) {
  // Le fuseau n'est connu qu'une fois dans le navigateur. Tant qu'il est nul,
  // on n'affiche AUCUNE heure : mieux vaut un instant de vide qu'une heure
  // rendue dans le fuseau du serveur puis corrigée sous les yeux du lecteur.
  const detected = useDetectedTimeZone();
  const [chosenZone, setChosenZone] = useState<string | null>(null);
  const timeZone =
    chosenZone ??
    (detected && isValidTimeZone(detected) ? detected : detected ? state.resource.timezone : null);

  const [weekDay, setWeekDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  // Chargement DÉRIVÉ : tant que la clé chargée diffère de la clé demandée,
  // c'est qu'on attend. Aucun état à poser depuis un effet, donc aucun rendu
  // en cascade — et impossible d'oublier de le remettre à zéro.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [name, setName] = useState(state.display.attendeeName ?? '');
  const [email, setEmail] = useState(state.display.attendeeEmail ?? '');
  const [phone, setPhone] = useState('');
  const [banner, setBanner] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<BookingConfirmation | null>(null);

  const currentDay = weekDay ?? (timeZone ? todayKey(timeZone) : null);
  const requestKey = timeZone && currentDay ? `${timeZone}|${currentDay}` : null;
  const loading = requestKey !== null && loadedKey !== requestKey;

  useEffect(() => {
    if (!timeZone || !currentDay || !requestKey) return;
    if (loadedKey === requestKey) return;

    let cancelled = false;
    const days = weekDayKeys(currentDay);
    const window = weekWindow(days);

    void (async () => {
      try {
        const response = await fetch(
          `${apiBase}/links/${encodeURIComponent(token)}/slots?from=${encodeURIComponent(
            window.from,
          )}&to=${encodeURIComponent(window.to)}`,
          { headers: { accept: 'application/json' } },
        );
        // Une réponse arrivée après un changement de semaine ne doit pas
        // écraser la suivante : on ignore tout ce qui est périmé.
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
  }, [apiBase, token, labels, timeZone, currentDay, requestKey, loadedKey]);

  if (!timeZone || !currentDay) {
    return (
      <Shell display={state.display}>
        <Header state={state} labels={labels} />
        <p className="sched-note">{labels.loadingSlots}</p>
      </Shell>
    );
  }

  if (confirmed) {
    return (
      <Shell display={state.display}>
        <Centered
          mark="✓"
          title={labels.confirmedTitle}
          body={fill(labels.confirmedIntro, {
            when: `${formatDateTime(confirmed.startAt, confirmed.timeZone)} (heure de ${zoneLabel(
              confirmed.timeZone,
            )})`,
          })}
        />
        <Recap confirmation={confirmed} labels={labels} manageCta={labels.manageCta} />
        <p className="sched-note" style={{ marginTop: 14 }}>
          {labels.icsSent}
        </p>
      </Shell>
    );
  }

  const days = weekDayKeys(currentDay);

  async function submit() {
    if (!selected) return;
    if (name.trim().length === 0) {
      setFieldError(labels.errorNameRequired);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFieldError(labels.errorEmailInvalid);
      return;
    }
    setFieldError(null);
    setSubmitting(true);
    setBanner(null);

    try {
      const response = await fetch(
        `${apiBase}/links/${encodeURIComponent(token)}/book`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            startAt: selected.startAt,
            attendee: {
              name: name.trim(),
              email: email.trim(),
              phone: phone.trim() || null,
              timezone: timeZone,
            },
          }),
        },
      );

      if (response.ok) {
        const payload = (await response.json()) as {
          booking: { startAt: string; endAt: string; meetingLocation: MeetingLocation | null };
          manageUrl: string | null;
        };
        setConfirmed({
          startAt: payload.booking.startAt,
          endAt: payload.booking.endAt,
          timeZone: timeZone as string,
          meetingLocation: payload.booking.meetingLocation,
          manageUrl: payload.manageUrl,
        });
        return;
      }

      if (response.status === 429) {
        setBanner(labels.errorRateLimited);
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as { reason?: string };
      // Les deux courses : on rafraîchit et on garde la saisie.
      if (payload.reason === 'slot_taken' || payload.reason === 'invalid_slot') {
        setBanner(labels.errorSlotTaken);
        setSelected(null);
        setLoadedKey(null); // invalide la grille → rechargement, saisie conservée
        return;
      }
      if (payload.reason === 'target_changed') {
        setBanner(labels.errorTargetChanged);
        setSelected(null);
        setLoadedKey(null);
        return;
      }
      setBanner(labels.errorLinkGone);
    } catch {
      setBanner(labels.errorGeneric);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Shell display={state.display}>
      <Header state={state} labels={labels} />
      {banner ? (
        <p className="sched-banner sched-banner--warn" role="status">
          {banner}
        </p>
      ) : null}

      <TimezoneBar
        timeZone={timeZone}
        labels={labels}
        onChange={(zone) => {
          setChosenZone(zone);
          setSelected(null);
        }}
      />

      <div className="sched-week">
        <button
          type="button"
          className="sched-week-btn"
          aria-label={labels.previousWeek}
          onClick={() => setWeekDay(shiftWeek(currentDay, -1))}
        >
          ‹
        </button>
        <span>
          {fill(labels.weekOf, {
            date: formatShortDate(`${days[0]}T12:00:00Z`, 'UTC'),
          })}
        </span>
        <button
          type="button"
          className="sched-week-btn"
          aria-label={labels.nextWeek}
          onClick={() => setWeekDay(shiftWeek(currentDay, 1))}
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
        <div className="sched-form">
          <p className="sched-chosen">
            {labels.chosenSlot}
            <strong>{formatDateTime(selected.startAt, timeZone)}</strong>
            {fill(labels.timezoneLabel, { zone: zoneLabel(timeZone) })}
          </p>

          <label className="sched-label" htmlFor="sched-name">
            {labels.fieldName}
          </label>
          <input
            id="sched-name"
            className="sched-input"
            value={name}
            autoComplete="name"
            onChange={(event) => setName(event.currentTarget.value)}
          />

          <label className="sched-label" htmlFor="sched-email">
            {labels.fieldEmail}
          </label>
          <input
            id="sched-email"
            className="sched-input"
            type="email"
            inputMode="email"
            value={email}
            autoComplete="email"
            onChange={(event) => setEmail(event.currentTarget.value)}
          />

          <label className="sched-label" htmlFor="sched-phone">
            {labels.fieldPhone}
          </label>
          <input
            id="sched-phone"
            className="sched-input"
            type="tel"
            inputMode="tel"
            value={phone}
            autoComplete="tel"
            onChange={(event) => setPhone(event.currentTarget.value)}
          />

          {fieldError ? (
            <p className="sched-banner sched-banner--stop" role="alert" style={{ marginTop: 12 }}>
              {fieldError}
            </p>
          ) : null}

          <button
            type="button"
            className="sched-btn"
            disabled={submitting}
            onClick={() => void submit()}
          >
            {submitting ? labels.confirmingCta : labels.confirmCta}
          </button>

          <p className="sched-legal">
            {state.display.privacyNotice ?? labels.privacyNotice}
          </p>
        </div>
      ) : null}
    </Shell>
  );
}

// ─── Fragments partagés ─────────────────────────────────────────────────

function Shell({
  display,
  children,
}: {
  display: LinkDisplay | null;
  children: React.ReactNode;
}) {
  return (
    <div className="sched-shell">
      <div className="sched-card">
        {display?.organisation ? <p className="sched-org">{display.organisation}</p> : null}
        {children}
      </div>
    </div>
  );
}

function Header({ state, labels }: { state: OpenState; labels: SchedulingLabels }) {
  const locationName = {
    video: labels.locationVideo,
    in_person: labels.locationInPerson,
    phone: labels.locationPhone,
  };
  return (
    <>
      <h1 className="sched-title">
        {state.display.title ?? labels.bookingTitleFallback}
      </h1>
      <p className="sched-meta">
        {fill(labels.durationMinutes, { n: state.resource.slotDurationMinutes })}
        {state.meetingLocationType ? ` · ${locationName[state.meetingLocationType]}` : ''}
      </p>
    </>
  );
}

function Centered({
  mark,
  title,
  body,
}: {
  mark: string;
  title: string;
  body: string;
}) {
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

export function Recap({
  confirmation,
  labels,
  manageCta,
}: {
  confirmation: BookingConfirmation;
  labels: SchedulingLabels;
  manageCta: string | null;
}) {
  const place = describePlace(confirmation.meetingLocation, labels);
  return (
    <>
      <dl className="sched-recap">
        <dt>{labels.recapWhen}</dt>
        <dd>
          {formatDateTime(confirmation.startAt, confirmation.timeZone)}
          <br />
          {formatTimeRange(confirmation.startAt, confirmation.endAt, confirmation.timeZone)}
          {' · '}
          {fill(labels.timezoneLabel, { zone: zoneLabel(confirmation.timeZone) })}
        </dd>
        {place ? (
          <>
            <dt>{labels.recapWhere}</dt>
            <dd>{place}</dd>
          </>
        ) : null}
      </dl>
      {manageCta && confirmation.manageUrl ? (
        <a className="sched-btn sched-btn--ghost" href={confirmation.manageUrl}>
          {manageCta}
        </a>
      ) : null}
    </>
  );
}

function describePlace(
  location: MeetingLocation | null,
  labels: SchedulingLabels,
): React.ReactNode {
  if (!location) return null;
  if (location.type === 'video') {
    return (
      <>
        {labels.locationVideo}
        <br />
        <a href={location.payload.url}>{location.payload.url}</a>
      </>
    );
  }
  if (location.type === 'in_person') {
    return (
      <>
        {labels.locationInPerson}
        <br />
        {location.payload.address}
      </>
    );
  }
  return (
    <>
      {labels.locationPhone}
      <br />
      {location.payload.instructions}
    </>
  );
}
