'use client';

/**
 * « Votre parcours » — DÉPLIABLE, replié par défaut sur un résumé d'une ligne.
 * Déplié, c'est le MÊME rendu que le détail d'un profil côté recruteur
 * (`CareerSections`), chaque ligne portant « corriger ✎ ».
 */
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { AboutSection, CareerTimelineSection, CurrentPositionSection, EducationSection } from '@/components/sourcing/profile/CareerSections';
import type { Submission } from '@/lib/sourcing/landing';

import { AboutEditor, EducationLineEditor, WorkLineEditor } from './LineEditors';

export type Recap = Pick<Submission, 'workHistory' | 'education' | 'about'>;

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function parcoursSummary(value: Recap): string {
  return `${plural(value.workHistory.length, 'expérience', 'expériences')} · ${plural(value.education.length, 'formation', 'formations')}`;
}

export function ParcoursEditor({ value, onChange, initiallyOpen = false }: { value: Recap; onChange: (next: Recap) => void; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [editing, setEditing] = useState<string | null>(null);

  const correct = (key: string) => (
    <button type="button" onClick={() => setEditing(editing === key ? null : key)} className="shrink-0 font-body text-[13px] font-semibold" style={{ color: 'var(--dash-orange)' }}>
      {editing === key ? 'fermer' : 'corriger ✎'}
    </button>
  );
  const add = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className="mt-2 font-body text-[13px] font-semibold underline" style={{ color: 'var(--dash-text-secondary)' }}>
      {label}
    </button>
  );
  const setWork = (i: number, w: Recap['workHistory'][number] | null) =>
    onChange({ ...value, workHistory: w ? value.workHistory.map((x, j) => (j === i ? w : x)) : value.workHistory.filter((_, j) => j !== i) });
  const setEdu = (i: number, e: Recap['education'][number] | null) =>
    onChange({ ...value, education: e ? value.education.map((x, j) => (j === i ? e : x)) : value.education.filter((_, j) => j !== i) });

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg border bg-white px-4 py-3 text-left"
        style={{ borderColor: 'var(--dash-border)' }}
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="flex-1 font-body text-[14px]" style={{ color: 'var(--dash-text)' }}>{parcoursSummary(value)}</span>
        <span className="font-body text-[13px] font-semibold" style={{ color: 'var(--dash-orange)' }}>{open ? 'replier' : 'vérifier ✎'}</span>
      </button>

      {open ? (
        <div className="flex flex-col gap-3">
          <CurrentPositionSection items={value.workHistory} />
          <CareerTimelineSection
            items={value.workHistory}
            lineAction={(i) => correct(`w${i}`)}
            lineEditor={(i) =>
              editing === `w${i}` ? <WorkLineEditor value={value.workHistory[i]!} onChange={(w) => setWork(i, w)} onDone={() => setEditing(null)} onRemove={() => { setWork(i, null); setEditing(null); }} /> : null
            }
            footer={add('+ ajouter une expérience', () => { onChange({ ...value, workHistory: [...value.workHistory, { title: '', company: null, from: null, to: null }] }); setEditing(`w${value.workHistory.length}`); })}
          />
          <EducationSection
            items={value.education}
            lineAction={(i) => correct(`e${i}`)}
            lineEditor={(i) =>
              editing === `e${i}` ? <EducationLineEditor value={value.education[i]!} onChange={(e) => setEdu(i, e)} onDone={() => setEditing(null)} onRemove={() => { setEdu(i, null); setEditing(null); }} /> : null
            }
            footer={add('+ ajouter une formation', () => { onChange({ ...value, education: [...value.education, { degree: null, institution: null, from: null, to: null }] }); setEditing(`e${value.education.length}`); })}
          />
          <AboutSection
            text={editing === 'about' ? null : value.about}
            action={correct('about')}
            editor={editing === 'about' ? <AboutEditor value={value.about} onChange={(about) => onChange({ ...value, about })} onDone={() => setEditing(null)} /> : null}
          />
        </div>
      ) : null}
    </div>
  );
}
