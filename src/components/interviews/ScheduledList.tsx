'use client';

/**
 * Onglet « Programmés » — les rendez-vous, avec en TÊTE ceux qui sont passés
 * sans pointage.
 *
 * L'ordre n'est pas chronologique par principe : ce qui attend une action
 * passe devant. Un entretien d'hier que personne n'a pointé bloque toute la
 * suite du dossier ; le mettre en bas de page, sous les rendez-vous à venir,
 * revient à le cacher.
 *
 * Le système ne transitionne JAMAIS un rendez-vous passé tout seul : sans
 * pointage humain il reste `scheduled` et le signal insiste. Constater une
 * absence est un jugement, pas une conséquence de l'horloge.
 */

import { initials } from '@/components/candidatures/stage-ui';
import { ListRow } from '@/components/ui/ListRow';
import { useState } from 'react';

import { ReferentMention } from '@/components/referent/ReferentMention';
import type { ScheduledRow } from '@/lib/interviews/pipeline-rows';
import type { RowReferent } from '@/lib/interviews/referent-resolution';
import type { FinalVerdict } from '@/types/verdict-comment';

import { Action, formatSlot, SECTIONS } from './interview-row-ui';
import { VerdictExpansion, VerdictRowActions } from './VerdictRow';

export type ScheduledItem = ScheduledRow & {
  campaignName: string | null;
} & RowReferent;

export function ScheduledList({
  rows,
  busyId,
  onRealized,
  onMissed,
  onDecided,
  onStale,
  onDismiss,
  onReschedule,
  onCancel,
  onCorrected,
}: {
  rows: ScheduledItem[];
  busyId: string | null;
  onRealized: (row: ScheduledItem) => void;
  onMissed: (row: ScheduledItem) => void;
  /** Verdict posé (commentaire compris) par le bloc de décision. */
  onDecided: (row: ScheduledItem, verdict: FinalVerdict) => void;
  /** Le dossier a bougé ailleurs : la page recharge. */
  onStale: () => void;
  onDismiss: (row: ScheduledItem) => void;
  onReschedule: (row: ScheduledItem) => void;
  onCancel: (row: ScheduledItem) => void;
  /** Une décision corrigée change l'étape : la page se recharge. */
  onCorrected: () => void;
}) {
  // Une seule ligne dépliée à la fois : on motive UNE décision à la fois.
  const [openId, setOpenId] = useState<string | null>(null);
  if (rows.length === 0) {
    return (
      <p className="font-body text-[13px] italic text-stone-400">
        Aucun entretien programmé.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {SECTIONS.map((section) => {
        const items = rows.filter((r) => r.section === section.key);
        if (items.length === 0) return null;
        return (
          <section key={section.key}>
            <h3 className="mb-1.5 font-display text-[16px] font-bold text-stone-900">
              {section.title} ({items.length})
            </h3>
            {section.hint ? (
              <p className="mb-1.5 font-body text-[12px] text-stone-500">
                {section.hint}
              </p>
            ) : null}
            <ul className="mt-2 flex flex-col gap-3">
              {items.map((row) => (
                <li key={row.briefId}>
                  {/* ⚠️ LA LIGNE DE CANDIDATURES, importée : pavé d'initiales,
                      nom en gras, puce d'intitulé UNE fois, référence en chasse
                      fixe — le seul monospace de la ligne — puis le délai en
                      gris. C'était une rangée à bandeau ambre et colonne de
                      date, sans rapport avec le reste du produit. */}
                  <ListRow
                    testId={row.briefId}
                    initials={initials(row.candidateName)}
                    avatarColor={
                      section.key === 'a_pointer'
                        ? 'var(--dash-orange)'
                        : 'var(--dash-teal)'
                    }
                    title={row.candidateName}
                    pill={row.campaignName ?? null}
                    reference={row.campaignId}
                    meta={[
                      row.campaignId ? null : 'hors campagne',
                      formatSlot(row.interviewStartAt),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    right={
                      <>
                        <span className="font-body text-[12px] text-stone-500">
                          {/* Celui qui TIENT le rendez-vous — la ressource est
                              figée à la réservation et ne suit pas un
                              changement de référent. Quand les deux diffèrent,
                              on le dit. */}
                          <ReferentMention
                            referent={row.referent}
                            supersededBy={row.supersededBy}
                          />
                        </span>

                        {section.key === 'a_pointer' ? (
                    <>
                      <Action
                        disabled={busyId === row.briefId}
                        tone="positive"
                        onClick={() => onRealized(row)}
                      >
                        Entretien réalisé
                      </Action>
                      <Action
                        disabled={busyId === row.briefId}
                        onClick={() => onMissed(row)}
                      >
                        Candidat absent
                      </Action>
                    </>
                  ) : null}

                        {section.key === 'a_venir' ? (
                    <>
                      <Action
                        disabled={busyId === row.briefId || !row.analysisId}
                        onClick={() => onReschedule(row)}
                      >
                        Replanifier
                      </Action>
                      <Action
                        disabled={busyId === row.briefId || !row.bookingUid}
                        onClick={() => onCancel(row)}
                      >
                        Annuler
                      </Action>
                    </>
                  ) : null}

                        {section.key === 'verdict_attendu' ? (
                          <VerdictRowActions
                            row={row}
                            open={openId === row.briefId}
                            onToggle={() =>
                              setOpenId(openId === row.briefId ? null : row.briefId)
                            }
                            onCorrected={onCorrected}
                          />
                        ) : null}

                        <Action disabled={!row.analysisId} onClick={() => onDismiss(row)}>
                          Classer sans suite
                        </Action>
                      </>
                    }
                  />

                  {/* Le dépliant de verdict vit SOUS la ligne : il porte un
                      commentaire libre, et l'entasser à droite écraserait la
                      ligne au lieu de l'expliquer. */}
                  {section.key === 'verdict_attendu' && openId === row.briefId ? (
                    <VerdictExpansion
                      row={row}
                      onDecided={(verdict) => {
                        setOpenId(null);
                        onDecided(row, verdict);
                      }}
                      onStale={onStale}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
