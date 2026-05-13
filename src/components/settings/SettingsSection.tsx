'use client';

/**
 * Bloc de section pour la page /settings (Session 6 v4).
 *
 * Wrapper visuel cohérent : icône + titre + description + contenu.
 * Pas de logique métier — pur layout.
 */

import type { ReactNode } from 'react';

export type SettingsSectionProps = {
  icon: string;
  title: string;
  description: string;
  children: ReactNode;
};

export function SettingsSection({
  icon,
  title,
  description,
  children,
}: SettingsSectionProps) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-start gap-3">
        <span aria-hidden className="text-2xl leading-none mt-0.5">
          {icon}
        </span>
        <div>
          <h2 className="font-display text-[17px] font-bold text-stone-900">
            {title}
          </h2>
          <p className="font-body text-[13px] text-stone-600 mt-1">
            {description}
          </p>
        </div>
      </header>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}
