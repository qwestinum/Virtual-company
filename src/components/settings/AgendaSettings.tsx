'use client';

/**
 * Agendas & disponibilités — section À PART ENTIÈRE.
 *
 * L'éditeur ne vivait que dans la section « Recruteurs », réservée aux
 * administrateurs : un membre n'avait AUCUN moyen de déclarer ses propres
 * créneaux, alors même que la route les accepte (« soi-même ou
 * administrateur »). Quelqu'un dont on attend qu'il tienne son agenda à jour
 * ne doit pas dépendre d'un tiers pour y accéder.
 *
 * Chacun ouvre donc SON agenda ; un administrateur peut basculer sur celui
 * d'un autre — le sélecteur n'apparaît que pour lui.
 */

import { useEffect, useState } from 'react';

import { AvailabilityEditor } from './availability/AvailabilityEditor';

type RecruiterOption = { id: string; displayName: string };

export function AgendaSettings({
  currentUserId,
  isAdmin,
}: {
  currentUserId: string | null;
  isAdmin: boolean;
}) {
  const [options, setOptions] = useState<RecruiterOption[] | null>(null);
  const [selected, setSelected] = useState<string | null>(currentUserId);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/recruiters/options', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { options?: RecruiterOption[] };
        if (cancelled) return;
        const list = json.options ?? [];
        setOptions(list);
        // Un administrateur qui n'est pas lui-même dans la liste (compte
        // désactivé, par exemple) doit quand même pouvoir ouvrir un agenda.
        if (!list.some((o) => o.id === currentUserId) && list.length > 0) {
          setSelected(list[0]!.id);
        }
      } catch {
        if (!cancelled) setOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  if (options === null) {
    return (
      <p className="font-body text-[13px] text-stone-400">Chargement…</p>
    );
  }

  if (!currentUserId) {
    return (
      <p className="font-body text-[13px] text-stone-600">
        Session non identifiée — reconnecte-toi pour accéder à ton agenda.
      </p>
    );
  }

  const me = options.find((o) => o.id === currentUserId);
  if (!me && !isAdmin) {
    // Cas réel : un compte connecté qui n'est pas (ou plus) référencé comme
    // recruteur actif. On dit QUOI faire plutôt que d'afficher un écran vide.
    return (
      <p className="font-body text-[13px] text-stone-600">
        Ton compte n’est pas référencé comme recruteur actif : un administrateur
        doit l’ajouter dans « Recruteurs » avant que tu puisses déclarer tes
        disponibilités.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {isAdmin && options.length > 1 ? (
        <label className="flex flex-wrap items-center gap-2">
          <span className="font-body text-[12.5px] font-semibold text-stone-600">
            Agenda de
          </span>
          <select
            value={selected ?? ''}
            onChange={(e) => setSelected(e.currentTarget.value)}
            className="rounded-md border border-stone-300 bg-white px-2 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-blue-400"
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.displayName}
                {o.id === currentUserId ? ' (moi)' : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {selected ? (
        // `key` : changer de recruteur doit RECHARGER l'éditeur, pas lui
        // laisser la grille du précédent le temps d'un aller-retour.
        <AvailabilityEditor key={selected} recruiterId={selected} />
      ) : null}
    </div>
  );
}
