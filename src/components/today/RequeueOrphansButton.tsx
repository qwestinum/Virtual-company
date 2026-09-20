'use client';

/**
 * Le geste qui répare les candidatures bloquées — un bouton, une fournée.
 *
 * ⚠️ Il ÉCRIT, il ne navigue pas : c'est pour ça qu'il ne ressemble pas à un
 * lien. Demander d'ouvrir douze dossiers pour y cliquer douze fois le même
 * bouton, c'est présenter une liste comme une réparation.
 *
 * Le serveur recalcule les cibles : ce bouton n'en envoie aucune. Il ne peut
 * donc pas réparer ce que l'écran avait en mémoire plutôt que ce qui est vrai.
 *
 * Aucun envoi de mail n'en découle — remettre en file, c'est demander un clic
 * humain, exactement le contraire d'envoyer.
 */

import { useState } from 'react';

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
    <button
      type="button"
      onClick={() => void reparer()}
      disabled={etat === 'en cours'}
      className="font-display inline-flex items-center"
      style={{
        padding: '6px 14px',
        borderRadius: 999,
        border: 'none',
        background:
          etat === 'en cours'
            ? 'var(--dash-hover)'
            : 'linear-gradient(135deg, var(--dash-blue), var(--dash-purple))',
        color: etat === 'en cours' ? 'var(--dash-text-secondary)' : '#fff',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.02em',
        cursor: etat === 'en cours' ? 'not-allowed' : 'pointer',
        boxShadow: etat === 'en cours' ? undefined : '0 2px 10px rgba(47,110,235,0.3)',
        whiteSpace: 'nowrap',
      }}
    >
      {etat === 'en cours' ? 'Remise en cours…' : label}
    </button>
  );
}
