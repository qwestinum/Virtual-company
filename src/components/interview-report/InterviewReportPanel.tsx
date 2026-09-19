'use client';

/**
 * Compte rendu d'entretien d'une candidature — FACULTATIF.
 * Spec : docs/specs/compte-rendu-entretien.md §3, §5.7, §15.
 *
 * Un brouillon n'apparaît dans AUCUN lecteur (frise, PDF d'audit) : seul un
 * compte rendu validé fait partie du dossier, avec sa mention. Un compte rendu
 * validé se modifie en étant validé de nouveau — il ne redevient pas
 * brouillon, il ne disparaît donc jamais du dossier en silence.
 *
 * `renderStartActions` : les autres façons de commencer un compte rendu
 * (import de transcription, lot 4), à côté de « Rédiger ». Elles reçoivent
 * `onCreated` : le brouillon est créé CÔTÉ SERVEUR (c'est le serveur, jamais le
 * client, qui peut dire « établi à partir d'une transcription ») et le panneau
 * l'ouvre dans l'éditeur.
 */

import { useState } from 'react';

import {
  emptySections,
  type InterviewReport,
  type InterviewReportSections,
} from '@/types/interview-report';

import { InterviewReportEditor } from './InterviewReportEditor';
import { InterviewReportReadOnly } from './InterviewReportReadOnly';
import { useInterviewReport } from './useInterviewReport';

export function InterviewReportPanel({
  analysisId,
  renderStartActions,
}: {
  analysisId: string;
  renderStartActions?: (onCreated: (report: InterviewReport) => void) => React.ReactNode;
}) {
  const { view, error, save, setView } = useInterviewReport(analysisId);
  const [draft, setDraft] = useState<InterviewReportSections | null>(null);
  const [busy, setBusy] = useState(false);
  const onCreated = (report: InterviewReport) => {
    setView((v) => (v ? { ...v, report } : v));
    setDraft(report.sections);
  };

  if (!view) {
    return <p className="font-body text-[12px] text-stone-400">Chargement du compte rendu…</p>;
  }
  const { report, criteria, writable } = view;
  if (!report && !writable) return null;

  async function submit(action: 'draft' | 'verify') {
    if (!draft) return;
    setBusy(true);
    const saved = await save(draft, action);
    setBusy(false);
    if (saved) setDraft(null);
  }

  const verified = report?.status === 'verified';
  return (
    <section className="flex flex-col gap-2">
      <p className="font-body text-[12.5px] font-semibold text-stone-700">
        Compte rendu d’entretien <span className="font-normal text-stone-500">(facultatif)</span>
      </p>

      {draft ? (
        <>
          <InterviewReportEditor
            sections={draft}
            source={report?.source ?? 'manual'}
            disabled={busy}
            onChange={setDraft}
          />
          {error ? <p role="alert" className="font-body text-[12.5px] text-rose-700">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button primary disabled={busy} onClick={() => void submit('verify')}>
              {verified ? 'Valider les modifications' : 'Valider le compte rendu'}
            </Button>
            {!verified ? (
              <Button disabled={busy} onClick={() => void submit('draft')}>
                Enregistrer le brouillon
              </Button>
            ) : null}
            <Button disabled={busy} onClick={() => setDraft(null)}>Annuler</Button>
          </div>
        </>
      ) : report ? (
        <>
          {verified ? (
            <InterviewReportReadOnly report={report} />
          ) : (
            <p className="font-body text-[12px] italic text-stone-500">
              Brouillon enregistré — il n’apparaît pas au dossier tant qu’il n’est pas validé.
            </p>
          )}
          <div>
            <Button onClick={() => setDraft(report.sections)}>
              {verified ? 'Modifier' : 'Reprendre le brouillon'}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDraft(emptySections(criteria))}>Rédiger</Button>
          {renderStartActions?.(onCreated)}
        </div>
      )}
    </section>
  );
}

function Button({
  primary = false,
  disabled = false,
  onClick,
  children,
}: {
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 font-body text-[12.5px] font-semibold transition disabled:opacity-40 ${
        primary
          ? 'border-stone-800 bg-stone-800 text-white hover:bg-stone-700'
          : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
      }`}
    >
      {children}
    </button>
  );
}
