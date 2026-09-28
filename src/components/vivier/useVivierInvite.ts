'use client';

/**
 * « Inviter » un profil du vivier depuis l'écran de la campagne — PARTAGÉ par
 * la liste des profils proposés et par les résultats de la recherche par
 * mot-clé : le même geste, le même message, où que soit le profil.
 */

import { useState } from 'react';

import { vivierInviteNotice, type VivierInviteMailStatus } from '@/lib/vivier/invite-notice';

export type VivierNotice = { tone: 'ok' | 'warn' | 'error'; text: string };

/** Ce qu'on montre et ce qu'on invite : un profil, d'où qu'il vienne. */
export type VivierTarget = {
  candidateId: string;
  nom: string;
  /** Sous le nom : l'adresse, ou le titre quand la recherche ne rend pas d'adresse. */
  subtitle: string;
  /** Pourquoi il est là (présélection, mot-clé trouvé) — dans l'aperçu. */
  lines: string[];
  /** Trouvé par mot-clé : il entre dans les propositions au moment d'inviter. */
  matchTerm?: string;
  /** Écarter : pas pour cette campagne, rien n'est envoyé. */
  canReject: boolean;
};

export function useVivierInvite(
  campaignId: string,
  onNotice: (n: VivierNotice | null) => void,
  onDone: () => void,
) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function invite(target: VivierTarget): Promise<boolean> {
    // Désarmé dès le clic : un second clic n'enverrait rien (verrous), mais
    // relancerait une analyse pour rien.
    if (busyId) return false;
    setBusyId(target.candidateId);
    onNotice(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/vivier-preselection/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: target.candidateId, matchTerm: target.matchTerm }),
      });
      const data = (await res.json().catch(() => ({}))) as { mail?: VivierInviteMailStatus; message?: string };
      if (!res.ok || !data.mail) {
        onNotice({ tone: 'error', text: data.message ?? 'L’invitation n’a pas abouti.' });
        return false;
      }
      onNotice(vivierInviteNotice(target.nom, data.mail));
      onDone();
      return true;
    } catch {
      onNotice({ tone: 'error', text: 'L’invitation n’a pas abouti (réseau). Réessayer n’enverra jamais un second message.' });
      return false;
    } finally {
      setBusyId(null);
    }
  }

  return { busyId, invite };
}
