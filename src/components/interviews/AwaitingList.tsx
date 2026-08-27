'use client';

/**
 * Onglet « En attente de réservation » — les invitations parties sans créneau
 * choisi, tous régimes confondus.
 *
 * L'ancienneté compte depuis la MISE EN ATTENTE, pas depuis l'invitation
 * d'origine : un dossier remis en attente après une annulation naîtrait sinon
 * « en retard de trois semaines », et un badge qui crie faux ne se lit plus.
 *
 * L'état du lien n'existe qu'en réservation native. En régime Cal.com, il n'y
 * a pas d'objet lien à interroger : on l'écrit plutôt que de laisser une
 * colonne vide qu'on prendrait pour une anomalie.
 */

import { ReferentMention } from '@/components/referent/ReferentMention';
import type { RowReferent } from '@/lib/interviews/referent-resolution';
import type { AwaitingRow } from '@/lib/interviews/pipeline-rows';

export type AwaitingItem = AwaitingRow & {
  campaignName: string | null;
} & RowReferent;

const LINK_LABEL: Record<NonNullable<AwaitingRow['linkStatus']>, string> = {
  active: 'lien actif',
  expired: 'lien expiré',
  revoked: 'lien révoqué',
  used: 'lien déjà utilisé',
};

export function AwaitingList({
  rows,
  busyId,
  onReinvite,
  onDismiss,
}: {
  rows: AwaitingItem[];
  busyId: string | null;
  onReinvite: (row: AwaitingItem) => void;
  onDismiss: (row: AwaitingItem) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="font-body text-[13px] italic text-stone-400">
        Personne n’attend de réservation.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => {
        const dead = row.linkStatus === 'expired' || row.linkStatus === 'revoked';
        return (
          <li
            key={row.briefId}
            className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 ${
              row.overdue || dead
                ? 'border-amber-200 bg-amber-50/40'
                : 'border-stone-200 bg-white'
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-body text-[13.5px] font-semibold text-stone-800">
                {row.candidateName}
              </p>
              <p className="truncate font-body text-[12px] text-stone-500">
                {/* L'IDENTIFIANT d'abord : c'est lui qu'on retrouve dans les
                    objets de mail, le journal et les échanges d'équipe — le
                    nom de campagne, lui, peut être long et se ressembler. */}
                {row.campaignId ? (
                  <span className="font-data text-stone-600">{row.campaignId}</span>
                ) : (
                  'hors campagne'
                )}
                {row.campaignName ? ` · ${row.campaignName}` : ''}
                {row.jobTitle ? ` · ${row.jobTitle}` : ''}
                {' · '}
                {/* Le référent de la CAMPAGNE : c'est son agenda que le
                    candidat verra en ouvrant son lien. */}
                <ReferentMention referent={row.referent} />
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-end">
              <span
                className={`font-body text-[12px] ${
                  row.overdue ? 'font-semibold text-amber-800' : 'text-stone-500'
                }`}
              >
                {row.waitingDays === 0
                  ? 'invité aujourd’hui'
                  : `invité il y a ${row.waitingDays} j`}
              </span>
              <span
                className={`font-body text-[11.5px] ${
                  dead ? 'font-semibold text-amber-800' : 'text-stone-400'
                }`}
              >
                {row.linkStatus
                  ? LINK_LABEL[row.linkStatus]
                  : 'lien d’agenda Cal.com'}
              </span>
            </div>

            <button
              type="button"
              disabled={busyId === row.briefId || !row.analysisId}
              onClick={() => onReinvite(row)}
              className="rounded-md border border-stone-300 px-2.5 py-1 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-40"
            >
              {busyId === row.briefId ? 'Envoi…' : 'Renvoyer une invitation'}
            </button>
            <button
              type="button"
              disabled={!row.analysisId}
              onClick={() => onDismiss(row)}
              className="rounded-md border border-stone-300 px-2.5 py-1 font-body text-[12px] font-semibold text-stone-500 hover:bg-stone-50 disabled:opacity-40"
            >
              Classer sans suite
            </button>
          </li>
        );
      })}
    </ul>
  );
}
