'use client';

/**
 * LA COLONNE DE NAVIGATION — à gauche, fixe, montée par la coquille.
 *
 * ⚠️ Elle vit dans le LAYOUT du workspace, pas dans `PageShell`. Les deux
 * seraient « la coquille » à l'oreille, mais `PageShell` est monté PAR PAGE :
 * la colonne s'y remonterait à chaque clic, et le focus clavier repartirait de
 * zéro à chaque navigation. Ici elle est montée une fois, et seule la zone
 * centrale est remplacée — c'est déjà ce qui garde le chat Manager ouvert.
 *
 * ── TROIS RANGS, ET ILS NE SE RESSEMBLENT PAS ───────────────────────────────
 *
 *  ① « Aujourd'hui » — le POINT DE DÉPART. Une icône de maison, et rien
 *    d'autre : pas de pastille, pas de fond, pas de rendu d'onglet. Ce n'est
 *    pas une section parmi cinq, c'est l'endroit où l'on revient. L'état actif
 *    ne se marque donc que par la couleur et le poids.
 *  ② Les quatre SECTIONS — rendu d'onglet, avec la pastille de sélection des
 *    cartes-compteurs (`SELECTION`, mêmes valeurs, importées) et les badges de
 *    compte alignés à droite.
 *  ③ « Réglages », en bas. Ce n'est pas une destination de travail : il quitte
 *    la barre du haut mais ne rejoint pas les quatre.
 *
 * ── REPLI ───────────────────────────────────────────────────────────────────
 * Sous 1 100 px, la colonne passe en icônes seules, les libellés deviennent
 * des infobulles. Le repli est en CSS pur (`max-[1099px]:`) : un repli piloté
 * en JavaScript afficherait la version large pendant une frame au chargement.
 *
 * ── CLAVIER ─────────────────────────────────────────────────────────────────
 * Tab et Entrée viennent des `<a>` ; les FLÈCHES haut/bas déplacent le focus
 * d'une entrée à l'autre, comme dans un menu. `aria-current="page"` marque
 * l'entrée active — c'est ce que lit un lecteur d'écran, la couleur ne lui dit
 * rien.
 */

import {
  BarChart3,
  CalendarCheck,
  Home,
  Megaphone,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef } from 'react';

import { CountBadge } from '@/components/ui/CountBadge';
import { DASH } from '@/components/ui/list-skin';
import { SELECTION } from '@/components/ui/tokens';
import {
  WORKSPACE_ENTRIES,
  workspaceEntryForPath,
  type WorkspaceEntryId,
} from '@/lib/navigation/workspace-routes';

import {
  badgesFor,
  overdueFor,
  type WorkspaceNavBadges,
} from './workspace-badges';

/** La couleur de l'icône « Aujourd'hui ». Le point de départ a la sienne. */
const COULEUR_ACCUEIL = 'var(--dash-accueil)';

const ICONES: Record<WorkspaceEntryId, LucideIcon> = {
  aujourdhui: Home,
  campagnes: Megaphone,
  candidatures: Users,
  entretiens: CalendarCheck,
  pilotage: BarChart3,
};

/** Teinte de la bordure quand l'entrée est active — celle de sa section. */
const TEINTES: Record<WorkspaceEntryId, string> = {
  aujourdhui: COULEUR_ACCUEIL,
  campagnes: 'var(--dash-sky)',
  candidatures: 'var(--dash-blue)',
  entretiens: 'var(--dash-teal)',
  pilotage: 'var(--dash-purple)',
};

