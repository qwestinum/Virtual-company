'use client';

/**
 * Logo ORQA — wrapper next/image (Session 7).
 *
 * Le fichier source est `public/logo-orqa.png`. La largeur affichée est
 * paramétrable ; next/image conserve le ratio natif de l'image en
 * laissant `height: auto` côté CSS (les attributs width/height
 * définissent l'intrinsicSize côté layout shift prevention).
 */

import Image from 'next/image';

export type OrqaLogoProps = {
  width?: number;
  priority?: boolean;
  className?: string;
};

// Dimensions intrinsèques réelles du PNG (844 × 238, ratio ≈ 3.55:1).
// Servent au layout-shift prevention ; la taille rendue est pilotée
// par la prop `width`. Si le logo est remplacé, mettre à jour ces
// constantes ET incrémenter `LOGO_VERSION` pour casser le cache
// navigateur + l'optimiseur d'images Next.
const INTRINSIC_W = 844;
const INTRINSIC_H = 238;
const LOGO_VERSION = 4;

export function OrqaLogo({
  width = 110,
  priority = false,
  className,
}: OrqaLogoProps) {
  return (
    <Image
      src={`/logo-orqa.png?v=${LOGO_VERSION}`}
      alt="ORQA"
      width={INTRINSIC_W}
      height={INTRINSIC_H}
      priority={priority}
      className={className}
      style={{
        width: `${width}px`,
        height: 'auto',
        objectFit: 'contain',
      }}
    />
  );
}
