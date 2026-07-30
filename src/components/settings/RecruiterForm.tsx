'use client';

/**
 * Formulaire d'ajout/édition d'un recruteur (sous-composant de
 * RecruitersManager — limite 200 lignes/fichier). L'ajout se fait en
 * CHOISISSANT un compte Supabase Auth dans la liste des comptes non encore
 * référencés (/api/recruiters/available-accounts) — zéro resaisie d'UUID ;
 * l'édition ne touche que nom + lien Cal.com.
 */

import { Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export type RecruiterFormState = {
  id: string;
  displayName: string;
  email: string;
  calcomLink: string;
};

export const EMPTY_RECRUITER_FORM: RecruiterFormState = {
  id: '',
  displayName: '',
  email: '',
  calcomLink: '',
};

type AvailableAccount = { id: string; email: string; createdAt: string };

const INPUT =
  'w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-blue-400';

/** Pré-remplissage du nom affiché depuis l'email (« jane.doe@… » → « Jane Doe »). */
export function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

export function RecruiterForm({
  initial,
  editing,
  onClose,
  onSaved,
}: {
  initial: RecruiterFormState;
  /** true = édition (compte figé), false = ajout (sélecteur de compte). */
  editing: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<RecruiterFormState>(initial);
  const [accounts, setAccounts] = useState<AvailableAccount[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/recruiters/available-accounts', {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { accounts?: AvailableAccount[] };
        if (!cancelled) setAccounts(json.accounts ?? []);
      } catch {
        if (!cancelled) setAccounts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editing]);

  function pickAccount(id: string) {
    const account = accounts?.find((a) => a.id === id) ?? null;
    setForm({
      ...form,
      id,
      email: account?.email ?? '',
      // Pré-rempli depuis l'email, éditable ensuite.
      displayName:
        form.displayName || (account ? displayNameFromEmail(account.email) : ''),
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    const calcomLink = form.calcomLink.trim() || null;
    try {
      const res = editing
        ? await fetch(`/api/recruiters/${encodeURIComponent(form.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              displayName: form.displayName.trim(),
              calcomLink,
            }),
          })
        : await fetch('/api/recruiters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: form.id,
              displayName: form.displayName.trim(),
              email: form.email,
              calcomLink,
            }),
          });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setError(data.message ?? `Échec (HTTP ${res.status}).`);
        return;
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setSaving(false);
    }
  }

  const noAccountLeft = !editing && accounts !== null && accounts.length === 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
      <div className="flex items-center justify-between">
        <p className="font-body text-[12px] font-semibold uppercase tracking-wide text-stone-500">
          {editing ? 'Modifier le recruteur' : 'Ajouter un recruteur'}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-stone-400 hover:bg-stone-200"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {!editing ? (
        noAccountLeft ? (
          <p className="font-body text-[12.5px] text-stone-600">
            Tous les comptes existants sont déjà référencés. Invitez
            d&apos;abord le compte dans Supabase (Authentication → Users →
            Invite user, cf. docs/ops/multi-utilisateur.md §3), puis revenez
            ici : il apparaîtra dans cette liste.
          </p>
        ) : (
          <select
            value={form.id}
            onChange={(e) => pickAccount(e.currentTarget.value)}
            disabled={accounts === null}
            className={INPUT}
          >
            <option value="">
              {accounts === null ? 'Chargement des comptes…' : '— Choisir un compte'}
            </option>
            {(accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </select>
        )
      ) : null}
      <input
        className={INPUT}
        placeholder="Nom affiché"
        value={form.displayName}
        onChange={(e) => setForm({ ...form, displayName: e.currentTarget.value })}
      />
      <input
        className={INPUT}
        placeholder="Lien Cal.com personnel (https://cal.com/…) — vide = agenda global"
        value={form.calcomLink}
        onChange={(e) => setForm({ ...form, calcomLink: e.currentTarget.value })}
      />
      {error ? <p className="font-body text-[12px] text-rose-600">{error}</p> : null}
      <div>
        <button
          type="button"
          onClick={save}
          disabled={saving || (!editing && (!form.id || noAccountLeft))}
          className="inline-flex items-center gap-1.5 rounded-lg bg-stone-800 px-3 py-1.5 font-body text-[12px] font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          Enregistrer
        </button>
      </div>
    </div>
  );
}
