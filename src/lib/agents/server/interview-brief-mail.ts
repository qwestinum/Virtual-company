/**
 * Rendu de l'email de briefing d'entretien délivré au DRH (adresses de
 * synthèse) À LA RÉSERVATION Cal.com. Juin 2026.
 *
 * Pur (testable) : reçoit le candidat, la trame et les détails de réservation,
 * renvoie `{ subject, html }`. Le CV part en pièce jointe (géré par
 * l'appelant) ; ce module se contente d'en mentionner la présence ou l'absence.
 *
 * Diffère de l'ancien brief « à l'invitation » : la réservation a EU lieu, on
 * affiche donc le créneau réservé plutôt qu'un lien à réserver.
 */

import type { InterviewQuestion } from '@/types/interview-brief';
import type { MailCandidate } from '@/types/mail-candidate';

export type InterviewBriefMailInput = {
  candidate: MailCandidate;
  jobTitle: string | null;
  /** CAMP-XXXX / TASK-XXXX — repli d'affichage si pas de jobTitle. */
  ownerLabel: string;
  questions: InterviewQuestion[];
  booking: {
    startAt: string | null;
    endAt: string | null;
    location: string | null;
  };
  /** true si le CV a pu être joint, false sinon (mention de repli). */
  cvAttached: boolean;
  /** true si une invitation agenda .ics est jointe. */
  icsAttached?: boolean;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Formate un créneau ISO en français (« lundi 23 juin 2026 à 14:00 »). Repli
 * sur la chaîne brute si non parsable, `null` si absent.
 */
export function formatBookingSlot(startAt: string | null): string | null {
  if (!startAt) return null;
  const d = new Date(startAt);
  if (Number.isNaN(d.getTime())) return startAt;
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'Europe/Paris',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function buildInterviewBriefMail(input: InterviewBriefMailInput): {
  subject: string;
  html: string;
} {
  const c = input.candidate;
  const label = input.jobTitle ?? input.ownerLabel;
  // Repêchage : candidat reçu en entretien malgré un pré-tri sous le seuil →
  // décision humaine. On NE présente PAS le verdict d'écartage (caduc).
  const repechage = !c.aboveThreshold;
  const slot = formatBookingSlot(input.booking.startAt);

  const questionsHtml = input.questions
    .map(
      (q) =>
        `<li><strong>${escapeHtml(q.theme)}</strong> — ${escapeHtml(q.question)}</li>`,
    )
    .join('');

  const bookingLines = [
    slot ? `<li>Créneau : <strong>${escapeHtml(slot)}</strong></li>` : '',
    input.booking.location
      ? `<li>Lieu / lien : ${escapeHtml(input.booking.location)}</li>`
      : '',
    input.icsAttached
      ? '<li>Agenda : invitation <strong>.ics</strong> en pièce jointe (ouvre-la pour ajouter l’entretien à ton calendrier)</li>'
      : '',
  ].filter((l) => l !== '');

  const html = [
    `<p><strong>${escapeHtml(c.candidateName)}</strong> a réservé son entretien pour <strong>${escapeHtml(label)}</strong>.</p>`,
    bookingLines.length > 0 ? `<h3>Entretien</h3><ul>${bookingLines.join('')}</ul>` : '',
    '<h3>Candidat</h3>',
    '<ul>',
    `<li>Nom : ${escapeHtml(c.candidateName)}</li>`,
    c.email ? `<li>Email : ${escapeHtml(c.email)}</li>` : '',
    c.phone ? `<li>Téléphone : ${escapeHtml(c.phone)}</li>` : '',
    `<li>Score CV : ${c.score}/100</li>`,
    `<li>CV : ${input.cvAttached ? 'en pièce jointe' : '<em>indisponible (à récupérer manuellement)</em>'}</li>`,
    '</ul>',
    '<h3>Synthèse</h3>',
    `<p>${escapeHtml(c.summary)}</p>`,
    repechage
      ? '<h3>Décision</h3><p>Candidat <strong>repêché par le recruteur</strong> : reçu en entretien bien que le pré-tri automatique l’ait placé sous le seuil. Le verdict d’écartage du pré-tri ne s’applique plus.</p>'
      : `<h3>Verdict CV Analyzer</h3><p>${escapeHtml(c.justification)}</p>`,
    "<h3>Trame d'entretien proposée</h3>",
    `<ul>${questionsHtml}</ul>`,
  ]
    .filter((l) => l !== '')
    .join('\n');

  const subject = `Entretien programmé — ${c.candidateName} (${label})`;
  return { subject, html };
}

/**
 * Version TEXTE BRUT du briefing — MÊME contenu que l'email (synthèse, verdict /
 * décision, trame d'entretien), destinée à la DESCRIPTION de l'événement .ics.
 *
 * L'agenda doit être auto-suffisant : le recruteur ouvre l'événement et a tout
 * sous les yeux sans rechercher le mail. Plain text (pas de HTML) structuré en
 * sections, lisible dans Google / Apple / Outlook Calendar. Le lien du CV est
 * ajouté en aval par `buildInterviewIcs`.
 */
export function buildInterviewBriefText(input: InterviewBriefMailInput): string {
  const c = input.candidate;
  const label = input.jobTitle ?? input.ownerLabel;
  const repechage = !c.aboveThreshold;
  const slot = formatBookingSlot(input.booking.startAt);

  const lines: string[] = [
    `${c.candidateName} a réservé son entretien pour ${label}.`,
    '',
  ];

  const entretien: string[] = [];
  if (slot) entretien.push(`• Créneau : ${slot}`);
  if (input.booking.location) entretien.push(`• Lieu / lien : ${input.booking.location}`);
  if (entretien.length > 0) {
    lines.push('ENTRETIEN', ...entretien, '');
  }

  lines.push('CANDIDAT');
  lines.push(`• Nom : ${c.candidateName}`);
  if (c.email) lines.push(`• Email : ${c.email}`);
  if (c.phone) lines.push(`• Téléphone : ${c.phone}`);
  lines.push(`• Score CV : ${c.score}/100`);
  lines.push(
    `• CV : ${input.cvAttached ? 'en pièce jointe du mail de briefing' : 'indisponible (à récupérer manuellement)'}`,
  );
  lines.push('');

  lines.push('SYNTHÈSE', c.summary, '');

  if (repechage) {
    lines.push(
      'DÉCISION',
      'Candidat repêché par le recruteur : reçu en entretien bien que le pré-tri automatique l’ait placé sous le seuil. Le verdict d’écartage du pré-tri ne s’applique plus.',
    );
  } else {
    lines.push('VERDICT CV ANALYZER', c.justification);
  }
  lines.push('');

  lines.push("TRAME D'ENTRETIEN PROPOSÉE");
  input.questions.forEach((q, i) => {
    lines.push(`${i + 1}. [${q.theme}] ${q.question}`);
  });

  return lines.join('\n');
}

/** Mail de repli : réservation reçue pour un email inconnu de nos candidatures. */
export function buildUnmatchedBookingMail(input: {
  attendeeEmail: string;
  attendeeName: string | null;
  startAt: string | null;
}): { subject: string; html: string } {
  const who = input.attendeeName
    ? `${input.attendeeName} (${input.attendeeEmail})`
    : input.attendeeEmail;
  const slot = formatBookingSlot(input.startAt);
  const html = [
    `<p>Une réservation d'entretien vient d'arriver pour <strong>${escapeHtml(who)}</strong>, mais cet email ne correspond à <strong>aucune candidature connue</strong> dans ORQA.</p>`,
    slot ? `<p>Créneau : <strong>${escapeHtml(slot)}</strong></p>` : '',
    '<p>À rattacher manuellement : vérifie l’adresse utilisée par le candidat pour réserver, ou retrouve sa candidature sous un autre email.</p>',
  ]
    .filter((l) => l !== '')
    .join('\n');
  return {
    subject: `Réservation à rattacher — ${who}`,
    html,
  };
}
