'use client';

/**
 * Formulaire de la page `/s/<jeton>` — une LETTRE en parties nommées
 * (retouche du 14/09/2026) : merci de votre intérêt · vos coordonnées · votre
 * parcours (dépliable) · validation · information sur vos données.
 *
 * Le bouton se désarme dès le clic : la route réserve la soumission, mais un
 * double clic ferait voir une erreur à quelqu'un dont la candidature est partie.
 * Il reste dans le flux de la page (jamais en position fixe) : un clavier
 * mobile ouvert ne peut pas le recouvrir.
 */

import { useState } from 'react';

import { ContactFields, type Contact } from '@/components/sourcing-landing/ContactFields';
import { LandingOutcome, type Outcome } from '@/components/sourcing-landing/LandingOutcome';
import { LandingPart } from '@/components/sourcing-landing/LandingShell';
import { ParcoursEditor, type Recap } from '@/components/sourcing-landing/ParcoursEditor';
import { PrivacyBanner } from '@/components/sourcing-landing/PrivacyBanner';
import type { LandingView } from '@/lib/sourcing/server/landing-context';

const firstWord = (s: string | null) => (s ?? '').trim().split(/\s+/)[0] || null;

export function LandingForm({ token, view, prefilled }: { token: string; view: LandingView; prefilled: boolean }) {
  const i = view.initial;
  const [recap, setRecap] = useState<Recap>({ workHistory: i.workHistory, education: i.education, about: i.about, skills: i.skills ?? null, languages: i.languages ?? null, certifications: i.certifications ?? null });
  const [contact, setContact] = useState<Contact>({ fullName: i.fullName, location: i.location ?? '', email: i.email, phone: '', cv: null });
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  if (outcome) return <LandingOutcome outcome={outcome} organizationName={view.organizationName} privacyContact={view.privacyContact} />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setError(null);
    const submission = {
      email: contact.email,
      phone: contact.phone,
      consent,
      fullName: contact.fullName,
      about: recap.about,
      location: contact.location.trim() || null,
      skills: recap.skills ?? null,
      languages: recap.languages ?? null,
      certifications: recap.certifications ?? null,
      workHistory: recap.workHistory.filter((w) => w.title.trim() !== ''),
      education: recap.education.filter((e) => (e.degree ?? e.institution ?? '').trim() !== ''),
    };
    const body = new FormData();
    body.append('submission', JSON.stringify(submission));
    if (contact.cv) body.append('cv', contact.cv);
    try {
      const res = await fetch(`/api/sourcing/approach/${encodeURIComponent(token)}/submit`, { method: 'POST', body });
      const data = (await res.json().catch(() => null)) as { outcome?: string; firstName?: string; recruiterName?: string | null; message?: string } | null;
      if (!res.ok || !data?.outcome) {
        setError(data?.message ?? 'L’envoi n’a pas abouti. Merci de réessayer.');
        setSending(false);
        return;
      }
      const first = data.firstName ?? '';
      if (data.outcome === 'sent') setOutcome({ kind: 'sent', firstName: first, recruiterName: data.recruiterName ?? null });
      else if (data.outcome === 'received') setOutcome({ kind: 'received', firstName: first });
      else setOutcome({ kind: 'closed' });
    } catch {
      setError('L’envoi n’a pas abouti (connexion interrompue). Merci de réessayer.');
      setSending(false);
    }
  };

  const recruiter = firstWord(view.recruiterName);
  const jobTitle = view.job?.title ?? null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      <LandingPart title="Merci de votre intérêt" id="intro">
        <p className="font-body text-[15px] leading-relaxed" style={{ color: 'var(--dash-text)' }}>
          {recruiter ? `Vous avez échangé avec ${recruiter}` : 'Vous avez été contacté·e'}
          {jobTitle ? ` au sujet du poste de ${jobTitle}` : ''}. Pour que nous puissions considérer votre candidature, merci de
          compléter les informations ci-dessous — cela prend deux minutes.
        </p>
        {view.recruiterMessage ? (
          <blockquote className="ml-3 whitespace-pre-line border-l-2 pl-3 font-body text-[14px] italic leading-relaxed" style={{ borderColor: 'var(--dash-border-strong)', color: 'var(--dash-text-secondary)' }}>
            « {view.recruiterMessage} »{view.recruiterName ? <span className="not-italic"> — {view.recruiterName}</span> : null}
          </blockquote>
        ) : null}
      </LandingPart>

      <LandingPart title="Vos coordonnées" id="contact">
        <ContactFields value={contact} onChange={setContact} emailToConfirm={Boolean(view.initial.email)} />
      </LandingPart>

      <LandingPart title="Votre parcours" id="parcours">
        <ParcoursEditor value={recap} onChange={setRecap} />
      </LandingPart>

      <LandingPart title="Validation" id="validation">
        <label className="flex items-start gap-3 rounded-lg border bg-white px-4 py-3 font-body text-[14.5px]" style={{ borderColor: 'var(--dash-border)', color: 'var(--dash-text)' }}>
          <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
          <span>
            Ces informations sont exactes et peuvent être utilisées pour ma candidature<span style={{ color: 'var(--dash-orange)' }}> *</span>
          </span>
        </label>
        {error ? <p className="font-body text-[13.5px] text-red-700" role="alert">{error}</p> : null}
        <button
          type="submit"
          disabled={sending || !consent}
          style={{ backgroundColor: view.accentColor ?? 'var(--dash-orange)' }}
          className="w-full rounded-lg px-5 py-3 font-body text-[15px] font-semibold text-white disabled:opacity-50 sm:w-auto sm:self-end"
        >
          {sending ? 'Envoi…' : 'Envoyer ma candidature'}
        </button>
      </LandingPart>

      <PrivacyBanner token={token} organizationName={view.organizationName} privacyContact={view.privacyContact} prefilled={prefilled} onOpposed={() => setOutcome({ kind: 'opposed' })} />
    </form>
  );
}
