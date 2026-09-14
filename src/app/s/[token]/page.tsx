/**
 * Page d'atterrissage d'une approche de sourcing — `/s/<jeton>`.
 * Spec : docs/specs/sourcing.md §9, maquettes §14.5-14.6.
 *
 * L'état est résolu côté serveur : la page arrive dans le bon état, et un lien
 * mort ne déclenche aucun appel depuis le navigateur. JAMAIS de 404 sur un lien
 * reçu — chaque cas a sa phrase. La première ouverture est journalisée.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { after } from 'next/server';

import { LandingForm } from '@/components/sourcing-landing/LandingForm';
import { LandingNotice, LandingShell } from '@/components/sourcing-landing/LandingShell';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { markApproachOpened } from '@/lib/db/repos/sourcing-admission';
import { consumeQuota } from '@/lib/jobboard/rate-limit';
import { isLinkPreviewAgent } from '@/lib/sourcing/landing';
import { resolveLandingContext } from '@/lib/sourcing/server/landing-context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: 'Votre candidature',
  robots: { index: false, follow: false, nocache: true },
};

export default async function SourcingLandingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();

  // Un robot d'aperçu (LinkedIn, messageries) n'est pas la personne. Il est
  // filtré AVANT TOUTE ÉCRITURE : il ne consomme aucun quota (sinon chaque
  // aperçu de lien entamerait le débit de la vraie personne derrière la même
  // passerelle), ne marque pas l'ouverture (qui interdirait au recruteur de
  // « Recopier ») et n'écrit rien au journal. Il ne reçoit aucune donnée du
  // profil ; la coquille ne lit que l'habillage (lecture seule).
  if (isLinkPreviewAgent(h.get('user-agent'))) {
    const context = await resolveLandingContext(token);
    return (
      <LandingShell view={context.view}>
        <LandingNotice kind="preview" />
      </LandingShell>
    );
  }

  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
  const quota = await consumeQuota({ key: `sourcing:open:${ip}`, limit: 60, windowSeconds: 600 });
  const context = await resolveLandingContext(token);

  if (!quota.allowed) {
    return (
      <LandingShell view={context.view}>
        <LandingNotice kind="rate_limited" />
      </LandingShell>
    );
  }

  // Première ouverture seulement : un lien déjà ouvert n'a rien à réécrire
  // (l'update conditionnel n'aurait rien changé, il coûtait un aller-retour).
  // Le marquage reste AVANT la réponse — le recruteur doit voir « ouvert » dès
  // que la page est servie — ; la trace au journal, elle, part après.
  const approach = context.approach;
  if (approach && context.state.kind !== 'unavailable' && !approach.firstOpenedAt) {
    const first = await markApproachOpened(approach.id).catch(() => false);
    if (first) {
      after(() =>
        appendJournalEntry({
          action: 'sourcing_link_opened',
          actor: 'sourcing',
          campaignId: approach.campaignId,
          payload: { approachId: approach.id },
        }).catch(() => {}),
      );
    }
  }

  const { state, view } = context;
  return (
    <LandingShell view={view}>
      {state.kind === 'form' ? <LandingForm token={token} view={view} prefilled={state.prefilled} /> : <LandingNotice kind={state.kind} />}
    </LandingShell>
  );
}
