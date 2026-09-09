'use client';

/**
 * L'état d'une offre APEC déjà envoyée.
 *
 * Trois principes, tous appris ailleurs dans ce projet :
 *
 *   · le statut porte TOUJOURS son heure de lecture. La vérité est chez l'Apec,
 *     ORQA n'en a qu'un cache — l'afficher nu laisserait croire à du direct ;
 *   · un bouton retiré DIT pourquoi. La republication disparaît au bout de
 *     trente jours (API_361), et sans phrase le recruteur croit à un bug ;
 *   · l'incertitude n'est pas un échec. Après un incident de transport, on ne
 *     propose NI republier NI republier : on envoie vérifier chez l'Apec.
 */
import type { JobPosting } from '@/lib/db/repos/job-postings';
import {
  ADEP_IMMUTABLE_NOTICE,
  ADEP_PREFILL_SNAPSHOT_NOTICE,
  ADEP_STATUS_LABELS,
  adepPhase,
  canRepublish,
  republishNotice,
} from '@/lib/jobboards/adep/panel-state';

import { formatPublishedAt, ghostBtn, primaryBtn } from './job-ad-panel-styles';

export type ApecPublishedCardProps = {
  posting: JobPosting;
  simulated: boolean;
  busy: boolean;
  onRefresh: () => void;
  onSuspend: () => void;
  onRepublish: () => void;
};

const rowStyle = { display: 'flex', gap: 8, fontSize: 13, margin: '3px 0' } as const;
const keyStyle = { color: 'var(--dash-text-secondary)', minWidth: 130 } as const;

export function ApecPublishedCard({
  posting,
  simulated,
  busy,
  onRefresh,
  onSuspend,
  onRepublish,
}: ApecPublishedCardProps) {
  const now = new Date();
  const phase = adepPhase(posting);
  const notice = republishNotice(posting, now);
  // ⚠️ « inconnu » ne se dit QUE si l'Apec a répondu sans statut. Tant que rien
  // n'a été lu (`remoteStatusAt` vide — le cas juste après une création, dont
  // l'acquittement ne porte qu'un numéro), on dit que la lecture n'a pas encore
  // eu lieu : « inconnu » après un succès se lit comme un échec, et envoie
  // chercher un problème qui n'existe pas.
  const neverRead = !posting.remoteStatusAt;
  const statusLabel = posting.remoteStatus
    ? (ADEP_STATUS_LABELS[posting.remoteStatus] ?? posting.remoteStatus)
    : neverRead
      ? 'créée — statut pas encore lu chez l’Apec'
      : 'inconnu';

  if (phase === 'uncertain') {
    return (
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        <strong style={{ color: '#b45309' }}>Publication à vérifier.</strong>
        <p style={{ margin: '6px 0' }}>
          L’envoi n’a pas abouti proprement et nous n’avons pas pu déterminer si
          l’offre existe chez l’Apec. {posting.lastErrorMessage}
        </p>
        <p style={{ margin: '6px 0' }}>
          Vérifiez sur apec.fr sous la référence <strong>{posting.clientReference}</strong>{' '}
          avant toute nouvelle tentative — republier maintenant risquerait de créer
          une seconde offre.
        </p>
        <button type="button" style={ghostBtn} onClick={onRefresh} disabled={busy}>
          Relire le statut chez l’Apec
        </button>
      </div>
    );
  }

  if (phase === 'failed') {
    return (
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        <strong style={{ color: '#b91c1c' }}>Publication refusée.</strong>
        <p style={{ margin: '6px 0' }}>
          {posting.lastErrorMessage ?? 'L’Apec n’a pas accepté l’offre.'}
          {posting.lastErrorCode ? ` (code ${posting.lastErrorCode})` : ''}
        </p>
        <p style={{ margin: 0, color: 'var(--dash-text-secondary)' }}>
          Corrigez le formulaire ci-dessus et relancez la publication.
        </p>
      </div>
    );
  }

  return (
    <div style={{ fontSize: 13, lineHeight: 1.5 }}>
      {simulated ? (
        <div style={{ color: '#b45309', marginBottom: 8 }}>
          Mode simulation — rien n’a été envoyé à l’Apec.
        </div>
      ) : null}

      <div style={rowStyle}>
        <span style={keyStyle}>Numéro Apec</span>
        <strong>{posting.apecPositionNumero ?? '—'}</strong>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>Référence</span>
        <span>{posting.clientReference}</span>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>Statut</span>
        <span>
          {statusLabel}
          {/* La vérité est chez l'Apec : on date toujours la lecture. */}
          {posting.remoteStatusAt ? (
            <em style={{ color: 'var(--dash-text-secondary)', fontStyle: 'normal' }}>
              {` — lu${formatPublishedAt(posting.remoteStatusAt)}`}
            </em>
          ) : (
            <em style={{ color: 'var(--dash-text-secondary)', fontStyle: 'normal' }}>
              {' — « Relire le statut » pour le demander'}
            </em>
          )}
        </span>
      </div>
      {posting.remoteUrl ? (
        <div style={rowStyle}>
          <span style={keyStyle}>En ligne</span>
          <a href={posting.remoteUrl} target="_blank" rel="noreferrer">
            voir l’offre sur apec.fr ↗
          </a>
        </div>
      ) : null}
      {posting.publishedAt ? (
        <div style={rowStyle}>
          <span style={keyStyle}>Publiée</span>
          <span>{formatPublishedAt(posting.publishedAt).replace(/^ /, '')}</span>
        </div>
      ) : null}

      <p style={{ margin: '10px 0 6px', color: 'var(--dash-text-secondary)' }}>
        {ADEP_IMMUTABLE_NOTICE}
      </p>
      {/* Le texte parti est figé ICI. Corriger l'annonce générique ne le
          rattrapera pas — dit APRÈS la publication aussi, parce que c'est le
          moment où l'on cherche comment corriger. */}
      <p style={{ margin: '0 0 6px', color: 'var(--dash-text-secondary)' }}>
        {ADEP_PREFILL_SNAPSHOT_NOTICE}
      </p>
      {notice ? <p style={{ margin: '0 0 10px' }}>{notice}</p> : null}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={ghostBtn} onClick={onRefresh} disabled={busy}>
          Relire le statut
        </button>
        {phase === 'published' || phase === 'awaiting_validation' ? (
          <button type="button" style={ghostBtn} onClick={onSuspend} disabled={busy}>
            Dépublier
          </button>
        ) : null}
        {canRepublish(posting, now) ? (
          <button type="button" style={primaryBtn} onClick={onRepublish} disabled={busy}>
            Republier
          </button>
        ) : null}
      </div>
    </div>
  );
}
