'use client';

/**
 * Correction d'UNE ligne du parcours, ouverte sous la ligne par « corriger ✎ ».
 * Champs pleine largeur sur mobile, côte à côte dès que la place le permet.
 */
import type { CareerItem, EducationItem } from '@/components/sourcing/profile/CareerSections';

const input = 'w-full rounded-md border bg-white px-3 py-2 font-body text-[14px]';
const border = { borderColor: 'var(--dash-border-strong)' } as const;
const month = (v: string | null) => (v && /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : '');
const fromMonth = (v: string) => (v.trim() === '' ? null : v.trim());

function Frame({ children, onDone, onRemove }: { children: React.ReactNode; onDone: () => void; onRemove: () => void }) {
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border p-3" style={{ borderColor: 'var(--dash-border)', backgroundColor: 'var(--dash-warm)' }}>
      {children}
      <div className="flex items-center justify-between">
        <button type="button" onClick={onRemove} className="font-body text-[13px] underline" style={{ color: 'var(--dash-text-secondary)' }}>
          retirer cette ligne
        </button>
        <button type="button" onClick={onDone} className="rounded-md border bg-white px-3 py-1 font-body text-[13px] font-semibold" style={border}>
          OK
        </button>
      </div>
    </div>
  );
}

function Dates({ from, to, onChange }: { from: string | null; to: string | null; onChange: (from: string | null, to: string | null) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 font-body text-[12px]" style={{ color: 'var(--dash-text-secondary)' }}>
        Début
        <input type="month" className={input} style={border} value={month(from)} onChange={(e) => onChange(fromMonth(e.target.value), to)} />
      </label>
      <label className="flex flex-col gap-1 font-body text-[12px]" style={{ color: 'var(--dash-text-secondary)' }}>
        Fin (vide : en cours)
        <input type="month" className={input} style={border} value={month(to)} onChange={(e) => onChange(from, fromMonth(e.target.value))} />
      </label>
    </div>
  );
}

export function WorkLineEditor({ value, onChange, onDone, onRemove }: { value: CareerItem; onChange: (v: CareerItem) => void; onDone: () => void; onRemove: () => void }) {
  return (
    <Frame onDone={onDone} onRemove={onRemove}>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={input} style={border} value={value.title} placeholder="Intitulé du poste" onChange={(e) => onChange({ ...value, title: e.target.value })} />
        <input className={input} style={border} value={value.company ?? ''} placeholder="Entreprise" onChange={(e) => onChange({ ...value, company: e.target.value || null })} />
      </div>
      <Dates from={value.from} to={value.to} onChange={(from, to) => onChange({ ...value, from, to })} />
    </Frame>
  );
}

export function EducationLineEditor({ value, onChange, onDone, onRemove }: { value: EducationItem; onChange: (v: EducationItem) => void; onDone: () => void; onRemove: () => void }) {
  return (
    <Frame onDone={onDone} onRemove={onRemove}>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={input} style={border} value={value.degree ?? ''} placeholder="Diplôme" onChange={(e) => onChange({ ...value, degree: e.target.value || null })} />
        <input className={input} style={border} value={value.institution ?? ''} placeholder="Établissement" onChange={(e) => onChange({ ...value, institution: e.target.value || null })} />
      </div>
      <input className={input} style={border} inputMode="numeric" maxLength={4} value={(value.to ?? value.from ?? '').slice(0, 4)} placeholder="Année d’obtention" onChange={(e) => onChange({ ...value, to: e.target.value.trim() || null })} />
    </Frame>
  );
}

export function AboutEditor({ value, onChange, onDone }: { value: string | null; onChange: (v: string | null) => void; onDone: () => void }) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      <textarea className={`${input} min-h-[120px]`} style={border} value={value ?? ''} maxLength={3000} onChange={(e) => onChange(e.target.value || null)} />
      <button type="button" onClick={onDone} className="self-end rounded-md border bg-white px-3 py-1 font-body text-[13px] font-semibold" style={border}>
        OK
      </button>
    </div>
  );
}
