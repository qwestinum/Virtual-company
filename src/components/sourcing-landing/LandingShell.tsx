/**
 * Coquille de la page `/s/<jeton>` : en-tête de lettre (cabinet, poste,
 * référent) sur le fond de la charte. Sans hook — rendue côté serveur pour les
 * écrans neutres comme autour du formulaire. Mobile d'abord, une colonne.
 */
import type { ReactNode } from 'react';

import type { LandingView } from '@/lib/sourcing/server/landing-context';

type Brand = Pick<LandingView, 'organizationName' | 'logoUrl'> & Partial<Pick<LandingView, 'job' | 'recruiterName'>>;

export function LandingShell({ view, children }: { view: Brand; children: ReactNode }) {
  return (
    <main className="min-h-screen px-4 py-6 sm:py-10" style={{ backgroundColor: 'var(--dash-bg)' }}>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header className="flex flex-col gap-3 border-b pb-5" style={{ borderColor: 'var(--dash-border)' }} data-landing-part="header">
          {view.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={view.logoUrl} alt={view.organizationName ?? ''} className="h-9 max-w-[180px] object-contain object-left" />
          ) : view.organizationName ? (
            <span className="font-display text-[17px] font-bold" style={{ color: 'var(--dash-text)' }}>{view.organizationName}</span>
          ) : null}
          {view.job ? (
            <div>
              <p className="font-display text-[21px] font-bold leading-tight" style={{ color: 'var(--dash-text)' }}>{view.job.title}</p>
              <p className="mt-1 font-body text-[13.5px]" style={{ color: 'var(--dash-text-secondary)' }}>
                {[view.job.location, view.job.contract, view.recruiterName ? `Votre contact : ${view.recruiterName}` : null].filter(Boolean).join(' · ')}
              </p>
            </div>
          ) : null}
        </header>
        {children}
      </div>
    </main>
  );
}

/** Une partie nommée de la lettre : titre visible, contenu dessous. */
export function LandingPart({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3" data-landing-part={id} aria-labelledby={`part-${id}`}>
      <h2 id={`part-${id}`} className="font-body text-[12px] font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--dash-text-secondary)' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

const NOTICES = {
  unavailable: { title: 'Cette invitation n’est plus disponible.', body: null },
  closed: { title: 'Cette offre n’est plus ouverte.', body: 'Merci de l’intérêt que vous lui avez porté.' },
  paused: { title: 'Ce recrutement est momentanément suspendu, votre lien reste valable.', body: 'Vous pourrez y revenir dès sa reprise.' },
  received: { title: 'Votre candidature est bien reçue.', body: 'Nous revenons vers vous par email.' },
  // Ce que voit un robot d'aperçu : ni poste, ni message, ni donnée de profil.
  preview: { title: 'Invitation à candidater', body: null },
  rate_limited: { title: 'Trop de tentatives en peu de temps.', body: 'Merci de réessayer dans quelques minutes.' },
} as const;

export type NoticeKind = keyof typeof NOTICES;

export function LandingNotice({ kind }: { kind: NoticeKind }) {
  const n = NOTICES[kind];
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-white px-5 py-6" style={{ borderColor: 'var(--dash-border)' }}>
      <h1 className="font-display text-[19px] font-bold" style={{ color: 'var(--dash-text)' }}>{n.title}</h1>
      {n.body ? <p className="font-body text-[14px]" style={{ color: 'var(--dash-text-secondary)' }}>{n.body}</p> : null}
    </section>
  );
}
