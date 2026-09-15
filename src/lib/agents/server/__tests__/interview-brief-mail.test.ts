import { describe, expect, it } from 'vitest';

import {
  buildInterviewBriefMail,
  buildInterviewBriefText,
  buildUnmatchedBookingMail,
  formatBookingSlot,
} from '@/lib/agents/server/interview-brief-mail';
import type { MailCandidate } from '@/types/mail-candidate';

const baseCandidate: MailCandidate = {
  candidateName: 'Jane Doe',
  email: 'jane@mail.com',
  phone: '0600000000',
  score: 82,
  aboveThreshold: true,
  summary: 'Profil solide en data engineering.',
  strengths: ['Spark', 'Airflow'],
  weaknesses: ['Peu de management'],
  justification: 'Au-dessus du seuil sur les critères clés.',
};

describe('buildInterviewBriefMail', () => {
  it('builds a subject and body for a scheduled interview with the CV attached', () => {
    const { subject, html } = buildInterviewBriefMail({
      candidate: baseCandidate,
      jobTitle: 'Data Engineer',
      ownerLabel: 'CAMP-0001',
      questions: [{ theme: 'Technique', question: 'Décris un pipeline récent.' }],
      booking: {
        startAt: '2026-06-23T12:00:00.000Z',
        endAt: '2026-06-23T12:30:00.000Z',
        location: 'Google Meet',
      },
      cvAttached: true,
    });
    expect(subject).toBe('Entretien programmé — Jane Doe (Data Engineer)');
    expect(html).toContain('a réservé son entretien');
    expect(html).toContain('Data Engineer');
    expect(html).toContain('en pièce jointe');
    expect(html).toContain('Décris un pipeline récent.');
    expect(html).toContain('Google Meet');
    // Verdict CV présent pour un candidat au-dessus du seuil.
    expect(html).toContain('Verdict CV Analyzer');
  });

  it('mentions the .ics calendar invite when attached', () => {
    const { html } = buildInterviewBriefMail({
      candidate: baseCandidate,
      jobTitle: 'Data Engineer',
      ownerLabel: 'CAMP-0001',
      questions: [],
      booking: {
        startAt: '2026-06-23T12:00:00.000Z',
        endAt: null,
        location: null,
      },
      cvAttached: true,
      icsAttached: true,
    });
    expect(html).toContain('.ics');
    expect(html).toContain('calendrier');
  });

  it('mentions the missing CV instead of pretending it is attached', () => {
    const { html } = buildInterviewBriefMail({
      candidate: baseCandidate,
      jobTitle: null,
      ownerLabel: 'CAMP-0001',
      questions: [],
      booking: { startAt: null, endAt: null, location: null },
      cvAttached: false,
    });
    expect(html).toContain('indisponible');
    expect(html).not.toContain('en pièce jointe');
  });

  it('shows the repêchage note (no discard verdict) for a sub-threshold candidate', () => {
    const { html } = buildInterviewBriefMail({
      candidate: { ...baseCandidate, aboveThreshold: false },
      jobTitle: 'Data Engineer',
      ownerLabel: 'CAMP-0001',
      questions: [],
      booking: { startAt: null, endAt: null, location: null },
      cvAttached: true,
    });
    expect(html).toContain('repêché par le recruteur');
    expect(html).not.toContain('Verdict CV Analyzer');
  });

  it('escapes HTML in candidate-controlled fields', () => {
    const { html } = buildInterviewBriefMail({
      candidate: { ...baseCandidate, candidateName: '<script>x</script>' },
      jobTitle: null,
      ownerLabel: 'CAMP-0001',
      questions: [],
      booking: { startAt: null, endAt: null, location: null },
      cvAttached: true,
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildInterviewBriefText', () => {
  it('reprend le même contenu que le mail (synthèse, verdict, trame) en texte brut', () => {
    const text = buildInterviewBriefText({
      candidate: baseCandidate,
      jobTitle: 'Data Engineer',
      ownerLabel: 'CAMP-0001',
      questions: [
        { theme: 'Technique', question: 'Décris un pipeline récent.' },
        { theme: 'Posture', question: 'Comment gères-tu un conflit ?' },
      ],
      booking: {
        startAt: '2026-06-23T12:00:00.000Z',
        endAt: '2026-06-23T12:30:00.000Z',
        location: 'Google Meet',
      },
      cvAttached: true,
    });
    // Pas de HTML dans la description d'agenda.
    expect(text).not.toContain('<');
    expect(text).toContain('SYNTHÈSE');
    expect(text).toContain('Profil solide en data engineering.');
    expect(text).toContain('VERDICT CV ANALYZER');
    expect(text).toContain('Au-dessus du seuil sur les critères clés.');
    // La trame complète est présente et numérotée.
    expect(text).toContain("TRAME D'ENTRETIEN PROPOSÉE");
    expect(text).toContain('1. [Technique] Décris un pipeline récent.');
    expect(text).toContain('2. [Posture] Comment gères-tu un conflit ?');
    expect(text).toContain('Google Meet');
  });

  it('affiche la note de repêchage au lieu du verdict pour un sous-seuil', () => {
    const text = buildInterviewBriefText({
      candidate: { ...baseCandidate, aboveThreshold: false },
      jobTitle: null,
      ownerLabel: 'CAMP-0001',
      questions: [],
      booking: { startAt: null, endAt: null, location: null },
      cvAttached: false,
    });
    expect(text).toContain('DÉCISION');
    expect(text).toContain('repêché par le recruteur');
    expect(text).not.toContain('VERDICT CV ANALYZER');
    expect(text).toContain('indisponible');
  });
});

describe('formatBookingSlot', () => {
  it('returns null for a missing slot', () => {
    expect(formatBookingSlot(null)).toBeNull();
  });

  it('formats an ISO slot into a French string', () => {
    const out = formatBookingSlot('2026-06-23T12:00:00.000Z');
    expect(out).toBeTruthy();
    expect(out).toContain('2026');
  });

  it('falls back to the raw value for an unparsable slot', () => {
    expect(formatBookingSlot('not-a-date')).toBe('not-a-date');
  });
});

describe('buildUnmatchedBookingMail', () => {
  it('names the attendee and flags it as to be reconciled manually', () => {
    const { subject, html } = buildUnmatchedBookingMail({
      attendeeEmail: 'ghost@mail.com',
      attendeeName: 'Ghost',
      startAt: '2026-06-23T12:00:00.000Z',
    });
    expect(subject).toContain('Ghost');
    expect(html).toContain('aucune candidature connue');
    expect(html).toContain('ghost@mail.com');
  });
});

describe('briefing — critères et candidature issue du sourcing', () => {
  const input = (candidate: MailCandidate) => ({
    candidate,
    jobTitle: 'Business Analyst',
    ownerLabel: 'CAMP-2026-293',
    questions: [],
    booking: { startAt: null, endAt: null, location: null },
    cvAttached: true,
  });
  const criteria: MailCandidate['criteria'] = [
    { label: 'Parcours digitaux', decision: 'satisfait', quote: 'refonte du parcours <mobile>' },
    { label: 'Secteur financier', decision: 'non_verifiable', quote: '' },
  ];

  it('tableau critère → verdict → citation, pour toute candidature', () => {
    const { html } = buildInterviewBriefMail(input({ ...baseCandidate, criteria }));
    expect(html).toContain('<h3>Critères</h3>');
    expect(html).toContain('<td>Parcours digitaux</td><td>Satisfait</td><td>« refonte du parcours &lt;mobile&gt; »</td>');
    expect(html).toContain('<td>Secteur financier</td><td>Non vérifiable</td><td>—</td>');
    expect(buildInterviewBriefText(input({ ...baseCandidate, criteria }))).toContain('• Parcours digitaux — Satisfait — « refonte du parcours <mobile> »');
  });

  it('sourcing : « Profil approché par… » à la place du repêchage, verdict conservé', () => {
    const c = { ...baseCandidate, score: 41, sourcingApproach: { recruiterName: 'Jane R.', approachedAt: '2026-09-10T09:00:00Z' } };
    const { html } = buildInterviewBriefMail(input(c));
    expect(html).toContain('Profil approché par Jane R. le 10 septembre 2026');
    expect(html).not.toContain('repêché');
    expect(html).toContain('Verdict CV Analyzer');
    const text = buildInterviewBriefText(input(c));
    expect(text).toContain('Profil approché par Jane R. le 10 septembre 2026');
    expect(text).not.toContain('repêché');
  });
});

describe('mention « agenda non vérifié » (connecteur agenda externe)', () => {
  const brief = (availabilityUnverified?: boolean) => ({
    candidate: baseCandidate,
    jobTitle: 'Data Engineer',
    ownerLabel: 'CAMP-0001',
    questions: [],
    booking: {
      startAt: '2026-06-23T12:00:00.000Z',
      endAt: '2026-06-23T12:30:00.000Z',
      location: null,
      availabilityUnverified,
    },
    cvAttached: true,
  });

  it('prévient quand le créneau a été accepté sur la dernière lecture de l’agenda', () => {
    expect(buildInterviewBriefMail(brief(true)).html).toContain('Agenda non vérifié');
    expect(buildInterviewBriefText(brief(true))).toContain('Agenda non vérifié');
  });

  it('se tait quand l’agenda a été relu (ou qu’il n’y en a pas)', () => {
    expect(buildInterviewBriefMail(brief(false)).html).not.toContain('Agenda non vérifié');
    expect(buildInterviewBriefMail(brief()).html).not.toContain('Agenda non vérifié');
  });
});
