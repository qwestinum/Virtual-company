'use client';

/**
 * Récapitulatif EN LECTURE SEULE, corrigeable ligne à ligne (spec §9.2).
 * La personne relit ce que son profil public disait ; « corriger ✎ » ouvre la
 * seule ligne concernée. Rien d'autre du profil n'est montré.
 */

import { useState } from 'react';

import { periodLabel } from '@/lib/sourcing/display';
import type { Submission } from '@/lib/sourcing/landing';

type Work = Submission['workHistory'][number];
type Edu = Submission['education'][number];

export type Recap = Pick<Submission, 'workHistory' | 'education' | 'about'>;

const input = 'rounded-md border border-stone-300 px-2 py-1 font-body text-[13px]';
const month = (v: string | null) => (v ? v.slice(0, 7) : '');
const fromMonth = (v: string) => (v.trim() === '' ? null : v.trim());

export function RecapEditor({ value, onChange }: { value: Recap; onChange: (next: Recap) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const setWork = (i: number, w: Work | null) =>
    onChange({ ...value, workHistory: w ? value.workHistory.map((x, j) => (j === i ? w : x)) : value.workHistory.filter((_, j) => j !== i) });
  const setEdu = (i: number, e: Edu | null) =>
    onChange({ ...value, education: e ? value.education.map((x, j) => (j === i ? e : x)) : value.education.filter((_, j) => j !== i) });

  return (
    <section className="flex flex-col gap-3">
      <Title>Votre parcours</Title>
      {value.workHistory.map((w, i) => (
        <Line key={`w${i}`} period={periodLabel(w.from, w.to)} text={[w.title, w.company].filter(Boolean).join(' — ')} editing={open === `w${i}`} onEdit={() => setOpen(open === `w${i}` ? null : `w${i}`)}>
          <input className={input} value={w.title} placeholder="Intitulé" onChange={(e) => setWork(i, { ...w, title: e.target.value })} />
          <input className={input} value={w.company ?? ''} placeholder="Entreprise" onChange={(e) => setWork(i, { ...w, company: e.target.value || null })} />
          <Dates from={w.from} to={w.to} onChange={(from, to) => setWork(i, { ...w, from, to })} />
          <Remove onClick={() => { setWork(i, null); setOpen(null); }} />
        </Line>
      ))}
      <button type="button" className="self-start font-body text-[13px] font-semibold text-stone-600 underline" onClick={() => { onChange({ ...value, workHistory: [...value.workHistory, { title: '', company: null, from: null, to: null }] }); setOpen(`w${value.workHistory.length}`); }}>
        + ajouter une expérience
      </button>

      <Title>Formation</Title>
      {value.education.map((e, i) => (
        <Line key={`e${i}`} period={periodLabel(e.from, e.to)} text={[e.degree, e.institution].filter(Boolean).join(' — ')} editing={open === `e${i}`} onEdit={() => setOpen(open === `e${i}` ? null : `e${i}`)}>
          <input className={input} value={e.degree ?? ''} placeholder="Diplôme" onChange={(ev) => setEdu(i, { ...e, degree: ev.target.value || null })} />
          <input className={input} value={e.institution ?? ''} placeholder="Établissement" onChange={(ev) => setEdu(i, { ...e, institution: ev.target.value || null })} />
          <Dates from={e.from} to={e.to} onChange={(from, to) => setEdu(i, { ...e, from, to })} />
          <Remove onClick={() => { setEdu(i, null); setOpen(null); }} />
        </Line>
      ))}
      <button type="button" className="self-start font-body text-[13px] font-semibold text-stone-600 underline" onClick={() => { onChange({ ...value, education: [...value.education, { degree: null, institution: null, from: null, to: null }] }); setOpen(`e${value.education.length}`); }}>
        + ajouter une formation
      </button>

      <Title>Résumé</Title>
      <Line period={null} text={value.about ?? ''} editing={open === 'about'} onEdit={() => setOpen(open === 'about' ? null : 'about')}>
        <textarea className={`${input} min-h-[90px] w-full`} value={value.about ?? ''} maxLength={3000} onChange={(e) => onChange({ ...value, about: e.target.value || null })} />
      </Line>
    </section>
  );
}

function Title({ children }: { children: string }) {
  return <h2 className="mt-1 font-body text-[12px] font-semibold uppercase tracking-wide text-stone-500">{children}</h2>;
}

function Line({ period, text, editing, onEdit, children }: { period: string | null; text: string; editing: boolean; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-stone-100 pb-2">
      <div className="flex items-start gap-3">
        {period !== null ? <span className="w-32 shrink-0 font-data text-[12px] text-stone-500">{period}</span> : null}
        <span className="min-w-0 flex-1 whitespace-pre-line font-body text-[13.5px] text-stone-800">{text || <em className="text-stone-400">à compléter</em>}</span>
        <button type="button" onClick={onEdit} className="shrink-0 font-body text-[12.5px] text-stone-500 hover:text-stone-800">
          {editing ? 'fermer' : 'corriger ✎'}
        </button>
      </div>
      {editing ? <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-[140px]">{children}</div> : null}
    </div>
  );
}

function Dates({ from, to, onChange }: { from: string | null; to: string | null; onChange: (from: string | null, to: string | null) => void }) {
  return (
    <span className="flex items-center gap-1 font-body text-[12.5px] text-stone-600">
      <input type="month" className={input} value={month(from)} onChange={(e) => onChange(fromMonth(e.target.value), to)} aria-label="Début" />
      –
      <input type="month" className={input} value={month(to)} onChange={(e) => onChange(from, fromMonth(e.target.value))} aria-label="Fin (vide : aujourd’hui)" />
    </span>
  );
}

function Remove({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="font-body text-[12.5px] text-stone-500 underline">
      retirer cette ligne
    </button>
  );
}
