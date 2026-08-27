'use client';

/**
 * Onglet « Entretiens » — poste de pilotage du cycle d'entretien.
 *
 * Trois onglets — les entretiens (défaut : c'est l'agenda qu'on vient
 * consulter), ce qui attend une réservation, ce qui attend un verdict — une
 * seule source (`interview_briefs`) et AUCUN état parallèle :
 * chaque action repose sur les marquages qui font déjà foi partout ailleurs
 * (`candidate_interview_marked`, `candidate_validation_marked`, classement
 * sans suite). Le ruban Candidatures, le Bureau et les rapports en dérivent
 * sans rien recâbler.
 *
 * Le système SIGNALE, l'humain ACTE : aucun rendez-vous passé ne se
 * transitionne tout seul.
 *
 * Les compteurs d'onglet comptent les LIGNES RENDUES. Compter la table
 * annonçait 5 là où l'écran en montrait 3 (filtre « candidature ouverte » et
 * déduplication) : un compteur qui ne compte pas ce qu'on voit fait douter des
 * deux.
 */

import { Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { CandidatureDismissDialog } from '@/components/candidatures/CandidatureDismissDialog';
import { ReferentFilterBar } from '@/components/referent/ReferentFilterBar';
import {
  markCandidateInterview,
  markCandidateValidation,
} from '@/lib/dashboard/candidate-actions';
import type { InterviewPipeline } from '@/lib/interviews/pipeline';
import type { RowReferent } from '@/lib/interviews/referent-resolution';
import {
  ALL_REFERENTS,
  buildReferentOptionsBy,
  filterByReferentBy,
  myReferentCountBy,
  type ReferentSelection,
} from '@/lib/referent/filter';

import { AwaitingList, type AwaitingItem } from './AwaitingList';
import { InterviewSignals } from './InterviewSignals';
import { InterviewTabs, type InterviewTabKey } from './InterviewTabs';
import { NoShowDialog, type NoShowChoice } from './NoShowDialog';
import { ScheduledList, type ScheduledItem } from './ScheduledList';

const EMPTY: InterviewPipeline = {
  awaiting: [],
  scheduled: [],
  verdict: [],
  orphans: [],
  counts: { awaiting: 0, scheduled: 0, verdict: 0, toPoint: 0, unresolved: 0 },
};

type Row = AwaitingItem | ScheduledItem;
type PageTab = InterviewTabKey;

/**
 * Le filtre porte sur le recruteur AFFICHÉ — celui qui TIENT le rendez-vous
 * pour un créneau déjà pris, le référent de la campagne pour une invitation en
 * attente. Filtrer sur autre chose que ce qui est écrit ferait mentir l'écran.
 */
const referentOfRow = (row: RowReferent) => row.referent;

export function InterviewsWorkspace({
  initialSection = null,
}: {
  /** Cible d'un signal métier : ouvre directement le bon onglet. */
  initialSection?: 'a_pointer' | 'awaiting' | null;
}) {
  const [pipeline, setPipeline] = useState<InterviewPipeline>(EMPTY);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // Commodité de LECTURE : aucune restriction d'accès, aucune persistance.
  const [referentFilter, setReferentFilter] =
    useState<ReferentSelection>(ALL_REFERENTS);
  // Défaut : les entretiens. C'est l'agenda de la semaine — ce qu'on vient
  // regarder en ouvrant la page ; les invitations en attente sont une file
  // qu'on traite, pas ce qu'on consulte en premier.
  const [tab, setTab] = useState<PageTab>(
    initialSection === 'awaiting' ? 'awaiting' : 'scheduled',
  );
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noShow, setNoShow] = useState<ScheduledItem | null>(null);
  const [dismissing, setDismissing] = useState<Row | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/interviews', { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as InterviewPipeline & {
        currentUserId?: string | null;
      };
      setPipeline(json);
      setCurrentUserId(json.currentUserId ?? null);
    } catch {
      // Réseau KO : on garde l'état précédent plutôt que de vider l'écran.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /** Réémission d'invitation — le MÊME geste sert l'attente et le no-show. */
  async function reinvite(row: Row, kind: 'reinvite' | 'reschedule') {
    if (!row.analysisId) return;
    setBusyId(row.briefId);
    setNotice(null);
    try {
      const res = await fetch('/api/interviews/reissue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisId: row.analysisId, kind }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        status?: string;
      };
      setNotice(
        res.ok && data.status === 'sent'
          ? 'Invitation envoyée au candidat.'
          : (data.message ?? 'L’invitation n’a pas pu être envoyée.'),
      );
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function mark(row: ScheduledItem, status: 'realized' | 'missed') {
    if (!row.uid) return;
    setBusyId(row.briefId);
    try {
      await markCandidateInterview({
        uid: row.uid,
        candidateName: row.candidateName,
        campaignId: row.campaignId,
        status,
      });
      setNotice(
        status === 'realized'
          ? 'Entretien pointé — le candidat attend maintenant votre verdict.'
          : 'Absence enregistrée — candidature classée non retenue.',
      );
      await load();
    } finally {
      setBusyId(null);
    }
  }

  /** Le fait d'abord, la décision ensuite : rien n'est posé avant ce choix. */
  async function resolveNoShow(choice: NoShowChoice) {
    const row = noShow;
    if (!row) return;
    setNoShow(null);
    if (choice === 'reject') await mark(row, 'missed');
    else await reinvite(row, 'reinvite');
  }

  async function verdict(row: ScheduledItem, status: 'validated' | 'rejected') {
    if (!row.uid) return;
    setBusyId(row.briefId);
    try {
      await markCandidateValidation({
        uid: row.uid,
        candidateName: row.candidateName,
        campaignId: row.campaignId,
        status,
      });
      setNotice(
        status === 'validated'
          ? `${row.candidateName} est retenu.`
          : `${row.candidateName} n’est pas retenu.`,
      );
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function cancelBooking(row: ScheduledItem) {
    if (!row.bookingUid) return;
    setBusyId(row.briefId);
    try {
      const res = await fetch(
        `/api/interviews/${encodeURIComponent(row.bookingUid)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'annulation par le cabinet' }),
        },
      );
      setNotice(
        res.ok
          ? 'Rendez-vous annulé — le candidat en est informé.'
          : 'L’annulation n’a pas abouti.',
      );
      await load();
    } finally {
      setBusyId(null);
    }
  }

  // Le filtre s'applique aux LISTES. Les compteurs d'alerte, eux, restent sur
  // le pipeline complet (cf. plus bas) : un filtre de confort ne masque jamais
  // un dossier en souffrance.
  const allRows: RowReferent[] = [
    ...pipeline.awaiting,
    ...pipeline.scheduled,
    ...pipeline.verdict,
  ];
  const options = buildReferentOptionsBy(allRows, referentOfRow);
  const myCount = myReferentCountBy(allRows, referentOfRow, currentUserId);
  const filter = <T extends RowReferent>(rows: T[]) =>
    filterByReferentBy(rows, referentOfRow, referentFilter);
  const awaiting = filter(pipeline.awaiting);
  const scheduled = filter(pipeline.scheduled);
  const verdictRows = filter(pipeline.verdict);

  return (
    <div className="h-full overflow-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="mb-1 font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
              Cycle d’entretien
            </p>
            <h1 className="font-display text-3xl font-bold text-stone-900">
              Entretiens
            </h1>
          </div>
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-2.5 py-1.5 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-50"
            onClick={() => void load()}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Rafraîchir
          </button>
        </header>

        <InterviewSignals orphans={pipeline.orphans} />

        <ReferentFilterBar
          options={options}
          selection={referentFilter}
          onChange={setReferentFilter}
          myCount={myCount}
          currentUserId={currentUserId}
        />

        <InterviewTabs
          active={tab}
          onSelect={setTab}
          tabs={[
            {
              key: 'scheduled',
              label: 'Entretiens',
              count: scheduled.length,
              total: pipeline.counts.scheduled,
              // Compte d'ALERTE : toujours celui du pipeline complet.
              alert: pipeline.counts.toPoint,
            },
            {
              key: 'awaiting',
              label: 'En attente de réservation',
              count: awaiting.length,
              total: pipeline.counts.awaiting,
            },
            {
              key: 'verdict',
              label: 'En attente de verdict',
              count: verdictRows.length,
              total: pipeline.counts.verdict,
            },
          ]}
        />

        {pipeline.counts.unresolved > 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-body text-[12.5px] text-amber-900">
            {pipeline.counts.unresolved} briefing
            {pipeline.counts.unresolved > 1 ? 's' : ''} sans candidature
            retrouvable {pipeline.counts.unresolved > 1 ? 'ne sont' : 'n’est'} pas
            affiché{pipeline.counts.unresolved > 1 ? 's' : ''} — anomalie de
            données à signaler.
          </p>
        ) : null}

        {notice ? (
          <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 font-body text-[13px] text-stone-700">
            {notice}
          </p>
        ) : null}

        {loading ? (
          <p className="font-body text-[13px] text-stone-400">
            <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" aria-hidden />
            Chargement…
          </p>
        ) : tab === 'awaiting' ? (
          <AwaitingList
            rows={awaiting}
            busyId={busyId}
            onReinvite={(row) => void reinvite(row, 'reinvite')}
            onDismiss={setDismissing}
          />
        ) : (
          <ScheduledList
            rows={tab === 'verdict' ? verdictRows : scheduled}
            busyId={busyId}
            onRealized={(row) => void mark(row, 'realized')}
            onMissed={setNoShow}
            onVerdict={(row, decision) => void verdict(row, decision)}
            onDismiss={setDismissing}
            onReschedule={(row) => void reinvite(row, 'reschedule')}
            onCancel={(row) => void cancelBooking(row)}
            onCorrected={() => void load()}
          />
        )}
      </div>

      {noShow ? (
        <NoShowDialog
          candidateName={noShow.candidateName}
          busy={busyId !== null}
          onCancel={() => setNoShow(null)}
          onConfirm={(choice) => void resolveNoShow(choice)}
        />
      ) : null}

      {dismissing?.analysisId ? (
        <CandidatureDismissDialog
          item={{
            id: dismissing.analysisId,
            candidateName: dismissing.candidateName,
            candidateEmail: dismissing.candidateEmail,
          }}
          onClose={() => setDismissing(null)}
          onDismissed={() => {
            setDismissing(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
