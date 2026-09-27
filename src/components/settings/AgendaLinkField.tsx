'use client';

/**
 * « Agenda des entretiens » dans les Paramètres (27/09/2026).
 *
 * Avant : un champ « Lien d'agenda » Cal.com qui criait « non configuré, les
 * acceptations ne pourront pas être envoyées » dès qu'il était vide — sur une
 * instance neuve, c'était le premier message, alors que ce lien n'y sert à
 * rien : toute campagne créée dans ORQA est en réservation native, et le
 * candidat retenu reçoit un lien personnel sur les disponibilités du référent.
 *
 * Maintenant l'agenda INTERNE est l'agenda par défaut, affiché en tête avec
 * l'état de chaque recruteur (il existe dès que ses disponibilités sont
 * renseignées). Le lien externe devient un repli replié, qui ne s'ouvre de
 * lui-même que s'il est renseigné ou si une campagne en dépend réellement.
 * Les avertissements viennent de l'état des CAMPAGNES (même sonde que
 * l'envoi, `/api/settings/agenda-status`), jamais de l'état du champ.
 */

import { useEffect, useState } from 'react';

import { InternalAgendaRecruiters } from '@/components/settings/InternalAgendaRecruiters';
import { useRecruiterOptions } from '@/lib/campaign/use-recruiter-options';
import {
  agendaFieldNotices,
  type AgendaNotice,
  type AgendaStatus,
} from '@/lib/interview/agenda-status';

const TONE_CLASS: Record<AgendaNotice['tone'], string> = {
  ok: 'text-emerald-700',
  warn: 'font-semibold text-amber-700',
};

function useAgendaStatus(): AgendaStatus | null | undefined {
  // `undefined` = en cours de lecture, `null` = lecture impossible.
  const [status, setStatus] = useState<AgendaStatus | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/agenda-status')
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { status?: AgendaStatus } | null) => {
        if (!cancelled) setStatus(json?.status ?? null);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}

export function AgendaLinkField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const status = useAgendaStatus();
  const { options, currentUserId } = useRecruiterOptions();
  const notices = status === undefined ? [] : agendaFieldNotices(status, value);
  const externalNeeded = (status?.externalOnField ?? 0) > 0;

  return (
    <div className="flex flex-col gap-2" data-role="agenda-link-field">
      <div className="flex flex-col gap-1">
        <span className="font-semibold text-stone-700">
          Agenda des entretiens — agenda interne ORQA (par défaut)
        </span>
        <span className="text-[11px] text-stone-500">
          Chaque candidat retenu reçoit un lien personnel pour réserver un créneau sur
          les disponibilités du référent de la campagne. Un recruteur a son agenda
          interne dès que ses disponibilités sont renseignées (« Agendas &amp;
          disponibilités ») : rien d&apos;autre à configurer.
        </span>
        <InternalAgendaRecruiters options={options} currentUserId={currentUserId} />
      </div>

      {notices.map((n) => (
        <span key={n.text} data-agenda-notice={n.tone} className={`text-[11px] ${TONE_CLASS[n.tone]}`}>
          {n.tone === 'warn' ? '⚠ ' : '✓ '}
          {n.text}
        </span>
      ))}

      <details open={value.trim().length > 0 || externalNeeded} className="text-[12px]">
        <summary className="cursor-pointer font-semibold text-stone-600">
          Lien d&apos;agenda externe (facultatif)
        </summary>
        <label className="mt-2 flex flex-col gap-1">
          <input
            type="url"
            value={value}
            onChange={(e) => onChange(e.currentTarget.value)}
            placeholder="https://cal.com/votre-equipe/entretien"
            className="w-full rounded-md border border-stone-200 px-2 py-1.5 text-stone-700 outline-none focus:border-emerald-400"
          />
          <span className="text-[11px] text-stone-400">
            Calendly, Cal.com… Ne sert qu&apos;à une campagne dont la réservation native
            a été désactivée ; il est alors injecté dans{' '}
            <code>[lien d&apos;agenda]</code>. Laissez vide si vous utilisez l&apos;agenda
            interne.
          </span>
        </label>
      </details>
    </div>
  );
}
