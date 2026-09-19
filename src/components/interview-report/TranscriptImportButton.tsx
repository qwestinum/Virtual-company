'use client';

/**
 * « Importer une transcription » → compte rendu PROPOSÉ, à vérifier.
 * Spec : docs/specs/compte-rendu-entretien.md §5, §10.2.
 *
 * Le fichier ne quitte le navigateur que pour UN aller-retour : le serveur le
 * lit en mémoire, propose un compte rendu, et ne le conserve pas. S'il y a
 * plusieurs locuteurs, le serveur demande qui est le candidat (422) sans rien
 * avoir envoyé au modèle ni écrit : on renvoie le MÊME fichier, avec le choix.
 */

import { useRef, useState } from 'react';

import type { InterviewReport } from '@/types/interview-report';

type Stats = { kept: number; removedUnproven: number; flagged: number; omittedCount: number };

export const TRANSCRIPT_ACCEPT = '.vtt,.srt,.txt,.docx,.pdf';

export function describeProposal(stats: Stats): string {
  const parts = ['Compte rendu proposé à partir de la transcription — à vérifier avant validation. La transcription n’a pas été conservée.'];
  if (stats.omittedCount > 0) parts.push(`${stats.omittedCount} passage(s) hors cadre professionnel écarté(s).`);
  if (stats.removedUnproven > 0) parts.push(`${stats.removedUnproven} élément(s) retiré(s) : citation introuvable dans la transcription.`);
  if (stats.flagged > 0) parts.push(`${stats.flagged} formulation(s) à vérifier (marquées dans le texte).`);
  return parts.join(' ');
}

export function TranscriptImportButton({
  analysisId,
  disabled = false,
  onCreated,
}: {
  analysisId: string;
  /** Vrai dès que le recruteur a commencé à écrire : l'import ne remplace pas un texte. */
  disabled?: boolean;
  onCreated: (report: InterviewReport, notice: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [speakers, setSpeakers] = useState<string[] | null>(null);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(chosen: File, speaker: string | null) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('file', chosen);
    if (speaker) form.append('candidateSpeaker', speaker);
    try {
      const res = await fetch(
        `/api/candidatures/${encodeURIComponent(analysisId)}/interview-report/transcript`,
        { method: 'POST', body: form },
      );
      const data = (await res.json().catch(() => ({}))) as {
        report?: InterviewReport;
        stats?: Stats;
        speakers?: string[];
        message?: string;
      };
      if (res.ok && data.report && data.stats) {
        setFile(null);
        setSpeakers(null);
        onCreated(data.report, describeProposal(data.stats));
      } else if (res.status === 422 && data.speakers) {
        setFile(chosen);
        setSpeakers(data.speakers);
      } else {
        setError(data.message ?? 'La génération n’a pas abouti. Rien n’a été enregistré. Réimportez la transcription.');
      }
    } catch {
      setError('La génération n’a pas abouti (réseau). Rien n’a été enregistré. Réimportez la transcription.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-[22rem] flex-col items-end gap-1 text-right">
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => input.current?.click()}
        className="rounded-lg border border-sky-700 bg-white px-3 py-1.5 font-body text-[12.5px] font-semibold text-sky-800 hover:bg-sky-50 disabled:opacity-40"
      >
        {busy ? 'Lecture de la transcription… (jusqu’à une minute)' : '⬆ Importer une transcription'}
      </button>
      <input
        ref={input}
        type="file"
        accept={TRANSCRIPT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const chosen = e.target.files?.[0] ?? null;
          e.target.value = '';
          setSpeakers(null);
          setCandidate(null);
          if (chosen) void send(chosen, null);
        }}
      />
      <p className="font-body text-[11px] text-stone-500">
        {disabled && !busy
          ? 'Import possible tant que le compte rendu est vide.'
          : '.vtt .srt .txt .docx .pdf — 2 Mo. Non conservée : elle sert à proposer un compte rendu, que vous vérifiez.'}
      </p>
      {speakers && file ? (
        <fieldset className="flex w-full flex-col items-start gap-1 rounded-lg border border-sky-200 bg-white px-3 py-2 text-left">
          <legend className="px-1 font-body text-[12.5px] font-semibold text-stone-700">Lequel est le candidat ?</legend>
          {speakers.map((s) => (
            <label key={s} className="flex items-center gap-2 font-body text-[12.5px] text-stone-700">
              <input type="radio" name={`speaker-${analysisId}`} checked={candidate === s} onChange={() => setCandidate(s)} />
              {s}
            </label>
          ))}
          <button
            type="button"
            disabled={busy || candidate === null}
            onClick={() => void send(file, candidate)}
            className="mt-1 rounded-lg border border-sky-700 bg-sky-700 px-3 py-1.5 font-body text-[12.5px] font-semibold text-white hover:bg-sky-800 disabled:opacity-40"
          >
            Proposer un compte rendu
          </button>
        </fieldset>
      ) : null}
      {error ? <p role="alert" className="font-body text-[12.5px] text-rose-700">{error}</p> : null}
    </div>
  );
}
