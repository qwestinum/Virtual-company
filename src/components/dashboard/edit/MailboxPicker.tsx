'use client';

/**
 * Picker de mailboxes pour le flux email (Session 6 v3).
 *
 * Affiche la liste des boîtes mail configurées dans
 * `/settings/mailboxes` avec un toggle par boîte. La sélection est
 * tenue par le parent (`selectedIds`), ce composant gère uniquement
 * le rendu + le chargement de la liste.
 *
 * Cas particuliers gérés :
 *   - Aucune mailbox configurée → CTA vers /settings/mailboxes
 *   - Supabase absent → message info
 *   - Aucune mailbox sélectionnée → bannière d'avertissement (le flux
 *     email ne sert à rien sans boîte associée)
 */

import { useEffect, useState } from 'react';

export type MailboxOption = {
  id: string;
  label: string;
  user_email: string;
  is_enabled: boolean;
};

export type MailboxPickerProps = {
  selectedIds: string[];
  onChange: (next: string[]) => void;
};

export function MailboxPicker({ selectedIds, onChange }: MailboxPickerProps) {
  const [mailboxes, setMailboxes] = useState<MailboxOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/mailboxes', { cache: 'no-store' });
        if (res.status === 503) {
          if (!cancelled) {
            setMailboxes([]);
            setError('offline');
          }
          return;
        }
        if (!res.ok) {
          if (!cancelled) setError(`HTTP ${res.status}`);
          return;
        }
        const json = (await res.json()) as { mailboxes?: MailboxOption[] };
        if (!cancelled) setMailboxes(json.mailboxes ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'fetch_failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (mailboxes == null && error == null) {
    return (
      <div
        className="font-body"
        style={{
          padding: '10px 14px',
          fontSize: 12,
          color: 'var(--dash-text-tertiary)',
          background: 'var(--dash-warm)',
          borderRadius: 8,
        }}
      >
        Chargement des boîtes mail…
      </div>
    );
  }

  if (error === 'offline' || (mailboxes && mailboxes.length === 0)) {
    return (
      <div
        style={{
          padding: '12px 14px',
          borderRadius: 10,
          background: 'var(--dash-yellow-light)',
          border: '1px solid var(--dash-yellow)',
          color: 'var(--dash-yellow)',
          fontSize: 12,
          lineHeight: 1.5,
        }}
        className="font-body"
      >
        <strong style={{ fontWeight: 700 }}>
          Aucune boîte mail configurée.
        </strong>{' '}
        Le flux email exige au moins une boîte. Configurez-en une depuis{' '}
        <a
          href="/settings/mailboxes"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--dash-yellow)', textDecoration: 'underline' }}
        >
          Paramètres → Boîtes mail
        </a>
        , puis revenez ici.
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="font-body"
        style={{
          padding: '10px 14px',
          fontSize: 12,
          color: 'var(--dash-red)',
          background: 'var(--dash-red-light)',
          borderRadius: 8,
        }}
      >
        Impossible de charger les boîtes mail ({error}).
      </div>
    );
  }

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const noneSelected = selectedIds.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {noneSelected ? (
        <div
          className="font-body"
          style={{
            padding: '10px 14px',
            fontSize: 12,
            color: 'var(--dash-red)',
            background: 'var(--dash-red-light)',
            borderRadius: 8,
            border: '1px solid var(--dash-red)',
            lineHeight: 1.5,
          }}
        >
          <strong style={{ fontWeight: 700 }}>
            Sélectionnez au moins une boîte mail.
          </strong>{' '}
          Le flux email n&apos;écoutera aucun canal d&apos;arrivée sans
          association.
        </div>
      ) : null}
      {(mailboxes ?? []).map((mb) => {
        const checked = selectedIds.includes(mb.id);
        return (
          <button
            key={mb.id}
            type="button"
            onClick={() => toggle(mb.id)}
            aria-pressed={checked}
            className="font-body"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              borderRadius: 10,
              border: `1px solid ${checked ? 'var(--dash-blue)' : 'var(--dash-border)'}`,
              background: checked
                ? 'var(--dash-blue-light)'
                : 'var(--dash-warm)',
              color: 'var(--dash-text)',
              fontSize: 13,
              cursor: 'pointer',
              textAlign: 'left',
              opacity: mb.is_enabled ? 1 : 0.6,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                border: `2px solid ${checked ? 'var(--dash-blue)' : 'var(--dash-border-strong)'}`,
                background: checked ? 'var(--dash-blue)' : 'transparent',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 11,
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {checked ? '✓' : ''}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 700 }}>
                {mb.label}
                {!mb.is_enabled ? (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 10,
                      color: 'var(--dash-text-tertiary)',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    désactivée
                  </span>
                ) : null}
              </span>
              <span
                className="font-data"
                style={{ fontSize: 11, color: 'var(--dash-text-secondary)' }}
              >
                {mb.user_email}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
