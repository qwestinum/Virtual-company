'use client';

/**
 * Briques d'affichage de l'étape post-création (`CampaignCreatedStep`).
 *
 * Sorties du fichier de l'étape pour la même raison qu'ailleurs : un écran qui
 * dit six choses différentes ne doit pas se lire comme un mur de styles. Aucune
 * logique ici — les décisions (verrou d'activation, régime de réservation)
 * restent dans l'étape.
 */

import type { ReactNode } from 'react';

import { formatMissingPhases } from '@/lib/campaign/phase-labels';
import type { PhaseId } from '@/types/campaign-lifecycle';

export function Notice({
  tone,
  alert,
  children,
}: {
  tone: 'red' | 'yellow';
  alert?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role={alert ? 'alert' : undefined}
      className="font-body"
      style={{
        padding: '12px 14px',
        borderRadius: 10,
        background: `var(--dash-${tone}-light)`,
        border: `1px solid var(--dash-${tone})`,
        fontSize: 12,
        lineHeight: 1.5,
        color: 'var(--dash-text-secondary)',
      }}
    >
      {children}
    </div>
  );
}

export function PrimaryButton({
  label,
  onClick,
  tone,
}: {
  label: string;
  onClick: () => void;
  tone: 'green' | 'blue';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-display"
      style={{
        padding: '9px 18px',
        borderRadius: 8,
        border: 'none',
        background:
          tone === 'green'
            ? 'var(--dash-green)'
            : 'linear-gradient(135deg, var(--dash-blue), var(--dash-purple))',
        color: '#fff',
        fontSize: 13,
        fontWeight: 700,
        cursor: 'pointer',
        boxShadow:
          tone === 'green'
            ? '0 2px 10px rgba(21,163,100,0.3)'
            : '0 2px 10px rgba(47,110,235,0.3)',
      }}
    >
      {label}
    </button>
  );
}

export function GhostButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-body"
      style={{
        padding: '9px 16px',
        borderRadius: 8,
        border: '1px solid var(--dash-border)',
        background: 'var(--dash-surface)',
        color: 'var(--dash-text-secondary)',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

/** Ce qui manque pour activer — phases obligatoires et pondérations à traiter. */
export function ActivationGateNotice({
  missing,
  untreatedSuggestions,
}: {
  missing: readonly PhaseId[];
  untreatedSuggestions: number;
}) {
  const parts = [
    missing.length > 0 ? formatMissingPhases(missing) : null,
    untreatedSuggestions > 0
      ? `${untreatedSuggestions} pondération${untreatedSuggestions > 1 ? 's' : ''} suggérée${untreatedSuggestions > 1 ? 's' : ''} par l’IA`
      : null,
  ].filter(Boolean);
  return (
    <Notice tone="yellow">
      Pour activer cette campagne, il reste à traiter :{' '}
      <strong style={{ color: 'var(--dash-text)' }}>{parts.join(' et ')}</strong>
      . Vous pouvez la garder en brouillon et la compléter plus tard.
    </Notice>
  );
}

export function MailboxFailureNotice({ count }: { count: number }) {
  return (
    <Notice tone="red">
      ⚠️{' '}
      <strong style={{ color: 'var(--dash-red)' }}>
        {count === 1
          ? 'Une boîte mail n’a pas pu être rattachée'
          : `${count} boîtes mail n’ont pas pu être rattachées`}
      </strong>
      . La campagne est bien enregistrée, mais le flux email ne recevra aucun CV
      tant que le rattachement n’est pas refait — depuis le bloc{' '}
      <strong style={{ color: 'var(--dash-text)' }}>Flux de réception</strong> de
      l’édition.
    </Notice>
  );
}