export function WorkspaceSidebar({ badges }: { badges: WorkspaceNavBadges }) {
  const pathname = usePathname();
  const active = workspaceEntryForPath(pathname ?? '');
  const colonne = useRef<HTMLElement | null>(null);

  /** Flèches : on déplace le focus, on ne navigue pas. */
  function auClavier(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const liens = [...(colonne.current?.querySelectorAll('a') ?? [])];
    const i = liens.indexOf(document.activeElement as HTMLAnchorElement);
    if (i === -1) return;
    e.preventDefault();
    const suivant = e.key === 'ArrowDown' ? i + 1 : i - 1;
    liens[(suivant + liens.length) % liens.length]?.focus();
  }

  const [accueil, ...sections] = WORKSPACE_ENTRIES;

  return (
    <nav
      ref={colonne}
      onKeyDown={auClavier}
      aria-label="Espaces de travail"
      data-workspace-sidebar
      // 252 px : à 236, « Candidatures » se tronquait dès qu'elle portait ses
      // deux badges. Un libellé coupé par un compteur se lit deux fois.
      className="relative z-20 flex w-[252px] shrink-0 flex-col gap-1 border-r px-3 py-4 max-[1099px]:w-[64px] max-[1099px]:px-2"
      style={{ borderColor: DASH.bordure, background: 'var(--dash-surface)' }}
    >
      {/* ① LE POINT DE DÉPART — aucune pastille, aucun fond. */}
      <Entree
        entry={accueil!}
        actif={active === accueil!.id}
        depart
        badges={badges}
      />

      <span
        aria-hidden
        className="my-2 h-px shrink-0"
        style={{ background: DASH.bordure }}
      />

      {/* ② LES QUATRE SECTIONS — rendu d'onglet. */}
      {sections.map((entry) => (
        <Entree
          key={entry.id}
          entry={entry}
          actif={active === entry.id}
          badges={badges}
        />
      ))}

      {/* ③ RÉGLAGES, en bas : pas une destination de travail. */}
      <span className="mt-auto" />
      <Link
        href="/settings"
        data-sidebar-entry="reglages"
        title="Paramètres"
        className="flex items-center gap-2.5 rounded-[10px] border px-3 py-2 font-body text-[13.5px] transition max-[1099px]:justify-center max-[1099px]:px-0"
        style={{
          borderColor: SELECTION.bordureRepos,
          background: SELECTION.fondRepos,
          color: DASH.secondaire,
        }}
      >
        <Settings aria-hidden className="h-[18px] w-[18px] shrink-0" />
        <span className="max-[1099px]:hidden">Paramètres</span>
      </Link>
    </nav>
  );
}

function Entree({
  entry,
  actif,
  depart = false,
  badges,
}: {
  entry: (typeof WORKSPACE_ENTRIES)[number];
  actif: boolean;
  /** Le point de départ : icône seule, sans rendu d'onglet. */
  depart?: boolean;
  badges: WorkspaceNavBadges;
}) {
  const Icone = ICONES[entry.id];
  const volume = badgesFor(entry.id, badges);
  const overdue = overdueFor(entry.id, badges);

  if (depart) {
    return (
      <Link
        href={entry.href}
        data-sidebar-entry={entry.id}
        aria-current={actif ? 'page' : undefined}
        aria-label={entry.label}
        title={entry.label}
        // ⚠️ Ni bordure ni fond, même actif : ce n'est pas une section. Seul
        // le POIDS du trait change.
        //
        // ⚠️ Et AUCUNE atténuation au repos. Une première version baissait
        // l'opacité à 0,65 : #fedc96 ne tient déjà que 1,35:1 sur le blanc,
        // l'atténuer rendait l'icône quasi invisible — or c'est la SEULE
        // chose qui désigne cette entrée, elle n'a pas de libellé. Le poids du
        // trait suffit à marquer l'état, et l'infobulle porte le nom.
        className="flex items-center justify-center rounded-[10px] px-3 py-2 transition max-[1099px]:px-0"
        style={{ color: COULEUR_ACCUEIL }}
      >
        <Icone
          aria-hidden
          className="h-[24px] w-[24px] shrink-0"
          strokeWidth={actif ? 2.8 : 2}
        />
      </Link>
    );
  }

  return (
    <Link
      href={entry.href}
      data-sidebar-entry={entry.id}
      aria-current={actif ? 'page' : undefined}
      title={entry.label}
      // La pastille de sélection des cartes-compteurs, mêmes valeurs.
      className="flex items-center gap-2.5 rounded-[10px] border px-3 py-2 font-body text-[13.5px] transition max-[1099px]:justify-center max-[1099px]:px-0"
      style={{
        borderColor: actif ? TEINTES[entry.id] : SELECTION.bordureRepos,
        background: actif ? SELECTION.fond : SELECTION.fondRepos,
        color: actif ? DASH.texte : DASH.secondaire,
        fontWeight: actif ? 700 : 500,
      }}
    >
      <Icone aria-hidden className="h-[18px] w-[18px] shrink-0" />
      <span className="min-w-0 flex-1 truncate max-[1099px]:hidden">{entry.label}</span>
      {/* Les badges EXISTANTS, alignés à droite. Repliée, la colonne les
          cache : un chiffre sans son libellé ne dit pas de quoi il parle, et
          l'infobulle du lien le porte déjà. */}
      <span className="flex shrink-0 items-center gap-1 max-[1099px]:hidden">
        {volume.map((v) => (
          <CountBadge
            key={v.tone}
            tone={v.tone === 'vivier' ? 'vivier' : 'alert'}
            title={v.title}
          >
            {v.count}
          </CountBadge>
        ))}
        {overdue ? (
          <CountBadge tone="waiting" title={overdue.title}>
            <span aria-hidden className="text-[9px] leading-none">
              ⏳
            </span>
            {overdue.count}
          </CountBadge>
        ) : null}
      </span>
    </Link>
  );
}
