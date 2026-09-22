'use client';

/**
 * LE DÉPART DE L'ÉTAPE « Le poste » : deux entrées CONCURRENTES sur une même
 * ligne, juste sous « De quel poste s'agit-il ? » —
 *
 *   ① rédiger l'intitulé (à gauche) ;
 *   ② démarrer à partir d'un document (à droite) → on en tire un brouillon.
 *
 * Les aides qui DÉPENDENT de l'intitulé n'apparaissent qu'une fois celui-ci
 * saisi, juste en dessous : « Proposer le reste de la fiche », et le bandeau
 * « une campagne comparable existe » quand l'intitulé en rappelle une. Offertes
 * avant, elles parlaient d'un poste qu'on n'avait pas encore nommé.
 *
 * Tout PROPOSE, rien n'impose ; la comparable ne s'applique jamais d'office.
 */
import { useState } from 'react';

import { postFdpProposal } from '@/lib/chat/api-client';
import { markAsSuggested } from '@/lib/campagnes/suggested-criteria';
import { useCampaignsStore } from '@/stores/campaigns-store';
import type { CampaignPrefill } from '@/types/campaign-prefill';
import { computeIsComplete, type FDPInProgress, type FieldKey } from '@/types/field-collection';
import type { ScoringCriterion } from '@/types/scoring';

import { FDPField } from '../edit/FDPInlineEditor';
import { AssistantDocumentStart } from './AssistantDocumentStart';
import { BOUTON, Bandeau, LectureEnCours, champsRenseignes } from './AssistantStartParts';
import { useComparableCampaign } from './useComparableCampaign';

export function AssistantStart({
  campaignId,
  fdp,
  jobTitle,
  onPrefill,
  onFillEmpty,
  onComparable,
  onReset,
  onPatch,
  reading,
  onReadingChange,
  prefilled,
}: {
  campaignId: string;
  onPatch: (key: FieldKey, value: unknown) => void;
  /** Nom du document en cours de lecture, `null` sinon. */
  reading: string | null;
  onReadingChange: (fileName: string | null) => void;
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

  // Plus de recherche une fois une comparable reprise (le bandeau reviendrait).
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
    const grille = archive?.scoringSheet?.criteria;
    onComparable({
      fdp: { ...fdp, fields, isComplete: computeIsComplete(fields) },
      // ⚠️ Repris ≠ acquis. Une grille héritée arrive À CONFIRMER, même si
      // elle était confirmée sur la campagne d'origine : c'était un autre
      // poste, et c'est elle qui décidera qui est écarté sur celui-ci.
      criteria: grille ? markAsSuggested(grille) : undefined,
    });
    setRepris(source.id);
  }

  const titreSaisi = jobTitle.trim().length > 0;

  return (
    <section data-role="poste-start" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        {/* Deux entrées CONCURRENTES, donc de même largeur : aucune n'est la
            voie « normale » dont l'autre serait le détour. */}
        <div style={{ flex: '1 1 0', minWidth: 260 }}>
          <FDPField fdp={fdp} fieldKey="job_title" onPatch={onPatch} disabled={reading !== null} />
        </div>
        <span aria-hidden className="font-body" style={{ fontSize: 12, color: 'var(--dash-text-secondary)', paddingBottom: 11 }}>
          ou
        </span>
        <div style={{ flex: '1 1 0', minWidth: 260 }}>
          <AssistantDocumentStart
            campaignId={campaignId}
            onPrefill={onPrefill}
            onReadingChange={onReadingChange}
            inline
          />
        </div>
      </div>

      {reading ? <LectureEnCours fileName={reading} /> : null}

      {!reading && (titreSaisi || prefilled) ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 12 }}>
          {titreSaisi ? (
            <button
              type="button"
              data-role="propose-fdp"
              disabled={busy}
              onClick={proposerLeReste}
              className="font-body"
              style={{ ...BOUTON, cursor: busy ? 'progress' : 'pointer' }}
            >
              {busy ? 'Rédaction…' : '✨ Proposer le reste de la fiche'}
            </button>
          ) : null}
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
      ) : null}

      {error ? (
        <p role="alert" className="font-body" style={{ marginTop: 8, fontSize: 12, color: 'var(--dash-red)' }}>
          {error}
        </p>
      ) : null}

      {reading ? null : repris ? (
        <Bandeau ton="green">
          Réglages repris de <strong>{repris}</strong>. Modifiez ce qui doit
          l’être — rien n’est encore enregistré.
        </Bandeau>
      ) : comparable && titreSaisi ? (
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
