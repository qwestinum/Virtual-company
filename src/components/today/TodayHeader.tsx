'use client';

/**
 * En-tête d'*Aujourd'hui* : « Bonjour [prénom] » et le seul geste initié
 * depuis l'accueil.
 *
 * ⚠️ NI DATE, NI LIGNE DE CHIFFRES (22/09/2026, demande du donneur d'ordre).
 * La ligne « 14 candidatures à valider · 2 entretiens à conclure · 1 point à
 * régler » redisait mot pour mot le titre des trois blocs juste en dessous :
 * deux fois la même information à vingt pixels d'écart. La date, elle,
 * n'aidait à aucune décision de l'écran.
 *
 * Restent : « tout est fait » quand rien n'attend (sinon la page vide ne dit
 * pas si elle a fini de charger), et l'avertissement de lecture incomplète.
 *
 * Prénom absent (session illisible, recruteur sans nom enregistré) : « Bonjour »
 * tout court. Jamais « Bonjour null », jamais une adresse e-mail.
 */

import { AddCampaignButton } from '@/components/campagnes/AddCampaignButton';
import { nouvelleCampagneHref } from '@/lib/navigation/workspace-routes';
import { PHRASES } from '@/lib/lexique/phrases-ecran';

export function TodayHeader({
  firstName,
  allClear,
  partial,
  onReload,
}: {
  firstName: string | null;
  allClear: boolean;
  partial: boolean;
  onReload: () => void;
}) {
  return (
    <header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1
          className="font-display"
          style={{ fontSize: 22, fontWeight: 800, color: 'var(--dash-text)' }}
        >
          {firstName ? `Bonjour ${firstName}` : 'Bonjour'}
        </h1>
        {/* LE SEUL geste que le recruteur initie depuis l'accueil : tout le
            reste de l'écran répond à ce qui est arrivé. Il reste donc seul —
            un second bouton ici et plus aucun des deux ne se voit. */}
        <AddCampaignButton href={nouvelleCampagneHref()} />
      </div>
      {allClear && !partial ? (
        <p
          className="font-body"
          style={{ marginTop: 8, fontSize: 13, color: 'var(--dash-text-secondary)' }}
        >
          {PHRASES.toutEstFait}
        </p>
      ) : null}

      {partial ? (
        <p
          className="font-body"
          style={{ marginTop: 8, fontSize: 12, color: 'var(--dash-orange)' }}
        >
          {PHRASES.lectureIncomplete}{' '}
          <button
            type="button"
            onClick={onReload}
            className="min-h-6 font-semibold underline"
          >
            {PHRASES.reessayer}
          </button>
        </p>
      ) : null}
    </header>
  );
}
