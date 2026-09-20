'use client';

/**
 * Une section d'*Aujourd'hui* : un titre, un compteur, un VERBE, des lignes.
 *
 * ⚠️ À zéro, la section rend UNE PHRASE — jamais une carte vide. Une carte
 * vide occupe la place d'un travail qui n'existe pas : elle fait lire un écran
 * chargé là où il n'y a rien, et c'est ce qui rend un tableau de bord
 * fatigant. La phrase, elle, se balaie en un regard.
 */

import Link from 'next/link';

export function TodaySection({
  title,
  count,
  verb,
  emptyLabel,
  seeAll,
  children,
}: {
  title: string;
  count: number;
  /** Ce qu'on vient y FAIRE, en une phrase. */
  verb: string;
  /** Ce qui s'affiche quand il n'y a rien. */
  emptyLabel: string;
  seeAll?: { label: string; href: string } | null;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline gap-3 border-b border-stone-200 pb-1.5">
        <h2 className="font-display text-[13px] font-bold uppercase tracking-[0.12em] text-stone-700">
          {title}
        </h2>
        {count > 0 ? (
          <span className="font-data text-[13px] font-bold text-stone-900">
            {count}
          </span>
        ) : null}
        <p className="ml-auto font-body text-[12px] text-stone-500">{verb}</p>
      </header>

      {count === 0 ? (
        <p className="font-body text-[13px] text-stone-500">{emptyLabel}</p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">{children}</div>
          {seeAll ? (
            <div className="flex justify-end">
              <Link
                href={seeAll.href}
                className="inline-flex min-h-6 items-center font-body text-[12px] font-semibold text-stone-500 hover:text-stone-900"
              >
                {seeAll.label} →
              </Link>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Une ligne de section : un dossier, un repère d'ancienneté, une action. */
export function TodayRow({
  age,
  title,
  detail,
  actions,
}: {
  age: string | null;
  title: string;
  detail: string;
  actions: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-stone-200 bg-white px-3 py-2">
      {age ? (
        <span className="font-data text-[11px] font-semibold text-stone-500">
          {age}
        </span>
      ) : null}
      <span className="font-display text-[13px] font-bold text-stone-900">
        {title}
      </span>
      <span className="font-body text-[12px] text-stone-500">{detail}</span>
      <span className="ml-auto flex items-center gap-2">{actions}</span>
    </div>
  );
}

/** Lien d'action d'une ligne — cible ≥ 24 px (WCAG 2.5.8). */
export function TodayAction({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-6 items-center rounded-md border border-stone-300 bg-white px-2.5 py-1 font-body text-[12px] font-semibold text-stone-700 hover:bg-stone-50"
    >
      {label}
    </Link>
  );
}
