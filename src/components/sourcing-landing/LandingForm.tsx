'use client';

/**
 * Formulaire de la page `/s/<jeton>` (spec §9.2, maquette §14.5).
 *
 * Le bouton se désarme dès le clic : la route réserve la soumission, mais un
 * double clic ferait voir une erreur à quelqu'un dont la candidature est partie.
 */

import { useState } from 'react';

import { LandingOutcome, type Outcome } from '@/components/sourcing-landing/LandingOutcome';
import { PrivacyBanner } from '@/components/sourcing-landing/PrivacyBanner';
import { RecapEditor, type Recap } from '@/components/sourcing-landing/RecapEditor';
import type { LandingView } from '@/lib/sourcing/server/landing-context';

const field = 'w-full rounded-md border border-stone-300 px-3 py-2 font-body text-[14px]';

export function LandingForm({ token, view, prefilled }: { token: string; view: LandingView; prefilled: boolean }) {
  const [recap, setRecap] = useState<Recap>({ workHistory: view.initial.workHistory, education: view.initial.education, about: view.initial.about });
  const [fullName, setFullName] = useState(view.initial.fullName);
  const [email, setEmail] = useState(view.initial.email);
  const [phone, setPhone] = useState('');
  const [cv, setCv] = useState<File | null>(null);
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
      email,
      phone,
      consent,
      fullName,
      about: recap.about,
      workHistory: recap.workHistory.filter((w) => w.title.trim() !== ''),
      education: recap.education.filter((e) => (e.degree ?? e.institution ?? '').trim() !== ''),
    };
    const body = new FormData();
    body.append('submission', JSON.stringify(submission));
    if (cv) body.append('cv', cv);
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

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      {view.recruiterMessage ? (
        <blockquote className="whitespace-pre-line border-l-2 border-stone-300 pl-3 font-body text-[14px] italic text-stone-700">
          « {view.recruiterMessage} »{view.recruiterName ? <span className="not-italic text-stone-500"> — {view.recruiterName}</span> : null}
        </blockquote>
      ) : null}
      {view.job ? (
        <p className="font-display text-[17px] font-bold text-stone-900">
          {[view.job.title, view.job.location, view.job.contract].filter(Boolean).join(' · ')}
        </p>
      ) : null}

      <PrivacyBanner token={token} organizationName={view.organizationName} privacyContact={view.privacyContact} prefilled={prefilled} onOpposed={() => setOutcome({ kind: 'opposed' })} />

      <RecapEditor value={recap} onChange={setRecap} />

      <div className="flex flex-col gap-3">
        <Labeled label="Nom complet *">
          <input className={field} required value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
        </Labeled>
        <Labeled label="Email *" hint={view.initial.email ? 'à confirmer' : undefined}>
          <input className={field} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </Labeled>
        <Labeled label="Téléphone">
          <input className={field} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
        </Labeled>
        <Labeled label="CV (facultatif)" hint="PDF ou DOCX, 10 Mo">
          <input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setCv(e.target.files?.[0] ?? null)} className="font-body text-[13px]" />
        </Labeled>
      </div>

      <label className="flex items-start gap-2 font-body text-[14px] text-stone-800">
        <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
        <span>Ces informations sont exactes et peuvent être utilisées pour ma candidature *</span>
      </label>

      {error ? <p className="font-body text-[13px] text-red-700" role="alert">{error}</p> : null}

      <button
        type="submit"
        disabled={sending || !consent}
        style={{ backgroundColor: view.accentColor ?? '#1c1917' }}
        className="self-end rounded-lg px-5 py-2 font-body text-[14px] font-semibold text-white disabled:opacity-50"
      >
        {sending ? 'Envoi…' : 'Envoyer ma candidature'}
      </button>
    </form>
  );
}

function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-body text-[13px] font-semibold text-stone-700">
        {label}
        {hint ? <span className="ml-2 font-normal text-stone-500">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}
