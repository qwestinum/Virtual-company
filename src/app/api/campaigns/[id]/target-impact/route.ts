/**
 * ⚠️ ALIAS À SUPPRIMER — cette route a été renommée en
 * `/api/campaigns/[id]/scheduling` (elle ne rend plus seulement l'impact d'un
 * changement de référent, mais l'état « réservation » de la campagne).
 *
 * Le fichier ne subsiste que parce que la suppression n'a pas pu être faite
 * ici : `rm -r src/app/api/campaigns/[id]/target-impact`. Aucun appelant ne
 * l'utilise.
 */
export { GET } from '../scheduling/route';

export const runtime = 'nodejs';
