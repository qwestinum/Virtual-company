'use client';

import { Archive, ArchiveRestore, Loader2, Pencil, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { DonneurOrdre } from '@/types/organisation';

/**
 * Admin légère des donneurs d'ordre (pré-requis reporting). UI austère —
 * page de configuration, pas une expérience démo. CRUD via /api/donneurs-ordre.
 * Archivage soft (l'entité reste résolvable pour l'historique/audit).
 */

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
};

const EMPTY_FORM: FormState = { firstName: '', lastName: '', email: '', role: '' };

export function DonneursOrdreManager() {
  const [items, setItems] = useState<DonneurOrdre[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    // Pas de setLoading(true) synchrone : `loading` démarre à true, et le
    // setState ne survient qu'après l'await (évite un render en cascade
    // depuis l'effet — cf. react-hooks/set-state-in-effect).
    try {
      const res = await fetch('/api/donneurs-ordre?includeArchived=1');
      if (res.status === 503) {
        setOffline(true);
        setItems([]);
        return;
      }
      const data = await res.json();
      setItems((data.donneursOrdre as DonneurOrdre[]) ?? []);
      setOffline(false);
    } catch (err) {
      console.error('[donneurs-ordre] load failed', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(item: DonneurOrdre) {
    setEditingId(item.id);
    setForm({
      firstName: item.firstName ?? '',
      lastName: item.lastName,
      email: item.email ?? '',
      role: item.role ?? '',
    });
    setError(null);
    setFormOpen(true);
  }

  async function save() {
    if (form.lastName.trim().length === 0) {
      setError('Le nom est obligatoire.');
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      firstName: form.firstName.trim() || null,
      lastName: form.lastName.trim(),
      email: form.email.trim() || null,
      role: form.role.trim() || null,
    };
    try {
      const res = await fetch(
        editingId ? `/api/donneurs-ordre/${editingId}` : '/api/donneurs-ordre',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? `Erreur (HTTP ${res.status}).`);
        return;
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(item: DonneurOrdre) {
    await fetch(`/api/donneurs-ordre/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: item.archivedAt === null }),
    });
    await load();
  }

  function fullName(item: DonneurOrdre): string {
    return [item.firstName, item.lastName].filter(Boolean).join(' ').trim();
  }

  if (offline) {
    return (
      <p className="font-body text-[13px] text-amber-800 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
        Supabase non configuré — les donneurs d&apos;ordre ne sont pas
        persistés. Configurez la connexion DB pour activer cette section.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {loading ? (
        <p className="font-body text-[13px] text-stone-500">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="font-body text-[13px] text-stone-500">
          Aucun donneur d&apos;ordre — ajoutez-en un ci-dessous.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
                item.archivedAt
                  ? 'border-stone-200 bg-stone-50/60 opacity-70'
                  : 'border-stone-200 bg-white'
              }`}
            >
              <div className="min-w-0">
                <p className="font-body text-[14px] font-semibold text-stone-800 truncate">
                  {fullName(item) || '—'}
                  {item.archivedAt ? (
                    <span className="ml-2 text-[11px] font-normal text-stone-400">
                      (archivé)
                    </span>
                  ) : null}
                </p>
                <p className="font-body text-[12px] text-stone-500 truncate">
                  {[item.role, item.email].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => openEdit(item)}
                  title="Modifier"
                  className="rounded-md p-2 text-stone-500 hover:bg-stone-100"
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => toggleArchive(item)}
                  title={item.archivedAt ? 'Désarchiver' : 'Archiver'}
                  className="rounded-md p-2 text-stone-500 hover:bg-stone-100"
                >
                  {item.archivedAt ? (
                    <ArchiveRestore className="h-4 w-4" aria-hidden />
                  ) : (
                    <Archive className="h-4 w-4" aria-hidden />
                  )}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {formOpen ? (
        <div className="rounded-lg border border-stone-300 bg-white px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-body text-[13px] font-semibold text-stone-700">
              {editingId ? 'Modifier le donneur d’ordre' : 'Nouveau donneur d’ordre'}
            </p>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded-md p-1 text-stone-400 hover:bg-stone-100"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Prénom" value={form.firstName} onChange={(v) => setForm({ ...form, firstName: v })} />
            <Field label="Nom *" value={form.lastName} onChange={(v) => setForm({ ...form, lastName: v })} />
            <Field label="Email professionnel" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            <Field label="Rôle / fonction" value={form.role} onChange={(v) => setForm({ ...form, role: v })} placeholder="ex. Directeur du site de Lyon" />
          </div>
          {error ? (
            <p className="mt-2 font-body text-[12px] text-rose-600">{error}</p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded-lg px-3 py-1.5 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-100"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-stone-800 px-3 py-1.5 font-body text-[12px] font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              Enregistrer
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-stone-300 px-3 py-1.5 font-body text-[12px] font-semibold text-stone-700 hover:bg-stone-100"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Ajouter un donneur d’ordre
        </button>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-body text-[11px] font-semibold uppercase tracking-wide text-stone-500">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-blue-400"
      />
    </label>
  );
}
