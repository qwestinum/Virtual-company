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
  inline = false,
}: {
  campaignId: string;
  /** Posé dans la rangée du bloc de démarrage : pas de marge propre. */
  inline?: boolean;
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
        onClick={() => input.current?.click()}
        className="font-body"
        style={{
          padding: '7px 14px',
          borderRadius: 8,
          border: '1px dashed var(--dash-border-strong)',
          background: 'var(--dash-surface)',
          color: 'var(--dash-text-secondary)',
          fontSize: 12,
          fontWeight: 600,
          cursor: busy ? 'progress' : 'pointer',
        }}
      >
        {busy
          ? 'Lecture du document…'
          : '📄 Démarrer à partir d’un document (appel d’offres, notes)'}
      </button>
      {error ? (
        <p role="alert" className="font-body" style={{ marginTop: 8, fontSize: 12, color: 'var(--dash-red)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
