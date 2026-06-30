/**
 * Briefing d'entretien — file d'attente + état des candidatures retenues
 * (juin 2026, réservation Cal.com pilote la délivrance).
 *
 * Cycle : un candidat ACCEPTÉ + invité produit un briefing `awaiting_booking`
 * (trame générée, mais NON envoyée). À la réception du webhook Cal.com
 * BOOKING_CREATED, le briefing bascule en `scheduled` et part au DRH (mail +
 * CV en PJ). C'est aussi la source de vérité du dashboard (invités en attente
 * vs entretiens programmés).
 */

import type { MailCandidate } from './mail-candidate';

export type InterviewBriefStatus = 'awaiting_booking' | 'scheduled';

export type InterviewQuestion = { theme: string; question: string };

export type InterviewBrief = {
  id: string;
  campaignId: string | null;
  taskId: string | null;
  /** Email normalisé (lower+trim) — clé de matching au webhook. */
  candidateEmail: string | null;
  candidateName: string;
  jobTitle: string | null;
  /** uid de l'analyse candidat à l'origine (rattachement fiable, ≠ email). */
  uid: string | null;
  status: InterviewBriefStatus;
  /** Trame d'entretien (6-8 questions ciblées). */
  questions: InterviewQuestion[];
  /** Snapshot candidat figé à la mise en file (corps mail + repli régénération). */
  candidate: MailCandidate;
  /** uid du booking Cal.com, posé à la délivrance. */
  bookingUid: string | null;
  interviewStartAt: string | null;
  interviewEndAt: string | null;
  interviewLocation: string | null;
  /** message-id Resend du brief livré (vérif via /api/email/status). */
  deliveredMessageId: string | null;
  /** Mise en file (= invité le). */
  createdAt: string;
  /** Réservation reçue (transition vers scheduled). */
  bookedAt: string | null;
  updatedAt: string;
};
