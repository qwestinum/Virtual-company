'use client';

/**
 * Réglages de créneau : durée, battement, préavis, horizon, fuseau.
 *
 * Le battement mérite son existence : deux entretiens collés sur une même
 * salle de visio font se croiser deux candidats. Le module l'applique après
 * chaque rendez-vous pris.
 */

export type SlotSettings = {
  timezone: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  horizonDays: number;
};

export const DEFAULT_SLOT_SETTINGS: SlotSettings = {
  timezone: 'Europe/Paris',
  slotDurationMinutes: 45,
  bufferMinutes: 15,
  minNoticeMinutes: 1440,
  horizonDays: 30,
};

const NUM =
  'w-20 rounded-md border border-stone-300 bg-white px-2 py-1 font-body text-[12.5px] text-stone-800 outline-none focus:border-blue-400';

export function SlotSettingsRow({
  value,
  onChange,
}: {
  value: SlotSettings;
  onChange: (next: SlotSettings) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Durée (min)">
        <input
          type="number"
          className={NUM}
          value={value.slotDurationMinutes}
          onChange={(e) =>
            onChange({ ...value, slotDurationMinutes: Number(e.currentTarget.value) })
          }
        />
      </Field>
      <Field label="Battement (min)">
        <input
          type="number"
          className={NUM}
          value={value.bufferMinutes}
          onChange={(e) =>
            onChange({ ...value, bufferMinutes: Number(e.currentTarget.value) })
          }
        />
      </Field>
      <Field label="Préavis (h)">
        <input
          type="number"
          className={NUM}
          value={Math.round(value.minNoticeMinutes / 60)}
          onChange={(e) =>
            onChange({ ...value, minNoticeMinutes: Number(e.currentTarget.value) * 60 })
          }
        />
      </Field>
      <Field label="Horizon (j)">
        <input
          type="number"
          className={NUM}
          value={value.horizonDays}
          onChange={(e) =>
            onChange({ ...value, horizonDays: Number(e.currentTarget.value) })
          }
        />
      </Field>
      <Field label="Fuseau">
        <input
          className={`${NUM} w-40`}
          value={value.timezone}
          onChange={(e) => onChange({ ...value, timezone: e.currentTarget.value })}
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-body text-[11.5px] font-semibold text-stone-600">
        {label}
      </span>
      {children}
    </label>
  );
}
