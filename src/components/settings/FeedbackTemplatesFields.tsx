'use client';

/**
 * Gabarits des messages au candidat APRÈS DÉCISION (feat/feedback-candidat).
 * Quatre textes éditables, à côté des gabarits d'entretien existants, dans le
 * même brouillon et sous le même bouton d'enregistrement.
 *
 * Ce ne sont que des PROPOSITIONS : au moment de la décision, le recruteur
 * relit le message pré-rempli et peut le retoucher avant de l'envoyer — ou
 * choisir de prévenir le candidat lui-même.
 */

import {
  DEFAULT_INTERVIEW_CONFIG,
  type InterviewConfig,
} from '@/types/interview-settings';

type FeedbackField =
  | 'feedbackRetainedTemplate'
  | 'feedbackNotRetainedTemplate'
  | 'feedbackNoShowTemplate'
  | 'feedbackDismissedTemplate';

const FIELDS: { key: FeedbackField; title: string; hint: string }[] = [
  {
    key: 'feedbackRetainedTemplate',
    title: 'Retenu après entretien',
    hint:
      'Suite du processus, jamais une promesse d’embauche. [prochaine étape] ' +
      'reprend ce que le recruteur précise au moment de la décision ; vide, une ' +
      'phrase d’attente la remplace.',
  },
  {
    key: 'feedbackNotRetainedTemplate',
    title: 'Non retenu après entretien',
    hint: 'Envoyé aussi à un retenu non sélectionné à la clôture de la campagne.',
  },
  {
    key: 'feedbackNoShowTemplate',
    title: 'Absent à l’entretien',
    hint: 'Proposé quand un candidat absent est classé non retenu.',
  },
  {
    key: 'feedbackDismissedTemplate',
    title: 'Sans suite',
    hint:
      'Ce n’est pas un refus : le recrutement s’arrête pour une raison ' +
      'externe. [motif] porte la phrase propre à la raison (poste pourvu, ' +
      'campagne close, retrait…). Utilisé aussi pour l’envoi groupé à la clôture.',
  },
];

export function FeedbackTemplatesFields({
  draft,
  onChange,
}: {
  draft: InterviewConfig;
  onChange: (key: FeedbackField, value: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-4 border-t border-stone-200 pt-4">
      <legend className="font-display text-[14px] font-bold text-stone-800">
        Messages au candidat après décision
      </legend>
      <p className="-mt-2 text-[12px] text-stone-500">
        Proposés au recruteur au moment de sa décision, signés de lui ; les
        réponses du candidat arrivent dans sa messagerie. Variables : [prénom],
        [intitulé du poste], [organisation], [prénom du recruteur], [nom du
        recruteur]. Le commentaire du recruteur n’est jamais repris dans ces
        messages. La mention d’information sur les données est ajoutée
        automatiquement en pied.
      </p>

      {FIELDS.map(({ key, title, hint }) => {
        const isDefault = draft[key] === DEFAULT_INTERVIEW_CONFIG[key];
        return (
          <label key={key} className="flex flex-col gap-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-stone-700">{title}</span>
              {!isDefault ? (
                <button
                  type="button"
                  onClick={() => onChange(key, DEFAULT_INTERVIEW_CONFIG[key])}
                  className="text-[11px] font-semibold text-stone-500 underline hover:text-stone-800"
                >
                  Rétablir le texte proposé
                </button>
              ) : null}
            </span>
            <textarea
              value={draft[key]}
              onChange={(e) => onChange(key, e.currentTarget.value)}
              rows={9}
              className="w-full rounded-md border border-stone-200 px-3 py-2 font-mono text-[12px] text-stone-700 outline-none focus:border-emerald-400"
            />
            <span className="text-[11px] text-stone-500">{hint}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
