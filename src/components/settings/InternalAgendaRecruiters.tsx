'use client';

/**
 * Agenda interne de chaque recruteur — un agenda EXISTE dès que ses
 * disponibilités sont renseignées (« Agendas & disponibilités »), et c'est lui
 * que reçoit le candidat retenu, par un lien personnel. Rien à configurer
 * d'autre : c'est l'agenda PAR DÉFAUT d'une instance (27/09/2026).
 *
 * L'état vient de `/api/recruiters/options` (la même lecture que le sélecteur
 * de référent) : `hasAvailability === null` = module injoignable, on le dit
 * sans conclure.
 */

import type { RecruiterOption } from '@/lib/campaign/use-recruiter-options';

function statusOf(o: RecruiterOption): { mark: string; text: string; className: string } {
  if (o.hasAvailability === true) {
    return {
      mark: '✓',
      text: 'agenda interne actif (disponibilités renseignées)',
      className: 'text-emerald-700',
    };
  }
  if (o.hasAvailability === false) {
    return {
      mark: '⚠',
      text: 'disponibilités à renseigner — sans elles, ses campagnes ne peuvent pas inviter',
      className: 'font-semibold text-amber-700',
    };
  }
  return { mark: '·', text: 'état de l’agenda indisponible', className: 'text-stone-500' };
}

export function InternalAgendaRecruiters({
  options,
  currentUserId,
}: {
  options: RecruiterOption[] | null;
  currentUserId: string | null;
}) {
  if (options === null) {
    return <p className="text-[12px] text-stone-400">Lecture des agendas…</p>;
  }
  if (options.length === 0) {
    return (
      <p className="text-[12px] font-semibold text-amber-700">
        ⚠ Aucun recruteur actif : ajoutez-en un (section « Recruteurs ») puis renseignez
        ses disponibilités.
      </p>
    );
  }
  // Soi-même en tête : c'est l'agenda qu'on vient régler.
  const ordered = [...options].sort(
    (a, b) => Number(b.id === currentUserId) - Number(a.id === currentUserId),
  );
  return (
    <ul className="flex flex-col gap-1" data-role="internal-agendas">
      {ordered.map((o) => {
        const s = statusOf(o);
        return (
          <li key={o.id} className="text-[12px]" data-agenda-recruiter={o.id}>
            <span className="font-semibold text-stone-700">
              {o.displayName}
              {o.id === currentUserId ? ' (vous)' : ''}
            </span>{' '}
            <span className={s.className}>
              {s.mark} {s.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
