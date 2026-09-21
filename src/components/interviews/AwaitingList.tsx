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

import { initials } from '@/components/candidatures/stage-ui';
import { ReferentMention } from '@/components/referent/ReferentMention';
import { ListRow } from '@/components/ui/ListRow';

import { Action } from './interview-row-ui';
import type { RowReferent } from '@/lib/interviews/referent-resolution';
import type { AwaitingRow } from '@/lib/interviews/pipeline-rows';
import { PASTILLE } from '@/components/ui/tokens';

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
    <ul className="flex flex-col gap-3">
      {rows.map((row) => {
        const dead = row.linkStatus === 'expired' || row.linkStatus === 'revoked';
        const alerte = row.overdue || dead;
        return (
          <li key={row.briefId}>
            {/* ⚠️ LA LIGNE DE CANDIDATURES, importée. C'était une rangée à
                colonne de droite empilée et bandeau ambre : rien de commun
                avec la liste d'à côté, pour la même nature d'objet. */}
            <ListRow
              testId={row.briefId}
              initials={initials(row.candidateName)}
              avatarColor={PASTILLE.candidat}
              title={row.candidateName}
              pill={row.jobTitle ?? row.campaignName ?? null}
              // ⚠️ La chasse fixe est réservée à la RÉFÉRENCE : « hors
              // campagne » est une phrase, pas un identifiant qu'on recopie.
              reference={row.campaignId}
              meta={[
                row.campaignId ? null : 'hors campagne',
                row.waitingDays === 0
                  ? 'invité aujourd’hui'
                  : `invité il y a ${row.waitingDays} j`,
              ]
                .filter(Boolean)
                .join(' · ')}
              right={
                <>
                  <span className="font-body text-[12px] text-stone-500">
                    {/* Le référent de la CAMPAGNE : c'est son agenda que le
                        candidat verra en ouvrant son lien. */}
                    <ReferentMention referent={row.referent} />
                  </span>

                  <span
                    className={`whitespace-nowrap font-body text-[11.5px] ${
                      dead ? 'font-semibold text-amber-800' : 'text-stone-400'
                    }`}
                  >
                    {row.linkStatus
                      ? LINK_LABEL[row.linkStatus]
                      : 'lien d’agenda Cal.com'}
                  </span>

                  <Action
                    disabled={busyId === row.briefId || !row.analysisId}
                    onClick={() => onReinvite(row)}
                  >
                    {busyId === row.briefId ? 'Envoi…' : 'Renvoyer une invitation'}
                  </Action>
                  <Action disabled={!row.analysisId} onClick={() => onDismiss(row)}>
                    Classer sans suite
                  </Action>
                </>
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
