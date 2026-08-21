/**
 * Le fil d'activité et sa liste d'actions chargées — couplage et contenu.
 *
 * Régression du 21/08/2026 : la route chargeait les 500 dernières lignes BRUTES
 * du journal puis jetait ce qu'elle ne savait pas rendre. Une action technique
 * écrite à chaque relève avait rempli la fenêtre et évincé les évènements
 * métier. Le correctif déplace la limite sur les lignes voulues — ce qui n'a de
 * valeur que si la liste chargée et les renderers ne divergent JAMAIS.
 */
import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_FEED_ACTIONS,
  AGENT_METRIC_ACTIONS,
  journalToActivityFeed,
} from '@/lib/dashboard/derive-metrics';
import type { JournalEntry } from '@/lib/db/repos/journal';

function entry(over: Partial<JournalEntry>): JournalEntry {
  return {
    id: 1,
    campaignId: 'CAMP-2026-511',
    actor: 'imap_poller',
    action: 'imap_cv_received',
    payload: {},
    createdAt: '2026-08-21T14:30:00.000Z',
    ...over,
  };
}

/** Payload assez riche pour que N'IMPORTE quel renderer rende un item. */
const RICH_PAYLOAD = {
  candidate: 'Jean Dupont',
  candidateName: 'Jean Dupont',
  attendeeName: 'Jean Dupont',
  score: 82,
  aboveThreshold: true,
  status: 'sent',
  mode: 'invite',
  mailSent: true,
  decision: 'accept',
  enabled: true,
  channel: 'LinkedIn',
  threshold: 70,
  jobTitle: 'Comptable',
  campaignName: 'Comptable Paris',
  startAt: '2026-08-25T09:00:00.000Z',
};

describe('couplage liste chargée ↔ renderers', () => {
  it('CHAQUE action de la liste est effectivement rendue par le fil', () => {
    // Le piège serait une liste maintenue à côté des renderers : l'action y
    // figurerait, serait chargée, et resterait invisible sans qu'un test
    // rougisse. On vérifie donc les deux bouts sur la MÊME liste.
    const nonRendered = ACTIVITY_FEED_ACTIONS.filter(
      (action) =>
        journalToActivityFeed([entry({ action, payload: RICH_PAYLOAD })], 1)
          .length === 0,
    );
    expect(nonRendered).toEqual([]);
  });

  it('la liste couvre les évènements métier attendus', () => {
    for (const action of [
      'imap_cv_analyzed',
      'candidate_interview_marked',
      'candidate_validation_marked',
      'interview_brief_delivered',
      'interview_booking_rescheduled',
      'interview_booking_cancelled',
      'interview_brief_queued',
      'interview_link_reissued',
      'hitl_validation_sent',
      'hitl_mail_not_sent',
      'imap_outreach_pending',
      'candidature_dismissed',
      'campaign_report_sent',
      'demo_jobboard_application_sent',
    ]) {
      expect(ACTIVITY_FEED_ACTIONS).toContain(action);
    }
  });

  it('AUCUNE action technique bavarde n’est chargée', () => {
    // `imap_mailbox_skipped` est la coupable de 2026 ; les autres sont du même
    // genre. Les charger, c'est rouvrir la porte à l'éviction.
    for (const action of [
      'imap_mailbox_skipped',
      'imap_parse_failed',
      'imap_email_no_cv',
      'imap_cv_retry_scheduled',
      'imap_mailbox_baseline_set',
    ]) {
      expect(ACTIVITY_FEED_ACTIONS).not.toContain(action);
    }
  });

  it('les métriques par agent ont la même garantie de non-divergence', () => {
    expect(AGENT_METRIC_ACTIONS.length).toBeGreaterThan(0);
    expect(AGENT_METRIC_ACTIONS).toContain('imap_cv_analyzed');
    expect(AGENT_METRIC_ACTIONS).not.toContain('imap_mailbox_skipped');
  });
});

