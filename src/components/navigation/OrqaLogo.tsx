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

// Dimensions intrinsèques approximatives du PNG — ratio ≈ 4:1. Réglées
// pour éviter le layout shift initial ; ne reflètent pas la taille
// rendue (paramétrée par la prop width).
const INTRINSIC_W = 800;
const INTRINSIC_H = 200;

export function OrqaLogo({
  width = 140,
  priority = false,
  className,
}: OrqaLogoProps) {
  return (
    <Image
      src="/logo-orqa.png"
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
