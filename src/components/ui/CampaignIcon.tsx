'use client';

/**
 * L'ICÔNE D'UNE CAMPAGNE — extraite de `CampaignCard`, partagée par tous les
 * écrans qui listent des campagnes (Campagnes, Pilotage → Rapport de
 * campagne).
 *
 * ⚠️ RÈGLE : une couleur par NATURE d'objet. Une campagne est BLEU CIEL, une
 * personne est orange, partout. L'éclair reste au milieu — c'est lui qui dit
 * « ça tourne », la couleur ne dit que « c'est une campagne ».
 *
 * L'active était verte, dégradée vers le turquoise : le vert disait
 * « conforme » sur un écran où il ne signifiait rien de tel, et se retrouvait
 * ailleurs sur des retenus. Cf. `PASTILLE` dans `tokens.ts`.
 *
 * ⚠️ Le ciel (#d7e6ff) est PÂLE, et cela change deux choses, mesurées :
 *   • le glyphe ne peut pas être blanc (1,26:1, invisible) — il est bleu
 *     (3,66:1, au-delà des 3:1 exigés d'un élément non textuel) ;
 *   • la pastille ne se détache que de 1,19:1 du fond sand — elle porte donc
 *     un filet, sinon elle flotterait sans contour.
 * Les deux autres états gardent leur aplat saturé et leur encre blanche.
 */

import { PASTILLE } from './tokens';

export type CampaignIconKind = 'active' | 'paused' | 'draft';

type Spec = {
  bg: string;
  /** Couleur du glyphe. Blanc sur un aplat saturé, bleu sur le ciel pâle. */
  encre: string;
  /** Filet — seulement quand l'aplat ne se détache pas du fond. */
  filet?: string;
  ombre?: string;
  glyphe: string;
};

const MAP: Record<CampaignIconKind, Spec> = {
  active: {
    // ⚠️ Aplat PLEIN, pas un dégradé : le ciel est une teinte pâle, un dégradé
    // dessus ne serait qu'une bouillie. Et pas d'ombre — sous une pastille
    // claire, elle se voit plus que la pastille elle-même.
    bg: PASTILLE.campagne,
    encre: 'var(--dash-blue)',
    filet: 'color-mix(in srgb, var(--dash-blue) 35%, transparent)',
    glyphe: '⚡',
  },
  paused: {
    bg: 'linear-gradient(135deg, var(--dash-yellow), var(--dash-orange))',
    encre: '#fff',
    ombre: 'rgba(213,160,0,0.3)',
    glyphe: '⏸',
  },
  draft: {
    bg: 'linear-gradient(135deg, var(--dash-text-tertiary), var(--dash-text-secondary))',
    encre: '#fff',
    ombre: 'rgba(101,98,93,0.3)',
    glyphe: '📝',
  },
};

export function CampaignIcon({
  kind,
  taille = 44,
}: {
  kind: CampaignIconKind;
  /** 44 px sur une carte, 40 px sur une ligne de liste. */
  taille?: number;
}) {
  const spec = MAP[kind];
  return (
    <div
      aria-hidden
      style={{
        width: taille,
        height: taille,
        borderRadius: taille >= 44 ? 12 : 11,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: taille >= 44 ? 20 : 17,
        color: spec.encre,
        flexShrink: 0,
        background: spec.bg,
        border: spec.filet ? `1px solid ${spec.filet}` : undefined,
        boxShadow: spec.ombre ? `0 3px 12px ${spec.ombre}` : undefined,
      }}
    >
      {spec.glyphe}
    </div>
  );
}
