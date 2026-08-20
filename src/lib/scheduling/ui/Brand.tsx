/**
 * Marque de l'installation en tête des pages publiques.
 *
 * Volontairement au-dessus de la carte plutôt qu'à l'intérieur : la carte
 * change d'état (ouverte, dégradée, éteinte) et la marque, elle, ne bouge
 * jamais. La placer dehors évite de la faire traverser chacune de ces
 * branches — et garantit qu'elle ne disparaît pas dans un état d'erreur.
 *
 * Sans logo configuré, le composant ne rend RIEN : pas de cadre vide, pas de
 * place réservée.
 */
import type { ResolvedBranding } from '../runtime';

export function BrandMark({
  brand,
  alt,
}: {
  brand: ResolvedBranding | null;
  /** Texte alternatif — le nom affiché par l'hôte, jamais deviné ici. */
  alt?: string | null;
}) {
  if (!brand?.logoUrl) return null;
  return (
    <div className="sched-brand">
      {/* Image distante fournie par la configuration : pas d'optimiseur, pas
          de dimensions connues à l'avance — le CSS borne la hauteur. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={brand.logoUrl} alt={alt?.trim() || ''} />
    </div>
  );
}
