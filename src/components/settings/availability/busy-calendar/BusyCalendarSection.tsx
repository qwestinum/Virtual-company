'use client';

/**
 * Agenda externe — l'agenda publié du recruteur, retiré de ses créneaux.
 *
 * N'apparaît pas du tout si l'installation n'a pas la fonction (404). Si le
 * cabinet l'a éteinte, on ne propose rien de nouveau — mais un lien déjà
 * enregistré est SIGNALÉ comme ignoré, et reste retirable.
 */
import { useEffect, useState } from 'react';

import { busyCalendarHeadline, type BusyCalendarTone } from '@/lib/interviews/busy-calendar-view';

import { BusyCalendarForm } from './BusyCalendarForm';
import { BusyCalendarGuide } from './BusyCalendarGuide';
import { useBusyCalendar, type BusyCalendarFeedback } from './useBusyCalendar';

const TONE: Record<BusyCalendarTone | BusyCalendarFeedback['tone'], string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-900',
  muted: 'border-stone-200 bg-stone-50 text-stone-700',
};

export function BusyCalendarSection({ recruiterId }: { recruiterId: string }) {
  const { status, busy, feedback, testedUrl, test, save, clear, resetTest } = useBusyCalendar(recruiterId);
  const [replacing, setReplacing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  // Horloge de l'affichage (« relu il y a N min ») — rafraîchie à la minute.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (status === undefined || status === null) return null;
  if (!status.available && !status.configured) return null;

  const headline = busyCalendarHeadline(status, nowMs);
  const showForm = status.available && (!status.configured || replacing);

  return (
    <section className="flex flex-col gap-3 border-t border-stone-200 pt-4" aria-labelledby="busy-calendar-title">
      <div>
        <h3 id="busy-calendar-title" className="font-body text-[13.5px] font-semibold text-stone-800">
          Agenda externe
        </h3>
        <p className="font-body text-[12.5px] text-stone-600">
          Relie ton agenda Outlook : ORQA ne proposera jamais un créneau où tu es déjà pris ailleurs. Il sait
          quand tu es pris, pas pourquoi.
        </p>
      </div>

      <p role="status" className={`rounded-md border px-3 py-2 font-body text-[12.5px] ${TONE[headline.tone]}`}>
        {headline.text}
        {status.action ? <span className="mt-1 block font-semibold">{status.action}</span> : null}
      </p>

      {status.configured && !replacing ? (
        <div className="flex flex-wrap items-center gap-3 font-body text-[12.5px]">
          {status.available ? (
            <button type="button" className="text-stone-700 underline hover:text-stone-900" onClick={() => setReplacing(true)}>
              Remplacer le lien
            </button>
          ) : null}
          {confirmClear ? (
            <>
              <span className="text-stone-700">Retirer ton agenda externe ?</span>
              <button
                type="button"
                className="rounded-md bg-red-700 px-2 py-1 font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                disabled={busy !== null}
                onClick={() => void clear().then(() => setConfirmClear(false))}
              >
                {busy === 'clear' ? 'Retrait…' : 'Oui, retirer'}
              </button>
              <button type="button" className="text-stone-500 underline" onClick={() => setConfirmClear(false)}>
                Garder
              </button>
            </>
          ) : (
            <button type="button" className="text-red-700 underline hover:text-red-800" onClick={() => setConfirmClear(true)}>
              Retirer le lien
            </button>
          )}
        </div>
      ) : null}

      {showForm ? (
        <BusyCalendarForm
          busy={busy}
          testedUrl={testedUrl}
          replacing={replacing}
          onTest={(url) => void test(url)}
          onSave={async (url) => {
            const saved = await save(url);
            if (saved) setReplacing(false);
            return saved;
          }}
          onEdit={resetTest}
          onCancel={replacing ? () => setReplacing(false) : undefined}
        />
      ) : null}

      {feedback ? (
        <div role="status" className={`rounded-md border px-3 py-2 font-body text-[12.5px] ${TONE[feedback.tone]}`}>
          <p>{feedback.text}</p>
          {feedback.warnings.map((warning) => (
            <p key={warning} className="mt-1 font-semibold">
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      {status.available ? <BusyCalendarGuide /> : null}
    </section>
  );
}
