/**
 * Le parcours d'une personne, en sections : poste actuel, frise des postes,
 * formation, résumé. UN SEUL rendu, réutilisé par le détail d'un profil
 * (lecture) et par la page d'atterrissage (chaque ligne porte « corriger »).
 *
 * `lineAction(index)` reçoit l'indice D'ORIGINE de la ligne : l'affichage est
 * trié du plus récent au plus ancien, la correction vise la bonne donnée.
 * `lineEditor(index)` s'insère sous la ligne en cours de correction.
 */
import { Briefcase, GraduationCap, History, Quote, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';

import { currentPositionOf, durationLabel, newestFirst, periodLabel, tenureLabel } from '@/lib/sourcing/display';

import { ProfileSection } from './ProfileSection';

export type CareerItem = { title: string; company: string | null; from: string | null; to: string | null; description?: string | null };
export type EducationItem = { degree: string | null; institution: string | null; from: string | null; to: string | null };

type LineHooks = { lineAction?: (index: number) => ReactNode; lineEditor?: (index: number) => ReactNode };

const muted = { color: 'var(--dash-text-tertiary)' } as const;

export function CurrentPositionSection({ items, fallback }: { items: CareerItem[]; fallback?: { title: string | null; company: string | null; since: string | null } | null }) {
  const current = currentPositionOf(items);
  const title = current?.title ?? fallback?.title ?? null;
  if (!title) return null;
  const company = current ? current.company : (fallback?.company ?? null);
  const since = tenureLabel(current ? current.from : (fallback?.since ?? null));
  return (
    <ProfileSection title="Poste actuel" icon={Briefcase} accent="orange" testId="current">
      <p className="font-display text-[16px] font-bold leading-snug" style={{ color: 'var(--dash-text)' }}>{title}</p>
      <p className="font-body text-[13.5px]" style={{ color: 'var(--dash-text-secondary)' }}>
        {[company, since].filter(Boolean).join(' · ')}
      </p>
    </ProfileSection>
  );
}

export function CareerTimelineSection({ items, lineAction, lineEditor, footer }: { items: CareerItem[]; footer?: ReactNode } & LineHooks) {
  if (items.length === 0 && !footer) return null;
  return (
    <ProfileSection title="Parcours" icon={History} accent="blue" testId="career">
      <ol className="relative flex flex-col">
        {newestFirst(items).map(({ item, index }, rank, all) => (
          <li key={index} data-career-line={index} className="relative grid grid-cols-[14px_1fr] gap-x-3 pb-3 last:pb-0">
            <span className="relative flex justify-center" aria-hidden>
              <span className="mt-1.5 h-2.5 w-2.5 rounded-full border-2 bg-white" style={{ borderColor: item.to === null ? 'var(--dash-blue)' : 'var(--dash-border-strong)' }} />
              {rank < all.length - 1 ? <span className="absolute top-4 bottom-[-6px] w-px" style={{ backgroundColor: 'var(--dash-border)' }} /> : null}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="font-data text-[11.5px]" style={muted}>{periodLabel(item.from, item.to) ?? 'dates non renseignées'}</span>
                <span className="ml-auto font-body text-[11.5px]" style={muted}>{durationLabel(item.from, item.to)}</span>
              </div>
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 font-body text-[13.5px] leading-snug" style={{ color: 'var(--dash-text)' }}>
                  <span className="font-semibold">{item.title || <em style={muted}>intitulé à compléter</em>}</span>
                  {item.company ? <span style={{ color: 'var(--dash-text-secondary)' }}> · {item.company}</span> : null}
                </p>
                {lineAction?.(index)}
              </div>
              {item.description ? (
                <p className="mt-1 whitespace-pre-line font-body text-[12.5px] leading-relaxed" style={{ color: 'var(--dash-text-secondary)' }}>{item.description}</p>
              ) : null}
              {lineEditor?.(index)}
            </div>
          </li>
        ))}
      </ol>
      {footer}
    </ProfileSection>
  );
}

export function EducationSection({ items, lineAction, lineEditor, footer }: { items: EducationItem[]; footer?: ReactNode } & LineHooks) {
  if (items.length === 0 && !footer) return null;
  return (
    <ProfileSection title="Formation" icon={GraduationCap} accent="purple" testId="education">
      <ul className="flex flex-col gap-2">
        {newestFirst(items).map(({ item, index }) => (
          <li key={index} data-education-line={index}>
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 font-body text-[13.5px] leading-snug" style={{ color: 'var(--dash-text)' }}>
                <span className="font-semibold">{item.degree || <em style={muted}>diplôme à compléter</em>}</span>
                {item.institution ? <span style={{ color: 'var(--dash-text-secondary)' }}> · {item.institution}</span> : null}
                {item.to || item.from ? <span className="ml-2 font-data text-[11.5px]" style={muted}>{(item.to ?? item.from)!.slice(0, 4)}</span> : null}
              </p>
              {lineAction?.(index)}
            </div>
            {lineEditor?.(index)}
          </li>
        ))}
      </ul>
      {footer}
    </ProfileSection>
  );
}

export function AboutSection({ text, action, editor }: { text: string | null; action?: ReactNode; editor?: ReactNode }) {
  if (!text && !editor && !action) return null;
  return (
    <ProfileSection title="Résumé" icon={Quote} accent="teal" aside={action} testId="about">
      {text ? (
        <blockquote className="whitespace-pre-line border-l-2 pl-3 font-body text-[13.5px] italic leading-relaxed" style={{ borderColor: 'var(--dash-teal-light)', color: 'var(--dash-text-secondary)' }}>
          {text}
        </blockquote>
      ) : (
        <p className="font-body text-[13px] italic" style={muted}>Aucun résumé.</p>
      )}
      {editor}
    </ProfileSection>
  );
}

export type SkillsValue = { skills: string | null; languages: string | null; certifications: string | null };

export function SkillsSection({ value, action, editor }: { value: SkillsValue; action?: ReactNode; editor?: ReactNode }) {
  const rows: [string | null, string | null][] = [
    [null, value.skills],
    ['Langues', value.languages],
    ['Certifications', value.certifications],
  ];
  const filled = rows.filter(([, v]) => v);
  if (filled.length === 0 && !editor && !action) return null;
  return (
    <ProfileSection title="Compétences" icon={Wrench} accent="indigo" aside={action} testId="skills">
      {editor ?? (
        filled.length > 0 ? (
          filled.map(([label, v]) => (
            <p key={label ?? 'skills'} className="font-body text-[13px]" style={{ color: label ? 'var(--dash-text-secondary)' : 'var(--dash-text)' }}>
              {label ? `${label} : ` : ''}
              {v}
            </p>
          ))
        ) : (
          <p className="font-body text-[13px] italic" style={muted}>Aucune compétence renseignée.</p>
        )
      )}
    </ProfileSection>
  );
}
