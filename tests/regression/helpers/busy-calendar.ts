/**
 * Allume le connecteur d'agenda externe AU CABINET (second étage du flag)
 * pour la durée d'un scénario, et rend de quoi remettre le réglage d'origine.
 *
 * Écrit dans `app_settings` de la base DEV : le réglage d'origine est relu et
 * restauré tel quel, jamais écrasé par un défaut.
 */
import { invalidateBusyCalendarActive } from '@/lib/scheduling-host/busy/active';

import { db } from './db';

export async function setBusyCalendarCabinet(enabled: boolean): Promise<() => Promise<void>> {
  const { data, error } = await db().from('app_settings').select('busy_calendar_config').eq('id', 1).maybeSingle();
  if (error) {
    throw new Error(`migration du lot D non appliquée en DEV (app_settings.busy_calendar_config) : ${error.message}`);
  }
  const previous = (data as { busy_calendar_config: unknown } | null)?.busy_calendar_config ?? null;
  const set = await db().from('app_settings').update({ busy_calendar_config: { enabled } }).eq('id', 1);
  if (set.error) throw new Error(`app_settings.busy_calendar_config : ${set.error.message}`);
  invalidateBusyCalendarActive();
  return async () => {
    await db().from('app_settings').update({ busy_calendar_config: previous }).eq('id', 1);
    invalidateBusyCalendarActive();
  };
}
