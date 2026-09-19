'use client';

/**
 * Zone « Compte rendu d'entretien » — FACULTATIVE, OUVERTE D'EMBLÉE.
 * Spec : docs/specs/compte-rendu-entretien.md §3, §5.7, §15, §17, §18.
 *
 * On arrive devant UN champ prêt à écrire, pas devant un bouton
 * « Rédiger » : rédiger ou importer se décide en écrivant — ou en cliquant
 * « Importer une transcription », en bas à droite de la zone. L'import n'est
 * offert que tant que rien n'est écrit : une proposition ne remplace jamais un
 * texte en cours.
 *
 * Un brouillon n'apparaît dans AUCUN lecteur (frise, PDF d'audit) : seul un
 * compte rendu validé fait partie du dossier, avec sa mention. Un compte rendu
 * validé se modifie en étant validé de nouveau — il ne redevient pas
 * brouillon, il ne disparaît donc jamais du dossier en silence.
 */

import { useState } from 'react';

import { ZoneCard } from '@/components/verdict/ZoneCard';
import {
  emptySections,
  hasReportContent,
  type InterviewReport,
  type InterviewReportSections,
} from '@/types/interview-report';

import { InterviewReportEditor } from './InterviewReportEditor';
import { InterviewReportReadOnly } from './InterviewReportReadOnly';
import { TranscriptImportButton } from './TranscriptImportButton';
import { useInterviewReport } from './useInterviewReport';

export function InterviewReportPanel({
  analysisId,
  step,
}: {
  analysisId: string;
  /** Numéro d'étape dans le bloc de décision (absent hors de ce bloc). */
  step?: number;
}) {
  const { view, error, save, setView } = useInterviewReport(analysisId);
  const [draft, setDraft] = useState<InterviewReportSections | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!view) {
    return <p className="font-body text-[12px] text-stone-400">Chargement du compte rendu…</p>;
  }
  const { report, criteria, writable } = view;
  if (!report && !writable) return null;

  // Ce qui est dans l'éditeur : la saisie en cours, sinon un champ vide
  // (aucun compte rendu), sinon le brouillon enregistré. Un compte rendu
  // VALIDÉ s'affiche en lecture tant qu'on ne clique pas « Modifier ».
  const editing =
    draft ?? (report === null ? emptySections() : report.status === 'draft' ? report.sections : null);
  const verified = report?.status === 'verified';
  const canImport = view.transcriptImportEnabled && report === null;

  const onCreated = (created: InterviewReport, message: string) => {
    setView((v) => (v ? { ...v, report: created } : v));
    setNotice(message);
    setDraft(created.sections);
  };

  async function submit(action: 'draft' | 'verify') {
    if (!editing) return;
    setBusy(true);
    const saved = await save(editing, action);
    setBusy(false);
    if (saved) {
      setDraft(null);
      setNotice(null);
    }
  }

  const hint =
    report === null
      ? view.transcriptImportEnabled
        ? 'Rédigez directement ci-dessous, ou importez la transcription de l’entretien (bouton en bas à droite).'
        : 'Rédigez directement ci-dessous.'
      : report.status === 'draft'
        ? 'Brouillon enregistré — il n’apparaît pas au dossier tant qu’il n’est pas validé.'
        : undefined;

  return (
    <ZoneCard tone="report" step={step} title="Compte rendu d’entretien" hint={hint}>
      {editing ? (
        <>
          {notice ? (
            <p className="rounded-lg border border-sky-300 bg-white px-3 py-2 font-body text-[12px] text-sky-900">
              {notice}
            </p>
          ) : null}
          <InterviewReportEditor
            sections={editing}
            criteria={criteria}
            disabled={busy}
            onChange={setDraft}
          />
          {error ? <p role="alert" className="font-body text-[12.5px] text-rose-700">{error}</p> : null}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Button primary disabled={busy} onClick={() => void submit('verify')}>
                {verified ? 'Valider les modifications' : 'Valider le compte rendu'}
              </Button>
              {!verified ? (
                <Button disabled={busy} onClick={() => void submit('draft')}>
                  Enregistrer le brouillon
                </Button>
              ) : (
                <Button disabled={busy} onClick={() => setDraft(null)}>Annuler</Button>
              )}
            </div>
            {canImport ? (
              <TranscriptImportButton
                analysisId={analysisId}
                disabled={busy || hasReportContent(editing)}
                onCreated={onCreated}
              />
            ) : null}
          </div>
        </>
      ) : report ? (
        <>
          <InterviewReportReadOnly report={report} />
          <div>
            <Button onClick={() => setDraft(report.sections)}>Modifier</Button>
          </div>
        </>
      ) : null}
    </ZoneCard>
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
          ? 'border-sky-700 bg-sky-700 text-white hover:bg-sky-800'
          : 'border-sky-300 bg-white text-sky-900 hover:bg-sky-50'
      }`}
    >
      {children}
    </button>
  );
}
