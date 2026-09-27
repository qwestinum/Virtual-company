'use client';

/**
 * Onglet « Historique » — le registre des entretiens passés : qui a rencontré
 * qui, quand, et le verdict.
 *
 * LECTURE SEULE. Les gestes (pointer, trancher, classer) vivent dans les
 * onglets qui les portent déjà ; les répéter ici ferait deux chemins vers la
 * même décision. Le recruteur nommé est celui qui TENAIT le rendez-vous (la
 * ressource est figée à la réservation), comme dans « Programmés ».
 */

import { initials, STAGE_TONE_BG, STAGE_TONE_COLOR } from '@/components/candidatures/stage-ui';
import { ReferentMention } from '@/components/referent/ReferentMention';
import { ListRow } from '@/components/ui/ListRow';
import { PASTILLE } from '@/components/ui/tokens';
import {
  HISTORY_VERDICT_LABELS,
  type HistoryRow,
  type HistoryVerdict,
} from '@/lib/interviews/history-rows';
import type { RowReferent } from '@/lib/interviews/referent-resolution';
import type { CandidateStageTone } from '@/lib/reporting/candidate-stage';

import { formatSlot } from './interview-row-ui';

export type HistoryItem = HistoryRow & { campaignName: string | null } & RowReferent;

/**
 * Tonalités des pastilles d'étape (contraste AA mesuré par leur test).
 * « Absent » et « Classée sans suite » sont NEUTRES : ni l'un ni l'autre
 * n'est un jugement porté sur le candidat.
 */
const TONE: Record<HistoryVerdict, CandidateStageTone> = {
  a_pointer: 'pending',
  verdict_attendu: 'pending',
  retenu: 'positive',
  non_retenu: 'negative',
  absent: 'neutral',
  sans_suite: 'neutral',
};

export function HistoryList({ rows }: { rows: HistoryItem[] }) {
  if (rows.length === 0) {
    return (
      <p className="font-body text-[13px] italic text-stone-400">
        Aucun entretien passé.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5" data-interview-history>
      {rows.map((row) => {
        const tone = TONE[row.verdict];
        return (
          <ListRow
            key={row.briefId}
            testId={row.briefId}
            initials={initials(row.candidateName)}
            avatarColor={PASTILLE.candidat}
            title={row.candidateName}
            pill={row.campaignName ?? null}
            reference={row.campaignId}
            meta={[row.campaignId ? null : 'hors campagne', formatSlot(row.interviewStartAt)]
              .filter(Boolean)
              .join(' · ')}
            right={
              <>
                <span className="font-body text-[12px] text-stone-500">
                  <ReferentMention referent={row.referent} supersededBy={row.supersededBy} />
                </span>
                <span
                  data-history-verdict={row.verdict}
                  className="rounded-full px-2.5 py-0.5 font-body text-[12px] font-semibold"
                  style={{ color: STAGE_TONE_COLOR[tone], background: STAGE_TONE_BG[tone] }}
                >
                  {HISTORY_VERDICT_LABELS[row.verdict]}
                </span>
              </>
            }
          />
        );
      })}
    </div>
  );
}
