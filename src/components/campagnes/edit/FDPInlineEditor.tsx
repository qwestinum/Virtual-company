'use client';

/**
 * Éditeur inline complet d'une fiche de poste.
 *
 * Réutilisé par l'ÉDITION d'une campagne (`FDPEditBlock`) et par l'ASSISTANT
 * de création (étape « Le poste ») — un seul formulaire, donc une seule
 * correction quand quelque chose ne va pas.
 *
 * ⚠️ Il monte le champ PARTAGÉ (`FormField` + contrôles) et ne dessine plus le
 * sien. Avant : un libellé en petites capitales grises au-dessus d'une zone
 * sans bordure — le mot était la seule chose visible, donc la chose qu'on
 * cliquait, et le clic ne faisait rien. Le libellé est maintenant lié au champ
 * par `htmlFor` : le cliquer donne le focus.
 *
 * L'éditeur est « contrôlé » par le parent, qui détient l'objet
 * `FDPInProgress` et reçoit chaque patch via `onPatch`.
 */

import { FormField, FormStack } from '@/components/ui/FormField';
import {
  SelectInput,
  TextAreaInput,
  TextInput,
} from '@/components/ui/FormControls';
import {
  FIELD_KEYS,
  FIELD_LABELS,
  SenioritySchema,
  type FDPInProgress,
  type FieldKey,
} from '@/types/field-collection';

import { ContractTypeField } from './ContractTypeField';
import {
  listValueToText,
  normalizeListInput,
  parseListInputRaw,
} from './list-input';

/** L'exemple vit DANS le champ. Vide = pas d'exemple à donner. */
const EXEMPLES: Partial<Record<FieldKey, string>> = {
  job_title: 'ex. Développeur back end',
  location: 'ex. Paris, hybride 2 jours',
  salary_range: 'ex. 45 – 55 k€',
  start_date: 'ex. 1er juin 2026',
  main_missions: 'Une entrée par ligne',
  key_skills: 'Une entrée par ligne',
};

/** Aide contextuelle, sous le champ. Absente quand le libellé suffit. */
const AIDES: Partial<Record<FieldKey, string>> = {
  main_missions: 'Une mission par ligne — elles seront reprises telles quelles dans l’annonce.',
  key_skills: 'Une compétence par ligne. Elles servent aussi à chercher dans le vivier.',
};

export type FDPInlineEditorProps = {
  fdp: FDPInProgress;
  onPatch: (key: FieldKey, value: unknown) => void;
  disabled?: boolean;
};

export function FDPInlineEditor({ fdp, onPatch, disabled }: FDPInlineEditorProps) {
  return (
    <FormStack>
      {FIELD_KEYS.map((key) => {
        const field = fdp.fields[key];
        const id = `fdp-${key}`;
        return (
          // `data-field` : repère STABLE pour les tests qui cliquent.
          <div key={key} data-field={key}>
            <FormField
              id={id}
              label={FIELD_LABELS[key]}
              required={field?.required !== false}
              hint={AIDES[key]}
            >
              <Controle
                id={id}
                fieldKey={key}
                value={field?.value}
                onChange={(value) => onPatch(key, value)}
                disabled={disabled}
              />
            </FormField>
          </div>
        );
      })}
    </FormStack>
  );
}

function Controle({
  id,
  fieldKey,
  value,
  onChange,
  disabled,
}: {
  id: string;
  fieldKey: FieldKey;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  const texte = typeof value === 'string' ? value : '';
  const exemple = EXEMPLES[fieldKey];

  switch (fieldKey) {
    case 'seniority':
      return (
        <SelectInput
          id={id}
          value={texte}
          disabled={disabled}
          onChange={(next) => onChange(next || undefined)}
        >
          <option value="">À choisir</option>
          {SenioritySchema.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </SelectInput>
      );

    case 'contract_type':
      // Multi-sélection + saisie libre : composant dédié, déjà conforme.
      return <ContractTypeField id={id} value={value} onChange={onChange} disabled={disabled} />;

    case 'main_missions':
    case 'key_skills':
      return (
        <TextAreaInput
          id={id}
          rows={fieldKey === 'main_missions' ? 4 : 3}
          value={listValueToText(value)}
          placeholder={exemple}
          disabled={disabled}
          // Pendant la frappe on conserve le texte TEL QUEL (round-trip exact)
          // pour que le curseur ne saute pas en fin de paragraphe ; la
          // normalisation se fait au blur.
          onChange={(next) => onChange(parseListInputRaw(next))}
          onBlur={() => onChange(normalizeListInput(listValueToText(value)))}
        />
      );

    default:
      return (
        <TextInput
          id={id}
          value={texte}
          placeholder={exemple}
          disabled={disabled}
          onChange={(next) => onChange(next || undefined)}
        />
      );
  }
}
