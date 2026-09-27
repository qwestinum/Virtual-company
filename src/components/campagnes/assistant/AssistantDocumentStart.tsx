'use client';

/**
 * « Démarrer à partir d'un document » — l'entrée qui existait dans la création
 * historique, PORTÉE ici telle quelle. La retirer sans un mot ne l'aurait pas
 * déplacée, elle l'aurait supprimée.
 *
 * On LIT un document (appel d'offres, notes) — distinct du Job Writer, qui
 * GÉNÈRE — et on en tire un BROUILLON que l'humain relit. **Aucune persistance
 * ici** : ce que le modèle propose s'affiche dans les champs, et c'est le
 * passage à l'étape suivante qui enregistre, comme pour une saisie à la main.
 *
 * Les pondérations arrivent marquées « suggéré par l'IA » : elles devront être
 * confirmées ou écartées à l'étape « Ce qui compte » — le modèle n'impose
 * jamais un barème.
 */

import { Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  prefillToFDP,
  prefillToSuggestedCriteria,
  type CampaignPrefill,
} from '@/types/campaign-prefill';
import type { ScoringCriterion } from '@/types/scoring';
import type { FDPInProgress } from '@/types/field-collection';

export function AssistantDocumentStart({
  campaignId,
  onPrefill,
  onReadingChange,
  inline = false,
}: {
  campaignId: string;
  /** Posé dans la rangée du bloc de démarrage : pas de marge propre. */
  inline?: boolean;
  /**
   * Nom du fichier en cours de lecture, `null` à la fin. L'appelant s'en sert
   * pour DIRE que l'opération tourne et geler ce qu'elle va remplir — une
   * lecture dure plusieurs dizaines de secondes, et un écran immobile pendant
   * ce temps fait cliquer partout.
   */
  onReadingChange?: (fileName: string | null) => void;
  onPrefill: (input: {
    fdp: FDPInProgress;
    criteria: ScoringCriterion[];
    extraction: CampaignPrefill;
  }) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lire(file: File) {
    setBusy(true);
    onReadingChange?.(file.name);
    setError(null);
    try {
      const form = new FormData();
      form.append('document', file);
      const res = await fetch('/api/campaigns/prefill', { method: 'POST', body: form });
      const json = (await res.json()) as {
        prefill?: CampaignPrefill;
        message?: string;
      };
      if (!res.ok || !json.prefill) {
        setError(
          json.message ??
            'Le document n’a pas pu être lu. Réessayez, ou saisissez la campagne à la main.',
        );
        return;
      }
      const suggested = prefillToSuggestedCriteria(json.prefill);
      onPrefill({
        fdp: prefillToFDP(json.prefill, campaignId),
        criteria: suggested,
        extraction: json.prefill,
      });
    } catch {
      setError('Le document n’a pas pu être lu (réseau). Réessayez.');
    } finally {
      setBusy(false);
      onReadingChange?.(null);
    }
  }

  return (
    <div style={{ marginTop: inline ? 0 : 16 }}>
      <input
        ref={input}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) void lire(f);
        }}
      />
      <button
        type="button"
        data-role="document"
        disabled={busy}
        aria-busy={busy}
        onClick={() => input.current?.click()}
        className="font-body"
        // Mis en EXERGUE (teinte indigo, filet pointillé de dépôt) : c'est le
        // raccourci qui remplit toute la fiche d'un coup, et un bouton gris à
        // côté d'un champ blanc passait pour une option secondaire. Même
        // hauteur que le champ voisin (40 px), pleine largeur de sa colonne.
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          width: inline ? '100%' : undefined,
          minHeight: 40,
          padding: '8px 14px',
          borderRadius: 8,
          border: '1.5px dashed var(--dash-indigo)',
          background: 'var(--dash-indigo-light)',
          color: 'var(--dash-indigo-text)',
          fontSize: 13,
          fontWeight: 700,
          cursor: busy ? 'progress' : 'pointer',
        }}
      >
        {busy ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Lecture en cours…
          </>
        ) : (
          '📄 Démarrer à partir d’un document (appel d’offres, notes)'
        )}
      </button>
      {error ? (
        <p role="alert" className="font-body" style={{ marginTop: 8, fontSize: 12, color: 'var(--dash-red)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
