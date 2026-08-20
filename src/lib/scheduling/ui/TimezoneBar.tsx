'use client';

/**
 * Barre de fuseau — toujours visible, jamais implicite.
 *
 * Le fuseau est détecté depuis le navigateur, mais il reste AFFICHÉ et
 * modifiable : quelqu'un qui voyage, ou dont l'appareil est mal réglé, doit
 * pouvoir corriger sans nous écrire. C'est aussi ce qui autorise le reste de
 * l'interface à n'écrire aucune heure sans son étiquette.
 */
import { useMemo, useState } from 'react';

import { fill, type SchedulingLabels } from '../labels';
import { zoneLabel } from '../format';

export type TimezoneBarProps = {
  timeZone: string;
  labels: SchedulingLabels;
  onChange: (timeZone: string) => void;
};

export function TimezoneBar({ timeZone, labels, onChange }: TimezoneBarProps) {
  const [open, setOpen] = useState(false);
  const zones = useMemo(() => supportedZones(timeZone), [timeZone]);

  return (
    <div className="sched-tz">
      <div style={{ flex: 1 }}>
        <span>{fill(labels.timezoneLabel, { zone: zoneLabel(timeZone) })}</span>
        {open ? (
          <>
            <label className="sched-sr" htmlFor="sched-tz-select">
              {labels.timezoneChange}
            </label>
            <select
              id="sched-tz-select"
              className="sched-tz-select"
              value={timeZone}
              onChange={(event) => {
                onChange(event.currentTarget.value);
                setOpen(false);
              }}
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
      <button type="button" className="sched-tz-btn" onClick={() => setOpen(!open)}>
        {open ? labels.timezoneClose : labels.timezoneChange}
      </button>
    </div>
  );
}

/**
 * Liste des fuseaux connus du navigateur. `supportedValuesOf` n'existe pas
 * partout : on retombe alors sur une poignée de fuseaux courants, plus celui
 * déjà sélectionné — mieux vaut une liste courte qu'un sélecteur vide.
 */
function supportedZones(current: string): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  const all = intl.supportedValuesOf?.('timeZone');
  if (all && all.length > 0) return all;

  const fallback = [
    'Europe/Paris',
    'Europe/London',
    'Europe/Brussels',
    'Europe/Madrid',
    'Europe/Lisbon',
    'Africa/Casablanca',
    'Africa/Abidjan',
    'America/Montreal',
    'America/New_York',
    'UTC',
  ];
  return fallback.includes(current) ? fallback : [current, ...fallback];
}