describe('messages métier nommant le candidat', () => {
  const messageFor = (over: Partial<JournalEntry>): string =>
    journalToActivityFeed([entry({ payload: RICH_PAYLOAD, ...over })], 1)[0]
      ?.message ?? '';

  it('entretien réalisé', () => {
    expect(
      messageFor({
        action: 'candidate_interview_marked',
        payload: { candidate: 'Claire Martin', status: 'realized' },
      }),
    ).toBe('Entretien réalisé avec Claire Martin');
  });

  it('rendez-vous pris, avec l’heure du créneau', () => {
    const msg = messageFor({
      action: 'interview_brief_delivered',
      payload: {
        attendeeName: 'Claire Martin',
        startAt: '2026-08-25T09:00:00.000Z',
      },
    });
    expect(msg).toContain('Rendez-vous pris avec Claire Martin');
    expect(msg).toMatch(/à \d{2}:\d{2}$/);
  });

  it('rendez-vous sans horodatage lisible : pas de « à — » disgracieux', () => {
    expect(
      messageFor({
        action: 'interview_brief_delivered',
        payload: { attendeeName: 'Claire Martin' },
      }),
    ).toBe('Rendez-vous pris avec Claire Martin');
  });

  it('rendez-vous déplacé / annulé', () => {
    expect(
      messageFor({
        action: 'interview_booking_cancelled',
        payload: { attendeeName: 'Claire Martin' },
      }),
    ).toBe('Rendez-vous annulé — Claire Martin');
    expect(
      messageFor({
        action: 'interview_booking_rescheduled',
        payload: { attendeeName: 'Claire Martin' },
      }),
    ).toContain('Rendez-vous déplacé — Claire Martin');
  });

  it('classement sans suite : ton NEUTRE, jamais « refusé »', () => {
    const msg = messageFor({
      action: 'candidature_dismissed',
      payload: { candidateName: 'Claire Martin', reason: 'poste_pourvu' },
    });
    expect(msg).toBe('Candidature classée sans suite — Claire Martin');
    expect(msg.toLowerCase()).not.toContain('refus');
  });

  it('dossier en attente de validation humaine', () => {
    expect(
      messageFor({
        action: 'imap_outreach_pending',
        payload: { candidate: 'Claire Martin' },
      }),
    ).toBe('Claire Martin attend une validation');
  });

  it('décision HITL : n’annonce un envoi QUE s’il est parti', () => {
    expect(
      messageFor({
        action: 'hitl_validation_sent',
        payload: { candidateName: 'Claire Martin', decision: 'accept', mailSent: true },
      }),
    ).toContain('Invitation envoyée à Claire Martin');
    // Mail non parti ⇒ aucun item : `hitl_mail_not_sent` porte ce cas.
    expect(
      journalToActivityFeed(
        [
          entry({
            action: 'hitl_validation_sent',
            payload: { candidateName: 'Claire Martin', mailSent: false },
          }),
        ],
        1,
      ),
    ).toEqual([]);
    expect(
      messageFor({
        action: 'hitl_mail_not_sent',
        payload: { candidateName: 'Claire Martin', cause: 'skipped_by_user' },
      }),
    ).toBe('Décision prise sans envoi — Claire Martin (choix du recruteur)');
  });

  it('candidature déposée depuis l’annonce du jobboard', () => {
    expect(
      messageFor({
        action: 'demo_jobboard_application_sent',
        payload: { candidate: 'Claire Martin' },
      }),
    ).toBe('Candidature déposée depuis l’annonce — Claire Martin');
  });

  it('nom absent : repli lisible, jamais un identifiant technique', () => {
    const msg = messageFor({
      action: 'candidate_interview_marked',
      payload: { uid: 'can_imap_mb1_102', status: 'realized' },
    });
    expect(msg).toBe('Entretien réalisé avec Candidat');
    expect(msg).not.toContain('can_imap');
  });
});
