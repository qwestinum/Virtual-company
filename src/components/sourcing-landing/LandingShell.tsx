/**
 * Coquille de la page `/s/<jeton>` : l'identité du cabinet, rien d'ORQA.
 * Sans hook — rendue côté serveur pour les écrans neutres comme autour du
 * formulaire.
 */
import type { ReactNode } from 'react';

import type { LandingView } from '@/lib/sourcing/server/landing-context';

type Brand = Pick<LandingView, 'organizationName' | 'logoUrl'>;

export function LandingShell({ view, children }: { view: Brand; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-8">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-xl border border-stone-200 bg-white px-5 py-6 sm:px-8">
        <header className="flex items-center gap-3">
          {view.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={view.logoUrl} alt={view.organizationName ?? ''} className="h-9 max-w-[180px] object-contain" />
          ) : view.organizationName ? (
            <span className="font-display text-[17px] font-bold text-stone-900">{view.organizationName}</span>
          ) : null}
        </header>
        {children}
      </div>
    </main>
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
    <section className="flex flex-col gap-2 py-6">
      <h1 className="font-display text-[19px] font-bold text-stone-900">{n.title}</h1>
      {n.body ? <p className="font-body text-[14px] text-stone-600">{n.body}</p> : null}
    </section>
  );
}
