'use client';

/**
 * Agenda des entretiens : lien d'agenda externe (org-level). Brouillon local,
 * sauvegarde explicite.
 *
 * Ce composant ne porte plus que l'agenda : les textes des messages sont dans
 * « Modèles de messages », le nom du cabinet et le signataire dans « Identité
 * du cabinet » (02/10/2026). Tous partagent pourtant le même réglage
 * (`interviewConfig`) — d'où la règle : ce composant ne rend que SES champs,
 * et l'appelant les fusionne dans la configuration COURANTE. Rendre l'objet
 * entier, tel qu'il était au montage, écraserait ce qu'une autre section a
 * enregistré entre-temps.
 */

import { useState } from 'react';

import { AgendaLinkField } from '@/components/settings/AgendaLinkField';

import type { InterviewConfig } from '@/types/interview-settings';

export type InterviewAgendaFields = Pick<InterviewConfig, 'agendaLink'>;

export function pickInterviewAgendaFields(c: InterviewConfig): InterviewAgendaFields {
  return { agendaLink: c.agendaLink };
}

export function InterviewConfigManager({
  config,
  onSave,
}: {
  config: InterviewConfig;
  onSave: (fields: InterviewAgendaFields) => void;
}) {
  const [agendaLink, setAgendaLink] = useState(config.agendaLink);
  const dirty = agendaLink !== config.agendaLink;

  return (
    <div className="flex flex-col gap-4 font-body text-[13px]">
      <AgendaLinkField value={agendaLink} onChange={setAgendaLink} />
      <button
        type="button"
        onClick={() => onSave({ agendaLink })}
        disabled={!dirty}
        className="self-start rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
      >
        Enregistrer l&apos;agenda
      </button>
    </div>
  );
}
