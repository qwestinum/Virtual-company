'use client';

/**
 * En-tête d'*Aujourd'hui* : « Bonjour [prénom] », la date, et UNE LIGNE DE
 * CHIFFRES factuelle.
 *
 * ⚠️ Pas de total, et pas de phrase de synthèse. Additionner deux candidatures,
 * deux entretiens et deux réglages donne « 6 », un nombre qui ne désigne rien
 * et qu'on ne peut retrouver nulle part. Quant au ton — « 6 choses vous
 * attendent » — il commente au lieu d'informer : le recruteur sait lire une
 * liste, il n'a pas besoin qu'on la lui résume avec entrain.
 *
 * Prénom absent (session illisible, recruteur sans nom enregistré) : « Bonjour »
 * tout court. Jamais « Bonjour null », jamais une adresse e-mail.
 */

import { AddCampaignButton } from '@/components/campagnes/AddCampaignButton';
import { nouvelleCampagneHref } from '@/lib/navigation/workspace-routes';
import { PHRASES } from '@/lib/lexique/phrases-ecran';

export function TodayHeader({
  firstName,
  chiffres,
  allClear,
  partial,
  onReload,
}: {
  firstName: string | null;
  /** Un élément par nature, déjà formulé. Jamais une somme. */
  chiffres: string[];
  allClear: boolean;
  partial: boolean;
  onReload: () => void;
}) {
  // ⚠️ `capitalize` en CSS met une majuscule à CHAQUE mot : « Lundi 21
  // Septembre ». En français, seule la première lettre en porte une, et les
  // noms de mois n'en prennent jamais.
  const brut = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
  const jour = brut.charAt(0).toUpperCase() + brut.slice(1);

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
      <p
        className="font-body"
        style={{ marginTop: 2, fontSize: 13, color: 'var(--dash-text-secondary)' }}
      >
        {jour}
      </p>

      {chiffres.length > 0 ? (
        <p
          className="font-body"
          style={{ marginTop: 8, fontSize: 13, color: 'var(--dash-text)' }}
        >
          {chiffres.join(' · ')}
        </p>
      ) : allClear && !partial ? (
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
