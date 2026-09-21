'use client';

/**
 * LES TROIS FAÇONS DE NE PAS PARTIR D'UNE PAGE BLANCHE, réunies en tête de la
 * première étape — parce qu'elles changent TOUT l'écran, et qu'offertes après
 * huit champs elles arrivent trop tard.
 *
 *   ① un document (appel d'offres, notes) → on en tire un brouillon ;
 *   ② une campagne COMPARABLE déjà passée → on reprend ses réglages ;
 *   ③ l'intitulé seul → le modèle propose le reste de la fiche.
 *
 * Les trois PROPOSENT, aucune n'impose : rien n'est enregistré ici, et tout
 * reste modifiable. La (②) ne s'applique plus d'office comme dans l'ancienne
 * feuille — un écran qui se remplit tout seul fait douter de ce qu'on vient de
 * taper.
 */

import { useState } from 'react';

import { postFdpProposal } from '@/lib/chat/api-client';
import { useCampaignsStore } from '@/stores/campaigns-store';
import type { CampaignPrefill } from '@/types/campaign-prefill';
import { computeIsComplete, type FDPInProgress, type FieldKey } from '@/types/field-collection';
import type { ScoringCriterion } from '@/types/scoring';

import { AssistantDocumentStart } from './AssistantDocumentStart';
import { BOUTON, Bandeau, champsRenseignes } from './AssistantStartParts';
import { useComparableCampaign } from './useComparableCampaign';

export function AssistantStart({
  campaignId,
  fdp,
  jobTitle,
  onPrefill,
  onFillEmpty,
  onComparable,
  onReset,
  prefilled,
}: {
  campaignId: string;
  fdp: FDPInProgress;
  jobTitle: string;
  onPrefill: (input: {
    fdp: FDPInProgress;
    criteria: ScoringCriterion[];
    extraction: CampaignPrefill;
  }) => void;
  onFillEmpty: (fields: Partial<Record<FieldKey, unknown>>) => void;
  onComparable: (input: { fdp: FDPInProgress; criteria?: ScoringCriterion[] }) => void;
  onReset: () => void;
  /** Le brouillon a-t-il DÉJÀ été rempli par une aide ? (bouton de sortie) */
  prefilled: boolean;
}) {
  const getCampaign = useCampaignsStore((s) => s.getById);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repris, setRepris] = useState<string | null>(null);

  // On ne cherche plus une comparable une fois qu'on en a repris une : le
  // bandeau réapparaîtrait sur la fiche qu'il vient de poser.
  const comparable = useComparableCampaign(jobTitle, repris === null);

  async function proposerLeReste() {
    const titre = jobTitle.trim();
    if (!titre) return;
    setBusy(true);
    setError(null);
    try {
      const { fields } = await postFdpProposal({ jobTitle: titre, known: champsRenseignes(fdp) });
      onFillEmpty(fields as Partial<Record<FieldKey, unknown>>);
    } catch {
      setError(
        'La proposition n’est pas disponible pour le moment. Vous pouvez remplir les champs à la main.',
      );
    } finally {
      setBusy(false);
    }
  }

  function reprendre() {
    if (!comparable) return;
    const source = comparable.source;
    // L'intitulé SAISI prime sur celui de l'archive : c'est le poste qu'on
    // recrute aujourd'hui, pas celui d'il y a six mois.
    const fields = { ...fdp.fields };
    for (const key of Object.keys(source.fdp.fields) as FieldKey[]) {
      const entrant = source.fdp.fields[key];
      if (!entrant || key === 'job_title') continue;
      fields[key] = {
        ...fields[key]!,
        value: entrant.value,
        status: entrant.value != null ? ('filled' as const) : ('empty' as const),
      };
    }
    const archive = getCampaign(source.id);
    onComparable({
      fdp: { ...fdp, fields, isComplete: computeIsComplete(fields) },
      criteria: archive?.scoringSheet?.criteria,
    });
    setRepris(source.id);
  }

  return (
    <section
      style={{
        border: '1px solid var(--dash-border)',
        borderRadius: 12,
        padding: '14px 16px',
        background: 'var(--dash-warm)',
        marginBottom: 20,
      }}
    >
      <h3
        className="font-display"
        style={{ fontSize: 13, fontWeight: 700, color: 'var(--dash-text)', margin: 0 }}
      >
        Ne partez pas d’une page blanche
      </h3>
      <p
        className="font-body"
        style={{ fontSize: 12, color: 'var(--dash-text-secondary)', margin: '3px 0 10px' }}
      >
        Trois raccourcis. Chacun propose, aucun n’impose — tout reste modifiable.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <AssistantDocumentStart campaignId={campaignId} onPrefill={onPrefill} inline />
        <button
          type="button"
          data-role="propose-fdp"
          disabled={busy || jobTitle.trim().length === 0}
          onClick={proposerLeReste}
          className="font-body"
          title={
            jobTitle.trim().length === 0
              ? 'Saisissez d’abord l’intitulé du poste.'
              : undefined
          }
          style={{
            ...BOUTON,
            cursor: busy ? 'progress' : jobTitle.trim() ? 'pointer' : 'not-allowed',
            opacity: jobTitle.trim() ? 1 : 0.5,
          }}
        >
          {busy ? 'Rédaction…' : '✨ Proposer le reste de la fiche'}
        </button>
        {prefilled ? (
          <button
            type="button"
            data-role="reset-draft"
            onClick={() => {
              setRepris(null);
              onReset();
            }}
            className="font-body"
            style={{ ...BOUTON, border: 'none', textDecoration: 'underline' }}
          >
            Repartir à zéro
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="font-body" style={{ marginTop: 8, fontSize: 12, color: 'var(--dash-red)' }}>
          {error}
        </p>
      ) : null}

      {repris ? (
        <Bandeau ton="green">
          Réglages repris de <strong>{repris}</strong>. Modifiez ce qui doit
          l’être — rien n’est encore enregistré.
        </Bandeau>
      ) : comparable ? (
        <Bandeau ton="blue">
          <strong>Une campagne comparable existe</strong> : {comparable.source.id} — «{' '}
          {comparable.source.title} ». Reprendre sa fiche et sa grille vous évitera
          de tout ressaisir.
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              data-role="reprendre-comparable"
              onClick={reprendre}
              className="font-body"
              style={{ ...BOUTON, borderStyle: 'solid', borderColor: 'var(--dash-blue)', color: 'var(--dash-blue)' }}
            >
              Reprendre ses réglages
            </button>
          </div>
        </Bandeau>
      ) : null}
    </section>
  );
}
