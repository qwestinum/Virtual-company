'use client';

/**
 * Gestion des RECRUTEURS de l'espace (multi-utilisateur) — section ADMIN
 * uniquement (rendue conditionnellement par la page serveur ; les routes
 * /api/recruiters re-vérifient le rôle). Ajout = CHOISIR un compte Supabase
 * Auth déjà invité dans la liste des comptes non référencés (zéro resaisie
 * d'UUID) : voir docs/ops/multi-utilisateur.md. Jamais de suppression :
 * désactivation douce.
 */

import { Loader2, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { Recruiter } from '@/types/recruiter';

import {
  EMPTY_RECRUITER_FORM,
  RecruiterForm,
  type RecruiterFormState,
} from './RecruiterForm';

export function RecruitersManager() {
  const [items, setItems] = useState<Recruiter[]>([]);
  const [loading, setLoading] = useState(true);
  const [formInitial, setFormInitial] = useState<RecruiterFormState | null>(null);
  const [editing, setEditing] = useState(false);

  async function load() {
    try {
      const res = await fetch('/api/recruiters', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { recruiters?: Recruiter[] };
      setItems(data.recruiters ?? []);
    } catch (err) {
      console.error('[recruiters] load failed', err);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  async function patchOne(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/recruiters/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) await load();
  }

  if (loading) {
    return (
      <p className="font-body text-[13px] text-stone-400">
        <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" aria-hidden />
        Chargement…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {items.map((r) => (
          <li
            key={r.id}
            className={`flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 ${r.isActive ? '' : 'opacity-55'}`}
          >
            <div className="min-w-0 flex-1">
              <p className="font-body text-[13.5px] font-semibold text-stone-800">
                {r.displayName}
                <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 font-body text-[10.5px] font-semibold uppercase tracking-wide text-stone-500">
                  {r.role === 'admin' ? 'Admin' : 'Membre'}
                </span>
                {!r.isActive ? (
                  <span className="ml-1.5 font-body text-[11px] italic text-stone-400">
                    désactivé
                  </span>
                ) : null}
              </p>
              <p className="truncate font-body text-[12px] text-stone-500">
                {r.email} ·{' '}
                {r.calcomLink ? (
                  <span className="text-stone-600">{r.calcomLink}</span>
                ) : (
                  <span className="italic">sans lien Cal.com (agenda global)</span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setFormInitial({
                  id: r.id,
                  displayName: r.displayName,
                  email: r.email,
                  calcomLink: r.calcomLink ?? '',
                });
              }}
              title="Modifier (nom, lien Cal.com)"
              className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => patchOne(r.id, { isActive: !r.isActive })}
              className="rounded-lg border border-stone-300 px-2.5 py-1 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-50"
            >
              {r.isActive ? 'Désactiver' : 'Réactiver'}
            </button>
          </li>
        ))}
        {items.length === 0 ? (
          <li className="font-body text-[13px] italic text-stone-400">
            Aucun recruteur référencé — seed admin à exécuter (runbook
            docs/ops/multi-utilisateur.md §1).
          </li>
        ) : null}
      </ul>

      {formInitial ? (
        <RecruiterForm
          key={`${editing}-${formInitial.id}`}
          initial={formInitial}
          editing={editing}
          onClose={() => setFormInitial(null)}
          onSaved={() => {
            setFormInitial(null);
            void load();
          }}
        />
      ) : (
        <div>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setFormInitial(EMPTY_RECRUITER_FORM);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-50"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Ajouter un recruteur
          </button>
        </div>
      )}
    </div>
  );
}
