'use client';

/**
 * « Vos coordonnées » — nom, email à confirmer, téléphone et CV facultatifs.
 * Types de clavier adaptés (email, tel) et auto-complétion : sur mobile, la
 * saisie tient en quelques gestes.
 */

const field = 'w-full rounded-md border bg-white px-3 py-2.5 font-body text-[15px]';
const border = { borderColor: 'var(--dash-border-strong)' } as const;

export type Contact = { fullName: string; email: string; phone: string; cv: File | null };

export function ContactFields({ value, onChange, emailToConfirm }: { value: Contact; onChange: (next: Contact) => void; emailToConfirm: boolean }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-white px-4 py-4" style={{ borderColor: 'var(--dash-border)' }}>
      <Labeled label="Nom complet" required>
        <input className={field} style={border} required value={value.fullName} onChange={(e) => onChange({ ...value, fullName: e.target.value })} autoComplete="name" enterKeyHint="next" />
      </Labeled>
      <Labeled label="Email" required hint={emailToConfirm ? 'à confirmer' : undefined}>
        <input className={field} style={border} type="email" inputMode="email" required value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} autoComplete="email" enterKeyHint="next" />
      </Labeled>
      <Labeled label="Téléphone" hint="facultatif">
        <input className={field} style={border} type="tel" inputMode="tel" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} autoComplete="tel" enterKeyHint="done" />
      </Labeled>
      <Labeled label="CV" hint="facultatif · PDF ou DOCX, 10 Mo">
        <input
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => onChange({ ...value, cv: e.target.files?.[0] ?? null })}
          className="font-body text-[14px]"
        />
        <span className="font-body text-[12.5px]" style={{ color: 'var(--dash-text-tertiary)' }}>
          Si vous n’en joignez pas, le parcours ci-dessous servira de CV.
        </span>
      </Labeled>
    </div>
  );
}

function Labeled({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-body text-[13.5px] font-semibold" style={{ color: 'var(--dash-text)' }}>
        {label}
        {required ? <span style={{ color: 'var(--dash-orange)' }}> *</span> : null}
        {hint ? <span className="ml-2 font-normal" style={{ color: 'var(--dash-text-tertiary)' }}>{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}
