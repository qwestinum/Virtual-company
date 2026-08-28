'use client';

/**
 * Disponibilités et lieu d'entretien d'un recruteur — l'écran qui remplace le
 * champ « lien Cal.com » de la fiche.
 *
 * Orchestration seulement : la grille, les absences, le lieu, les réglages et
 * l'aperçu vivent chacun dans leur composant. Ce fichier charge, valide,
 * enregistre — et affiche ce que le serveur a réellement retenu (l'aperçu
 * renvoyé par la sauvegarde, pas une projection locale).
 */

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  totalOpenMinutes,
  validateRules,
  type RuleDraft,
} from '@/lib/interviews/availability-form';
import { isMeetingLocationComplete, type MeetingLocation, type Slot } from '@/lib/scheduling';

import { AvailabilityPreview } from './AvailabilityPreview';
import { ExceptionsEditor, type ExceptionDraft } from './ExceptionsEditor';
import { MeetingLocationField } from './MeetingLocationField';
import {
  DEFAULT_SLOT_SETTINGS,
  SlotSettingsRow,
  type SlotSettings,
} from './SlotSettingsRow';
import { WeeklyRulesEditor } from './WeeklyRulesEditor';

type AvailabilityPayload = {
  resource: (SlotSettings & { meetingLocation: MeetingLocation | null }) | null;
  rules: RuleDraft[];
  exceptions: { day: string; label: string | null }[];
  preview: Slot[];
  message?: string;
};

export function AvailabilityEditor({ recruiterId }: { recruiterId: string }) {
  const [settings, setSettings] = useState<SlotSettings>(DEFAULT_SLOT_SETTINGS);
  const [location, setLocation] = useState<MeetingLocation | null>(null);
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionDraft[]>([]);
  const [preview, setPreview] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function apply(data: AvailabilityPayload): void {
    if (data.resource) {
      setSettings({
        timezone: data.resource.timezone,
        slotDurationMinutes: data.resource.slotDurationMinutes,
        bufferMinutes: data.resource.bufferMinutes,
        minNoticeMinutes: data.resource.minNoticeMinutes,
        horizonDays: data.resource.horizonDays,
      });
      setLocation(data.resource.meetingLocation);
    }
    setRules(data.rules ?? []);
    setExceptions((data.exceptions ?? []).map((e) => ({ day: e.day, label: e.label })));
    setPreview(data.preview ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(endpoint(recruiterId), { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        apply((await res.json()) as AvailabilityPayload);
      } catch {
        // Chargement KO : l'écran reste sur ses valeurs par défaut, et
        // l'enregistrement dira ce qui ne va pas.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recruiterId]);

  async function save() {
    // Refus AVANT l'aller-retour : une plage inversée ou deux plages qui se
    // chevauchent produiraient une grille que personne ne sait relire.
    const errors = validateRules(rules);
    if (errors.length > 0) {
      setMessage(errors[0]!);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(endpoint(recruiterId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...settings,
          meetingLocation: location,
          rules,
          exceptions,
        }),
      });
      const data = (await res.json()) as AvailabilityPayload;
      if (!res.ok) {
        setMessage(data.message ?? 'Enregistrement impossible.');
        return;
      }
      apply(data);
      // Deux façons d'enregistrer un agenda qui n'invitera personne : sans
      // plage ouverte, ou sans lieu. On nomme celle qui s'applique plutôt que
      // de rendre un « enregistré » qui laisserait croire que tout est prêt.
      setMessage(
        totalOpenMinutes(rules) === 0
          ? 'Enregistré — mais aucune plage n’est ouverte : aucun créneau ne sera proposé.'
          : !data.resource?.meetingLocation
            ? 'Enregistré — mais aucun lieu d’entretien n’est renseigné : aucune invitation ne pourra partir.'
            : 'Disponibilités enregistrées.',
      );
    } catch {
      setMessage('Erreur réseau — rien n’a été enregistré.');
    } finally {
      setSaving(false);
    }
  }

  // Un type choisi sans son détail ne s'enregistre pas : le serveur le refuse,
  // et l'écran doit le dire avant le clic plutôt qu'après.
  const locationIncomplete = location !== null && !isMeetingLocationComplete(location);

  if (loading) {
    return (
      <p className="font-body text-[13px] text-stone-400">
        <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" aria-hidden />
        Chargement des disponibilités…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SlotSettingsRow value={settings} onChange={setSettings} />
      <WeeklyRulesEditor rules={rules} onChange={setRules} />
      <ExceptionsEditor exceptions={exceptions} onChange={setExceptions} />
      <MeetingLocationField
        value={location}
        onChange={setLocation}
        required
        // Pas d'entrée « non précisé » : sur un agenda, ne rien choisir n'est
        // pas un choix, c'est une invitation qui ne partira jamais. L'entrée
        // neutre reste VISIBLE pour les agendas d'avant cette règle (elle dit
        // ce qu'il manque), mais on ne peut plus y revenir.
        noneOption={{ label: '— Choisir un lieu —', selectable: false }}
        neutralNote={
          <p>
            Tant qu’aucun lieu n’est choisi, aucune invitation ne peut partir
            pour les campagnes dont tu es référent : le candidat réserverait un
            rendez-vous sans savoir où il a lieu.
          </p>
        }
      />
      <AvailabilityPreview slots={preview} timezone={settings.timezone} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded-md bg-stone-800 px-3 py-1.5 font-body text-[13px] font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
          disabled={saving || locationIncomplete}
          onClick={() => void save()}
        >
          {saving ? 'Enregistrement…' : 'Enregistrer les disponibilités'}
        </button>
        {message ? (
          <span className="font-body text-[12.5px] text-stone-600">{message}</span>
        ) : null}
      </div>
    </div>
  );
}

function endpoint(recruiterId: string): string {
  return `/api/recruiters/${encodeURIComponent(recruiterId)}/availability`;
}
