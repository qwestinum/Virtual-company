'use client';

/**
 * Historique des envois d'un rapport de campagne (cf. docs/specs/reporting.md
 * §3.5). Ouverte au clic sur la mention « Rapport envoyé N fois ». Lecture
 * seule. Source : journal d'audit (action campaign_report_sent).
 */

import { X } from 'lucide-react';

import { formatFrDateTime } from '@/lib/reporting/audit-display';
import type { CampaignReportSend } from '@/types/reporting';

export function SentHistoryModal({
  open,
  onClose,
  jobTitle,
  sends,
}: {
  open: boolean;
  onClose: () => void;
  jobTitle: string;
  sends: CampaignReportSend[];
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-stone-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <p className="font-display text-[15px] font-bold text-stone-900">
            Historique des envois
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-stone-400 hover:bg-stone-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="mb-3 font-body text-[12px] text-stone-500">
            Rapport « {jobTitle} »
          </p>
          {sends.length === 0 ? (
            <p className="font-body text-[13px] text-stone-500">
              Aucun envoi enregistré.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sends.map((s, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-stone-200 px-3 py-2"
                >
                  <p className="font-body text-[13px] font-semibold text-stone-800">
                    {formatFrDateTime(s.at)}
                  </p>
                  <p className="font-body text-[12px] text-stone-500">
                    {s.to.join(', ') || '— destinataire inconnu'}
                  </p>
                  {s.subject ? (
                    <p className="truncate font-body text-[12px] text-stone-400">
                      {s.subject}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
