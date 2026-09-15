'use client';

/**
 * État et gestes de l'écran « Agenda externe » : lire l'état, tester un lien,
 * l'enregistrer, le retirer. Le lien saisi ne quitte le navigateur que vers
 * ces routes ; aucune ne le renvoie.
 */
import { useCallback, useEffect, useState } from 'react';

import type {
  BusyCalendarProbeResponse,
  BusyCalendarSaveResponse,
  BusyCalendarStatus,
} from '@/types/busy-calendar';

export type BusyCalendarFeedback = { tone: 'ok' | 'warn' | 'danger'; text: string; warnings: string[] };

const endpoint = (recruiterId: string) => `/api/recruiters/${encodeURIComponent(recruiterId)}/busy-calendar`;

export function useBusyCalendar(recruiterId: string) {
  /** `undefined` = en chargement ; `null` = la fonction n'existe pas sur cette installation. */
  const [status, setStatus] = useState<BusyCalendarStatus | null | undefined>(undefined);
  const [busy, setBusy] = useState<'test' | 'save' | 'clear' | null>(null);
  const [feedback, setFeedback] = useState<BusyCalendarFeedback | null>(null);
  /** Dernier lien testé AVEC SUCCÈS : seul lui peut s'enregistrer. */
  const [testedUrl, setTestedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(endpoint(recruiterId), { cache: 'no-store' });
        if (cancelled) return;
        setStatus(res.ok ? ((await res.json()) as BusyCalendarStatus) : null);
      } catch {
        if (!cancelled) setStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recruiterId]);

  const test = useCallback(
    async (url: string) => {
      setBusy('test');
      setFeedback(null);
      setTestedUrl(null);
      try {
        const res = await fetch(`${endpoint(recruiterId)}/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const body = (await res.json()) as BusyCalendarProbeResponse;
        if (body.ok) {
          setTestedUrl(url);
          const empty = body.upcomingCount === 0;
          setFeedback({ tone: empty ? 'warn' : 'ok', text: body.message, warnings: body.warnings });
        } else {
          setFeedback({ tone: 'danger', text: body.message, warnings: [] });
        }
      } catch {
        setFeedback({ tone: 'danger', text: 'Erreur réseau — le lien n’a pas pu être testé.', warnings: [] });
      } finally {
        setBusy(null);
      }
    },
    [recruiterId],
  );

  const save = useCallback(
    async (url: string): Promise<boolean> => {
      setBusy('save');
      try {
        const res = await fetch(endpoint(recruiterId), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const body = (await res.json()) as BusyCalendarSaveResponse;
        if (!body.ok) {
          setTestedUrl(null);
          setFeedback({ tone: 'danger', text: body.message, warnings: [] });
          return false;
        }
        setStatus(body.status);
        setTestedUrl(null);
        setFeedback({ tone: 'ok', text: `Enregistré. ${body.message}`, warnings: body.warnings });
        return true;
      } catch {
        setFeedback({ tone: 'danger', text: 'Erreur réseau — rien n’a été enregistré.', warnings: [] });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [recruiterId],
  );

  const clear = useCallback(async () => {
    setBusy('clear');
    try {
      const res = await fetch(endpoint(recruiterId), { method: 'DELETE' });
      if (res.ok) {
        setStatus((await res.json()) as BusyCalendarStatus);
        setFeedback({
          tone: 'ok',
          text: 'Lien retiré. Pour couper tout accès, réinitialise aussi la publication dans Outlook.',
          warnings: [],
        });
      } else {
        setFeedback({ tone: 'danger', text: 'Le lien n’a pas pu être retiré. Réessaie.', warnings: [] });
      }
    } catch {
      setFeedback({ tone: 'danger', text: 'Erreur réseau — le lien n’a pas été retiré.', warnings: [] });
    } finally {
      setBusy(null);
    }
  }, [recruiterId]);

  return { status, busy, feedback, testedUrl, test, save, clear, resetTest: () => setTestedUrl(null) };
}
