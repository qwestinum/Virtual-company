'use client';

/**
 * Rapport de campagne (écran) — « Du CV au recrutement » : le même entonnoir
 * que le PDF (feat/feedback-candidat, lot 5). Un indicateur, jamais le
 * contenu des messages.
 */

import type { InterviewFunnel } from '@/lib/reporting/interview-funnel';

export function CampaignFunnelSection({ funnel }: { funnel: InterviewFunnel }) {
  const etapes: [number, string][] = [
    [funnel.received, 'Reçues'],
    [funnel.invited, 'Invités'],
    [funnel.interviewed, 'Entretiens'],
    [funnel.retained, 'Retenus'],
    [funnel.hired, 'Recrutés'],
  ];
  return (
    <section data-role="campaign-funnel" className="rounded-xl border border-stone-200 bg-white p-5">
      <p className="mb-3 font-display text-[12px] font-bold uppercase tracking-wide text-amber-600">
        Du CV au recrutement
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {etapes.map(([n, label]) => (
          <div key={label} className="rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2">
            <p className="font-display text-[20px] font-bold text-stone-900">{n}</p>
            <p className="font-body text-[11px] uppercase text-stone-500">{label}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-1 font-body text-[13px] text-stone-700">
        {funnel.placementRate !== null ? (
          <p>Taux de placement : {funnel.placementRate} % (recrutés / retenus présentés).</p>
        ) : null}
        {funnel.informed ? (
          <p data-role="informed-indicator">
            Candidats reçus en entretien informés de la décision : {funnel.informed.informed}/
            {funnel.informed.total}.
          </p>
        ) : null}
      </div>
    </section>
  );
}
