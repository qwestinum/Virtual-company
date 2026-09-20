'use client';

/**
 * Le geste qui répare les candidatures bloquées — un bouton, une fournée.
 *
 * ⚠️ Il ÉCRIT, il ne navigue pas. Demander d'ouvrir douze dossiers pour y
 * cliquer douze fois le même bouton, c'est présenter une liste comme une
 * réparation.
 *
 * Il porte le style SECONDAIRE du produit, comme toutes les actions de ligne :
 * l'écran n'a qu'un seul bouton principal, « + Nouvelle campagne ».
 *
 * Le serveur recalcule les cibles : ce bouton n'en envoie aucune. Il ne peut
 * donc pas réparer ce que l'écran avait en mémoire plutôt que ce qui est vrai.
 *
 * Aucun envoi de mail n'en découle — remettre en file, c'est demander un clic
 * humain, exactement le contraire d'envoyer.
 */

import { useState } from 'react';

import { ActionButton } from '@/components/campagnes/ActionButton';

type Etat = 'prêt' | 'en cours' | 'fait' | 'échec';

export function RequeueOrphansButton({
  label,
  onDone,
}: {
  label: string;
  /** Rechargement du tableau : les compteurs doivent retomber tout de suite. */
  onDone: () => void;
}) {
  const [etat, setEtat] = useState<Etat>('prêt');
  const [bilan, setBilan] = useState<string | null>(null);

  const reparer = async (): Promise<void> => {
    setEtat('en cours');
    setBilan(null);
    try {
      const res = await fetch('/api/validations/requeue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) {
        setEtat('échec');
        setBilan('La remise en attente n’a pas abouti. Rien n’a été modifié.');
        return;
      }
      const json = (await res.json()) as {
        requeued?: number;
        alreadyQueued?: number;
        failed?: number;
      };
      const remises = (json.requeued ?? 0) + (json.alreadyQueued ?? 0);
      const restes = json.failed ?? 0;
      setEtat('fait');
      // On DIT ce qui reste : annoncer « c'est réparé » quand deux dossiers
      // ont résisté ferait chercher longtemps pourquoi le compteur ne bouge pas.
      setBilan(
        restes > 0
          ? `${remises} remise${remises > 1 ? 's' : ''} en attente de décision · ${restes} n’${restes > 1 ? 'ont' : 'a'} pas pu l’être`
          : `${remises} remise${remises > 1 ? 's' : ''} en attente de décision.`,
      );
      onDone();
    } catch {
      setEtat('échec');
      setBilan('La remise en attente n’a pas abouti. Rien n’a été modifié.');
    }
  };

  if (etat === 'fait' || etat === 'échec') {
    return (
      <span
        className="font-body"
        style={{
          fontSize: 12,
          color: etat === 'échec' ? 'var(--dash-red)' : 'var(--dash-text-secondary)',
        }}
      >
        {bilan}
      </span>
    );
  }

  return (
    <ActionButton
      variant="neutral"
      label={etat === 'en cours' ? 'Remise en cours…' : label}
      onClick={() => void reparer()}
      disabled={etat === 'en cours'}
    />
  );
}
