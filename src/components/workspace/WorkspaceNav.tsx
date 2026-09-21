'use client';

/**
 * Barre de navigation du workspace — CINQ entrées, chacune une vraie adresse.
 *
 * Remplace la barre d'onglets qui pilotait un `useState` : l'entrée active se
 * lit désormais dans l'URL (`usePathname`), et chaque entrée est un `<Link>`.
 * C'est ce qui rend possibles le favori, le bouton Précédent, le lien
 * partageable et la cible d'un signal métier — aucun de ces quatre n'existait.
 *
 * Les badges ne changent pas de sens, seulement de porte : la file de
 * validation vit sous « Candidatures », les prises de contact du vivier sous
 * « Campagnes ».
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  WORKSPACE_ENTRIES,
  workspaceEntryForPath,
  type WorkspaceEntryId,
} from '@/lib/navigation/workspace-routes';
import { cn } from '@/lib/utils';

import { SettingsGearLink } from './SettingsGearLink';
import { CountBadge } from '@/components/ui/CountBadge';

export type WorkspaceNavBadges = {
  /** Volume : combien de dossiers attendent une décision. */
  pendingValidations: number;
  /**
   * Volume : profils du vivier qui attendent une décision. Posé sur
   * « Campagnes » depuis que la file différée a disparu — la décision se prend
   * dans la recherche vivier d'une campagne, donc c'est là qu'on envoie.
   */
  pendingVivier: number;
  /** Signal « ça traîne » : dossiers en attente depuis trop longtemps. */
  overdueValidations: number;
  /** Signal : entretiens réalisés sans verdict. */
  interviewsAwaiting: number;
  /** Signal : entretiens passés jamais pointés. */
  interviewsToPoint: number;
};

/** Où chaque compteur se pose, maintenant que les onglets ont fusionné. */
function badgesFor(
  id: WorkspaceEntryId,
  b: WorkspaceNavBadges,
): { count: number; tone: 'volume' | 'vivier'; title: string }[] {
  const plural = (n: number, s: string, p: string) => (n > 1 ? p : s);
  switch (id) {
    case 'candidatures':
      return b.pendingValidations > 0
        ? [
            {
              count: b.pendingValidations,
              tone: 'volume' as const,
              title: `${b.pendingValidations} ${plural(b.pendingValidations, 'candidature à valider', 'candidatures à valider')}`,
            },
          ]
        : [];
    case 'campagnes':
      return b.pendingVivier > 0
        ? [
            {
              count: b.pendingVivier,
              tone: 'vivier' as const,
              title: `${b.pendingVivier} ${plural(b.pendingVivier, 'profil du vivier à examiner', 'profils du vivier à examiner')}`,
            },
          ]
        : [];
    default:
      return [];
  }
}

/** Signal « ça traîne » (ambre), distinct du volume. */
function overdueFor(id: WorkspaceEntryId, b: WorkspaceNavBadges) {
  const plural = (n: number, s: string, p: string) => (n > 1 ? p : s);
  if (id === 'candidatures') {
    const n = b.overdueValidations + b.interviewsAwaiting;
    if (n === 0) return null;
    const parts = [
      b.overdueValidations > 0
        ? `${b.overdueValidations} ${plural(b.overdueValidations, 'dossier attend', 'dossiers attendent')} depuis trop longtemps`
        : null,
      b.interviewsAwaiting > 0
        ? `${b.interviewsAwaiting} ${plural(b.interviewsAwaiting, 'entretien réalisé sans verdict', 'entretiens réalisés sans verdict')}`
        : null,
    ].filter(Boolean);
    return { count: n, title: parts.join(' · ') };
  }
  if (id === 'entretiens' && b.interviewsToPoint > 0) {
    return {
      count: b.interviewsToPoint,
      title: `${b.interviewsToPoint} ${plural(b.interviewsToPoint, 'entretien passé sans pointage', 'entretiens passés sans pointage')}`,
    };
  }
  return null;
}

export function WorkspaceNav({ badges }: { badges: WorkspaceNavBadges }) {
  const pathname = usePathname();
  const active = workspaceEntryForPath(pathname ?? '');

  return (
    <nav
      aria-label="Espaces de travail"
      className="relative z-20 flex items-end gap-1 border-b border-stone-200/60 bg-white/50 px-6 pt-4 backdrop-blur-sm"
    >
      {WORKSPACE_ENTRIES.map((entry) => {
        const isActive = active === entry.id;
        const volume = badgesFor(entry.id, badges);
        const overdue = overdueFor(entry.id, badges);
        return (
          <Link
            key={entry.id}
            href={entry.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative px-4 pb-2.5 pt-2 transition-all',
              'font-display text-[15px] font-bold tracking-tight',
              isActive
                ? 'bg-gradient-to-r from-indigo-700 via-violet-600 to-emerald-600 bg-clip-text text-transparent'
                : 'text-stone-500 hover:text-stone-800',
            )}
          >
            <span>{entry.label}</span>
            {/* ⚠️ LA PASTILLE PARTAGÉE (`CountBadge`), dont cet écran était le
                modèle : les cartes-compteurs prennent la même. */}
            {volume.map((v) => (
              <span key={v.tone} className="ml-1.5">
                <CountBadge tone={v.tone === 'vivier' ? 'vivier' : 'alert'} title={v.title}>
                  {v.count}
                </CountBadge>
              </span>
            ))}
            {overdue ? (
              <span className="ml-1.5">
                <CountBadge tone="waiting" title={overdue.title}>
                  <span aria-hidden className="text-[9px] leading-none">
                    ⏳
                  </span>
                  {overdue.count}
                </CountBadge>
              </span>
            ) : null}
            {isActive ? (
              <span
                aria-hidden
                className="absolute bottom-0 left-2 right-2 h-[3px] rounded-t-full bg-gradient-to-r from-indigo-600 via-violet-500 to-emerald-500"
              />
            ) : null}
          </Link>
        );
      })}
      <SettingsGearLink />
    </nav>
  );
}
