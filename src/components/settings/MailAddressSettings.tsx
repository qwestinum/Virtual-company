'use client';

/**
 * Contenu des sections « Adresses de synthèse » et « Adresses expéditeur »
 * de /settings (extrait du hub, 02/10/2026).
 */

import { EmailListField } from './EmailListField';
import { EmailMultiSelectField } from './EmailMultiSelectField';
import type { PatchAndSave, SettingsData, SettingsFallbacks } from './settings-data';

/**
 * Bandeau d'info pour signaler qu'une adresse vient d'une variable
 * d'environnement (EMAIL_DRH / EMAIL_FROM) plutôt que de la table DB.
 * Le DRH peut l'adopter dans la liste en un clic pour la gérer
 * ensuite via l'UI.
 */
function FallbackHint({
  envName,
  value,
  alreadyInList,
  onAdoptIntoList,
}: {
  envName: string;
  value: string | null;
  alreadyInList: boolean;
  onAdoptIntoList: () => void;
}) {
  if (!value || alreadyInList) return null;
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 mb-2">
      <p className="font-body text-[13px] text-blue-900">
        Le pipeline utilise actuellement{' '}
        <strong className="font-semibold">{value}</strong> (variable
        d&apos;environnement <code className="font-mono text-[12px]">{envName}</code>
        ), mais cette adresse n&apos;est pas dans la liste ci-dessous.
      </p>
      <button
        type="button"
        onClick={onAdoptIntoList}
        className="mt-2 px-3 py-1.5 rounded-lg text-[12px] font-body font-semibold bg-blue-600 text-white hover:bg-blue-700"
      >
        Enregistrer cette adresse dans la liste
      </button>
    </div>
  );
}

type Props = {
  settings: SettingsData;
  fallbacks: SettingsFallbacks;
  patchAndSave: PatchAndSave;
};

export function SynthesisAddressSettings({ settings, fallbacks, patchAndSave }: Props) {
  return (
    <>
      <FallbackHint
        envName="EMAIL_DRH"
        value={settings.synthesisEmails.length === 0 ? fallbacks.synthesisEmail : null}
        alreadyInList={
          !!fallbacks.synthesisEmail && settings.synthesisEmails.includes(fallbacks.synthesisEmail)
        }
        onAdoptIntoList={() => {
          const v = fallbacks.synthesisEmail;
          if (!v) return;
          patchAndSave(
            { synthesisEmails: [v], synthesisEmailsActive: [v], synthesisEmail: v },
            `Adresse de synthèse ${v} enregistrée — vous pouvez maintenant la gérer ici.`,
          );
        }}
      />
      <EmailMultiSelectField
        addresses={settings.synthesisEmails}
        checked={settings.synthesisEmailsActive}
        emptyHint="Aucune adresse de synthèse enregistrée — ajoutez-en une ci-dessous puis cochez-la pour activer l'envoi des briefings."
        inputPlaceholder="ex. responsable.rh@entreprise.com"
        onChange={({ addresses, checked }) =>
          patchAndSave(
            {
              synthesisEmails: addresses,
              synthesisEmailsActive: checked,
              // Singulier legacy (replyTo) = 1re adresse cochée.
              synthesisEmail: checked[0] ?? null,
            },
            checked.length > 0
              ? `Destinataires des briefings : ${checked.length} adresse${checked.length > 1 ? 's' : ''}.`
              : 'Liste mise à jour — aucune adresse cochée.',
          )
        }
      />
    </>
  );
}

export function SenderAddressSettings({ settings, fallbacks, patchAndSave }: Props) {
  return (
    <>
      <FallbackHint
        envName="EMAIL_FROM"
        value={
          settings.senderEmail == null && settings.senderEmails.length === 0
            ? fallbacks.senderEmail
            : null
        }
        alreadyInList={
          !!fallbacks.senderEmail && settings.senderEmails.includes(fallbacks.senderEmail)
        }
        onAdoptIntoList={() => {
          const v = fallbacks.senderEmail;
          if (!v) return;
          patchAndSave(
            { senderEmails: [v], senderEmail: v },
            `Adresse expéditeur ${v} enregistrée — vous pouvez maintenant la gérer ici.`,
          );
        }}
      />
      <EmailListField
        addresses={settings.senderEmails}
        selected={settings.senderEmail}
        emptyHint="Aucune adresse expéditeur enregistrée — Resend retombera sur onboarding@resend.dev (compte de démo)."
        inputPlaceholder="ex. recrutement@qwestinum.com"
        onChange={({ addresses, selected }) =>
          patchAndSave(
            { senderEmails: addresses, senderEmail: selected },
            selected
              ? `Adresse expéditeur active : ${selected}.`
              : 'Liste des adresses expéditeur mise à jour.',
          )
        }
      />
    </>
  );
}
