'use client';

/**
 * Engrenage poussé à droite de la barre de navigation — accès toujours visible
 * aux Réglages, quelle que soit l'entrée courante.
 *
 * Les Réglages ne sont PAS une sixième entrée : ce n'est pas une destination de
 * travail. Ils gardent donc leur icône, à l'écart des cinq.
 */

import { cn } from '@/lib/utils';

/**
 * Bouton engrenage poussé à droite de la barre d'onglets — accès
 * toujours visible vers /settings, quel que soit l'onglet courant.
 */
export function SettingsGearLink() {
  return (
    <a
      href="/settings"
      aria-label="Paramètres"
      title="Paramètres"
      className={cn(
        'ml-auto mb-1 mr-0 inline-flex items-center justify-center',
        'w-9 h-9 rounded-full',
        'text-stone-500 hover:text-stone-900 hover:bg-stone-100',
        'transition',
      )}
    >
      <svg
        aria-hidden
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </a>
  );
}

