'use client';

import {
  CheckCircle2,
  Loader2,
  Mail,
  Pencil,
  Plus,
  TestTube2,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Gestion des boîtes mail IMAP (Session 5 round 5).
 *
 * UI volontairement austère — c'est une page de configuration
 * technique, pas une expérience démo. Le DRH n'y va que pour
 * ajouter/retirer une boîte ; tout le reste se passe dans le chat.
 */

type Mailbox = {
  id: string;
  label: string;
  imap_host: string;
  imap_port: number;
  imap_ssl: boolean;
  user_email: string;
  is_enabled: boolean;
  last_polled_at: string | null;
  last_error: string | null;
  created_at: string;
};

type FormState = {
  label: string;
  imapHost: string;
  imapPort: string;
  imapSsl: boolean;
  userEmail: string;
  password: string;
};

const EMPTY_FORM: FormState = {
  label: '',
  imapHost: '',
  imapPort: '993',
  imapSsl: true,
  userEmail: '',
  password: '',
};

export function MailboxesManager() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    | { ok: true; mailboxName: string; messageCount: number }
    | { ok: false; error: string }
    | null
  >(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function loadMailboxes() {
    setLoading(true);
    try {
      const res = await fetch('/api/mailboxes');
      const data = await res.json();
      setMailboxes((data.mailboxes as Mailbox[]) ?? []);
    } catch (err) {
      console.error('[mailboxes] load failed', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Fetch async sur mount — les setState ne sont déclenchés
    // qu'après `await` (jamais en synchrone), donc le pattern est sûr.
    // La règle react-hooks/set-state-in-effect ne peut pas le prouver
    // statiquement, on l'apaise avec une justification.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMailboxes();
  }, []);

  function openCreateForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setTestResult(null);
    setFormError(null);
    setFormOpen(true);
  }

  function openEditForm(mb: Mailbox) {
    setEditingId(mb.id);
    // Le password ne revient jamais — l'utilisateur le re-saisit s'il
    // veut le changer, sinon on le garde tel quel.
    setForm({
      label: mb.label,
      imapHost: mb.imap_host,
      imapPort: String(mb.imap_port),
      imapSsl: mb.imap_ssl,
      userEmail: mb.user_email,
      password: '',
    });
    setTestResult(null);
    setFormError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setTestResult(null);
    setFormError(null);
  }

  async function testCurrentForm() {
    if (!form.password && editingId) {
      setTestResult({
        ok: false,
        error:
          'Saisis le mot de passe pour tester (il n\'est pas conservé en clair côté serveur).',
      });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/mailboxes/test-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imapHost: form.imapHost,
          imapPort: parseInt(form.imapPort, 10),
          imapSsl: form.imapSsl,
          userEmail: form.userEmail,
          password: form.password,
        }),
      });
      setTestResult(await res.json());
    } catch (err) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  }

  async function saveForm() {
    setSaving(true);
    setFormError(null);
    try {
      const port = parseInt(form.imapPort, 10);
      if (!Number.isFinite(port)) throw new Error('Port invalide');
      const body: Record<string, unknown> = {
        label: form.label,
        imapHost: form.imapHost,
        imapPort: port,
        imapSsl: form.imapSsl,
        userEmail: form.userEmail,
      };
      if (form.password) body.password = form.password;
      const res = await fetch(
        editingId ? `/api/mailboxes/${editingId}` : '/api/mailboxes',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || `HTTP ${res.status}`);
      }
      await loadMailboxes();
      closeForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(mb: Mailbox) {
    await fetch(`/api/mailboxes/${mb.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isEnabled: !mb.is_enabled }),
    });
    await loadMailboxes();
  }

  async function deleteMailbox(mb: Mailbox) {
    if (
      !confirm(
        `Supprimer la boîte "${mb.label}" ? Les associations avec les campagnes seront supprimées aussi.`,
      )
    )
      return;
    await fetch(`/api/mailboxes/${mb.id}`, { method: 'DELETE' });
    await loadMailboxes();
  }

  async function testExisting(mb: Mailbox) {
    const res = await fetch(`/api/mailboxes/${mb.id}/test`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      alert(
        `Connexion OK — INBOX contient ${data.messageCount} message(s).`,
      );
    } else {
      alert(`Échec : ${data.error ?? data.message ?? 'erreur inconnue'}`);
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-stone-900">
          {loading ? 'Chargement…' : `${mailboxes.length} boîte${mailboxes.length > 1 ? 's' : ''} configurée${mailboxes.length > 1 ? 's' : ''}`}
        </h2>
        <button
          type="button"
          onClick={openCreateForm}
          className={cn(
            'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md',
            'bg-stone-900 text-white font-display text-[13px] font-semibold',
            'hover:bg-stone-700 transition-colors shadow-sm',
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          Ajouter une boîte
        </button>
      </div>

      {!loading && mailboxes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white px-6 py-10 text-center">
          <Mail className="h-8 w-8 text-stone-300 mx-auto mb-3" />
          <p className="font-body text-[13px] text-stone-600">
            Aucune boîte configurée. Ajoute une boîte IMAP pour démarrer
            la réception automatique de CVs.
          </p>
        </div>
      ) : null}

      {mailboxes.length > 0 ? (
        <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-stone-50/80 border-b border-stone-200">
              <tr className="font-display text-[10px] uppercase tracking-wider text-stone-500">
                <th className="px-4 py-2.5">Boîte</th>
                <th className="px-4 py-2.5">Serveur</th>
                <th className="px-4 py-2.5">Statut</th>
                <th className="px-4 py-2.5">Dernière collecte</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="font-body text-[13px]">
              {mailboxes.map((mb) => (
                <tr
                  key={mb.id}
                  className="border-b border-stone-100 last:border-b-0"
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold text-stone-900">
                      {mb.label}
                    </div>
                    <div className="text-stone-500 text-[12px]">
                      {mb.user_email}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-stone-700 text-[12px]">
                      {mb.imap_host}:{mb.imap_port}
                    </div>
                    <div className="text-stone-400 text-[11px]">
                      {mb.imap_ssl ? 'SSL' : 'plaintext'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleEnabled(mb)}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-display font-semibold uppercase tracking-wider',
                        mb.is_enabled
                          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'bg-stone-100 text-stone-500 hover:bg-stone-200',
                      )}
                    >
                      {mb.is_enabled ? 'Activée' : 'Désactivée'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-stone-500 text-[12px]">
                    {mb.last_polled_at
                      ? new Date(mb.last_polled_at).toLocaleString('fr-FR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })
                      : 'jamais'}
                    {mb.last_error ? (
                      <div className="text-red-600 text-[11px] mt-0.5">
                        Erreur : {mb.last_error}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <IconButton
                        title="Tester"
                        onClick={() => testExisting(mb)}
                      >
                        <TestTube2 className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        title="Éditer"
                        onClick={() => openEditForm(mb)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        title="Supprimer"
                        onClick={() => deleteMailbox(mb)}
                        danger
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {formOpen ? (
        <div className="fixed inset-0 bg-stone-900/40 grid place-items-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4">
            <h3 className="font-display text-lg font-semibold text-stone-900">
              {editingId ? 'Éditer la boîte' : 'Nouvelle boîte mail'}
            </h3>
            <Field label="Intitulé">
              <input
                type="text"
                value={form.label}
                onChange={(e) =>
                  setForm((f) => ({ ...f, label: e.target.value }))
                }
                className={inputClass}
                placeholder="Recrutement comptable"
              />
            </Field>
            <Field label="Serveur IMAP">
              <div className="grid grid-cols-[1fr_100px] gap-2">
                <input
                  type="text"
                  value={form.imapHost}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, imapHost: e.target.value }))
                  }
                  className={inputClass}
                  placeholder="imap.gmail.com"
                />
                <input
                  type="number"
                  value={form.imapPort}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, imapPort: e.target.value }))
                  }
                  className={inputClass}
                  placeholder="993"
                />
              </div>
            </Field>
            <Field label="SSL/TLS">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.imapSsl}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, imapSsl: e.target.checked }))
                  }
                  className="rounded"
                />
                <span className="font-body text-[13px] text-stone-700">
                  Connexion chiffrée (recommandé)
                </span>
              </label>
            </Field>
            <Field label="Adresse email">
              <input
                type="email"
                value={form.userEmail}
                onChange={(e) =>
                  setForm((f) => ({ ...f, userEmail: e.target.value }))
                }
                className={inputClass}
                placeholder="recrutement@qwestinum.fr"
              />
            </Field>
            <Field
              label={
                editingId
                  ? 'Mot de passe (laisser vide pour conserver)'
                  : 'Mot de passe'
              }
            >
              <input
                type="password"
                value={form.password}
                onChange={(e) =>
                  setForm((f) => ({ ...f, password: e.target.value }))
                }
                className={inputClass}
                placeholder={editingId ? '••••••••' : ''}
              />
              <p className="font-body text-[11px] text-stone-500 mt-1">
                Chiffré AES-256-GCM avant stockage.
              </p>
            </Field>
            {testResult ? (
              <div
                className={cn(
                  'rounded-md px-3 py-2 text-[12px] font-body flex items-start gap-2',
                  testResult.ok
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-red-50 text-red-700',
                )}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                )}
                <span>
                  {testResult.ok
                    ? `Connexion OK — INBOX contient ${testResult.messageCount} message(s).`
                    : `Échec : ${testResult.error}`}
                </span>
              </div>
            ) : null}
            {formError ? (
              <div className="rounded-md bg-red-50 text-red-700 px-3 py-2 text-[12px] font-body">
                {formError}
              </div>
            ) : null}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={testCurrentForm}
                disabled={testing}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md',
                  'border border-stone-300 bg-white text-stone-700',
                  'font-display text-[12px] font-semibold',
                  'hover:bg-stone-50 transition-colors',
                  'disabled:opacity-50',
                )}
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <TestTube2 className="h-3.5 w-3.5" />
                )}
                Tester la connexion
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-3 py-1.5 rounded-md font-display text-[12px] font-semibold text-stone-600 hover:text-stone-900"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={saveForm}
                  disabled={saving}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md',
                    'bg-stone-900 text-white font-display text-[12px] font-semibold',
                    'hover:bg-stone-700 transition-colors shadow-sm',
                    'disabled:opacity-50',
                  )}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {editingId ? 'Enregistrer' : 'Créer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const inputClass = cn(
  'w-full px-3 py-2 rounded-md border border-stone-300 bg-white',
  'font-body text-[13px] text-stone-900 placeholder:text-stone-400',
  'focus:outline-none focus:ring-2 focus:ring-stone-400 focus:border-transparent',
);

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-display text-[11px] uppercase tracking-wider text-stone-600 font-semibold block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function IconButton({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'h-7 w-7 grid place-items-center rounded-md transition-colors',
        danger
          ? 'text-stone-500 hover:bg-red-50 hover:text-red-700'
          : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900',
      )}
    >
      {children}
    </button>
  );
}
