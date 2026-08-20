/**
 * L'écran qui suit une réservation réussie.
 *
 * Deux invariants d'usage, tous deux faciles à casser sans s'en apercevoir —
 * il n'existe aucun test de rendu ailleurs sur ces surfaces :
 *
 *  1. Il ne propose PAS de déplacer ni d'annuler. Ces gestes vivent dans le
 *     message de confirmation, qui porte déjà le lien de gestion. Les remettre
 *     ici reviendrait à proposer de défaire une action à la seconde où elle
 *     vient d'être faite.
 *  2. Il propose une SORTIE. Un écran terminal sans porte de sortie laisse le
 *     lecteur devant une page dont rien ne dit qu'elle est finie.
 *
 * Le test vit côté hôte, et non dans le module : le rendu réclame
 * `react-dom/server`, qui ne figure pas dans les dépendances autorisées par la
 * frontière. L'hôte, lui, a parfaitement le droit d'importer le module.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FR_LABELS } from '@/lib/scheduling/labels';
import { ConfirmedView, type BookingConfirmation } from '@/lib/scheduling/ui';

const MANAGE_URL = 'https://exemple.test/b/JETON-DE-GESTION';

const confirmation: BookingConfirmation = {
  startAt: '2026-09-14T08:00:00.000Z',
  endAt: '2026-09-14T08:45:00.000Z',
  timeZone: 'Europe/Paris',
  manageUrl: MANAGE_URL,
  meetingLocation: null,
};

function render(): string {
  return renderToStaticMarkup(
    <ConfirmedView confirmation={confirmation} labels={FR_LABELS} />,
  );
}

describe("écran de confirmation d'une réservation", () => {
  it('ne propose ni déplacement ni annulation', () => {
    const html = render();
    // Ni le lien lui-même, ni son libellé : c'est le MESSAGE qui les porte.
    expect(html).not.toContain(MANAGE_URL);
    expect(html).not.toContain(FR_LABELS.manageCta);
  });

  it('dit où retrouver ces deux gestes', () => {
    // Retirer l'option sans dire où elle est passée, c'est la supprimer.
    expect(render()).toContain(FR_LABELS.manageInMail);
  });

  it('offre une sortie explicite', () => {
    const html = render();
    expect(html).toContain(FR_LABELS.closeCta);
    expect(html).toContain('<button');
  });

  it('récapitule quand même le rendez-vous', () => {
    // La suppression du lien ne doit pas emporter le récapitulatif avec elle.
    expect(render()).toContain(FR_LABELS.recapWhen);
  });
});
