'use client';

/**
 * Hub de paramètres applicatifs (Session 6 v5).
 *
 * 5 sections :
 *   1. Boîtes de réception (MailboxesManager inliné)
 *   2. Adresses de synthèse (liste + défaut)
 *   3. Adresses expéditeur (liste + défaut)
 *   4. Intégrations Flux
 *   5. Intégrations Canaux de diffusion
 *
 * Les modifications PUT immédiatement vers /api/settings. Pas de
 * bouton « Enregistrer » global — chaque section a son propre flux
 * (l'ajout/sélection d'une adresse déclenche le PUT, le retour
 * affiche un flash).
 */

import { useEffect, useState } from 'react';

import {
  CV_SOURCES,
  CV_SOURCE_HINTS,
  CV_SOURCE_LABELS,
  type CVSource,
} from '@/types/cv-source';
import {
  PUBLICATION_CHANNEL_LABELS,
  PUBLICATION_CHANNEL_ORDER,
  type PublicationChannel,
} from '@/types/publication-channel';
import { DEFAULT_HITL_CONFIG, type HitlConfig } from '@/types/hitl';
import {
  DEFAULT_INTERVIEW_CONFIG,
  type InterviewConfig,
} from '@/types/interview-settings';
import { DEFAULT_VIVIER_CONFIG, type VivierConfig } from '@/types/vivier-settings';

import { DonneursOrdreManager } from './DonneursOrdreManager';
import { EmailListField } from './EmailListField';
import { EmailMultiSelectField } from './EmailMultiSelectField';
import { IntegrationCard } from './IntegrationCard';
import { InterviewConfigManager } from './InterviewConfigManager';
import { MailboxesManager } from './MailboxesManager';
import { ResendKeyManager } from './ResendKeyManager';
import { SettingsSection } from './SettingsSection';
import { SitesManager } from './SitesManager';
import { VivierConfigManager } from './VivierConfigManager';

export type IntegrationConfig = {
  status: 'configured' | 'unconfigured';
  credential?: string;
  notes?: string;
};

type Settings = {
  synthesisEmail: string | null;
  synthesisEmails: string[];
  /** Sous-ensemble coché = destinataires des briefings (choix multiple). */
  synthesisEmailsActive: string[];
  senderEmail: string | null;
  senderEmails: string[];
  intakeEmail: string | null;
  fluxConfig: Record<string, IntegrationConfig>;
  channelsConfig: Record<string, IntegrationConfig>;
  hitlConfig: HitlConfig;
  vivierConfig: VivierConfig;
  interviewConfig: InterviewConfig;
  /** Clé Resend : statut seulement (la valeur n'est jamais renvoyée). */
  resendApiKeyConfigured: boolean;
  updatedAt: string;
};

type Fallbacks = {
  synthesisEmail: string | null;
  senderEmail: string | null;
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; settings: Settings; offline: boolean; fallbacks: Fallbacks }
  | { kind: 'error'; message: string };

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

/** Ligne label + interrupteur, pour les toggles de validation humaine. */
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-stone-200 bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="font-body text-[14px] font-semibold text-stone-800">
          {label}
        </p>
        <p className="font-body text-[12px] text-stone-500">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
          checked ? 'bg-emerald-500' : 'bg-stone-300'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

export function SettingsHub() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          offline: boolean;
          settings: Settings;
          fallbacks?: Fallbacks;
        };
        if (!cancelled)
          setState({
            kind: 'ready',
            settings: {
              ...json.settings,
              synthesisEmailsActive: json.settings.synthesisEmailsActive ?? [],
              hitlConfig: json.settings.hitlConfig ?? DEFAULT_HITL_CONFIG,
              interviewConfig:
                json.settings.interviewConfig ?? DEFAULT_INTERVIEW_CONFIG,
              resendApiKeyConfigured:
                json.settings.resendApiKeyConfigured ?? false,
            },
            offline: json.offline,
            fallbacks: json.fallbacks ?? {
              synthesisEmail: null,
              senderEmail: null,
            },
          });
      } catch (err) {
        if (!cancelled)
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'load_failed',
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return (
      <p className="font-body text-stone-500 text-sm">
        Chargement des paramètres…
      </p>
    );
  }

  if (state.kind === 'error') {
    return (
      <p className="font-body text-rose-600 text-sm">
        Impossible de charger les paramètres ({state.message}).
      </p>
    );
  }

  const { settings, offline, fallbacks } = state;

  // PUT partagé : le CORPS envoyé peut différer de la mise à jour locale (ex.
  // clé Resend write-only — on PUT { resendApiKey } mais on ne reflète qu'un
  // booléen côté UI, jamais la valeur).
  const putSettings = async (
    body: Record<string, unknown>,
    flashMessage: string,
  ) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 503) {
        setFlash(
          'Supabase non configuré — modification non persistée. Configurez NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.',
        );
      } else if (!res.ok) {
        setFlash(`Erreur de sauvegarde (HTTP ${res.status}).`);
      } else {
        setFlash(flashMessage);
      }
    } catch (err) {
      setFlash(
        `Erreur réseau (${err instanceof Error ? err.message : 'inconnue'}).`,
      );
    }
    window.setTimeout(() => setFlash(null), 3500);
  };

  const patchAndSave = async (
    patch: Partial<Settings>,
    flashMessage: string,
  ) => {
    const next: Settings = { ...settings, ...patch };
    setState({ kind: 'ready', settings: next, offline, fallbacks });
    await putSettings(patch, flashMessage);
  };

  // Clé Resend (write-only) : on PUT la valeur brute mais on ne reflète QUE le
  // statut `resendApiKeyConfigured` côté UI (la valeur n'est jamais stockée
  // dans l'état client ni réaffichée). `''` retire la clé.
  const saveResendKey = async (key: string) => {
    setState({
      kind: 'ready',
      settings: { ...settings, resendApiKeyConfigured: key.length > 0 },
      offline,
      fallbacks,
    });
    await putSettings(
      { resendApiKey: key },
      key.length > 0 ? 'Clé Resend enregistrée.' : 'Clé Resend retirée.',
    );
  };

  return (
    <div className="flex flex-col gap-8">
      {offline ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 font-body">
          Mode local — Supabase n&apos;est pas connecté. Les valeurs ci-dessous
          ne seront pas persistées tant que la connexion DB n&apos;est pas
          configurée.
        </div>
      ) : null}
      {flash ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800 font-body">
          {flash}
        </div>
      ) : null}

      <SettingsSection
        icon="🛡️"
        title="Validation humaine (Human in the loop)"
        description="La validation humaine se règle désormais PAR CAMPAGNE, via les « Seuils de décision »."
      >
        <div className="rounded-lg border border-[var(--dash-border)] bg-[var(--dash-warm)] px-4 py-3 text-[13px] text-[var(--dash-text-secondary)] font-body leading-relaxed">
          Le réglage global a été remplacé par deux seuils de score par campagne :
          en dessous du seuil bas, le refus part automatiquement ; au-dessus du
          seuil haut, l&apos;acceptation part automatiquement ; entre les deux,
          la candidature est mise en file dans « Validation suspendue » pour que
          vous tranchiez. Ajustez ces seuils dans l&apos;onglet Campagnes → édition
          → « Seuils de décision ».
        </div>
      </SettingsSection>

      <SettingsSection
        icon="🗂️"
        title="Vivier de candidats"
        description="Mode de contact (validation manuelle ou automatique), template du message d'invitation à postuler, cooldown anti-sollicitation et plafond de short-list."
      >
        <VivierConfigManager
          config={settings.vivierConfig ?? DEFAULT_VIVIER_CONFIG}
          onSave={(next) =>
            patchAndSave({ vivierConfig: next }, 'Réglages vivier mis à jour.')
          }
        />
      </SettingsSection>

      <SettingsSection
        icon="📅"
        title="Entretiens — messages candidat"
        description="Templates d'acceptation+invitation et de refus (rendus tels quels, sans rédaction par l'IA) et lien d'agenda. L'invitation ne fixe pas de RDV : le candidat choisit son créneau via le lien d'agenda."
      >
        <InterviewConfigManager
          config={settings.interviewConfig ?? DEFAULT_INTERVIEW_CONFIG}
          onSave={(next) =>
            patchAndSave(
              { interviewConfig: next },
              'Réglages entretien mis à jour.',
            )
          }
        />
      </SettingsSection>

      <SettingsSection
        icon="📥"
        title="Boîtes de réception des CV"
        description="Les boîtes mail IMAP surveillées par le poller. Quand un email arrive avec l'ID de campagne dans l'objet et un CV en pièce jointe, l'agent CV Analyzer s'exécute automatiquement."
      >
        <MailboxesManager />
      </SettingsSection>

      <SettingsSection
        icon="🏢"
        title="Donneurs d'ordre"
        description="Les personnes (côté client) qui initient les campagnes — distinctes de l'utilisateur ORQA. Une campagne a un seul donneur d'ordre. Dimension consommée par le module Reporting."
      >
        <DonneursOrdreManager />
      </SettingsSection>

      <SettingsSection
        icon="📍"
        title="Sites"
        description="Les implantations géographiques ou organisationnelles de rattachement des campagnes (multi-sites). Une campagne a un seul site. Un site « par défaut » existe pour les organisations mono-site."
      >
        <SitesManager />
      </SettingsSection>

      <SettingsSection
        icon="📝"
        title="Adresses de synthèse"
        description="Destinataires des briefings d'entretien. Cochez chaque adresse qui doit recevoir les briefings — le mail ne part qu'aux adresses cochées."
      >
        <FallbackHint
          envName="EMAIL_DRH"
          value={
            settings.synthesisEmails.length === 0
              ? fallbacks.synthesisEmail
              : null
          }
          alreadyInList={
            !!fallbacks.synthesisEmail &&
            settings.synthesisEmails.includes(fallbacks.synthesisEmail)
          }
          onAdoptIntoList={() => {
            const v = fallbacks.synthesisEmail;
            if (!v) return;
            patchAndSave(
              {
                synthesisEmails: [v],
                synthesisEmailsActive: [v],
                synthesisEmail: v,
              },
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
      </SettingsSection>

      <SettingsSection
        icon="📤"
        title="Adresses expéditeur"
        description="Adresses depuis lesquelles les mails (invitations, refus) sont envoyés. Doivent appartenir à un domaine vérifié côté Resend."
      >
        <FallbackHint
          envName="EMAIL_FROM"
          value={
            settings.senderEmail == null &&
            settings.senderEmails.length === 0
              ? fallbacks.senderEmail
              : null
          }
          alreadyInList={
            !!fallbacks.senderEmail &&
            settings.senderEmails.includes(fallbacks.senderEmail)
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
              {
                senderEmails: addresses,
                senderEmail: selected,
              },
              selected
                ? `Adresse expéditeur active : ${selected}.`
                : 'Liste des adresses expéditeur mise à jour.',
            )
          }
        />
      </SettingsSection>

      <SettingsSection
        icon="📧"
        title="Service email (Resend)"
        description="Clé API Resend utilisée pour l'envoi des mails (invitations, refus, briefs). Pilotable ici — plus besoin de toucher au .env.local ni de redémarrer le serveur. La clé est stockée côté serveur et n'est jamais réaffichée."
      >
        <ResendKeyManager
          configured={settings.resendApiKeyConfigured}
          onSave={saveResendKey}
        />
      </SettingsSection>

      <SettingsSection
        icon="🔌"
        title="Intégrations — Flux d'arrivée"
        description="Identifiants d'API pour les canaux de réception automatique de CV. Configurez celles dont vous avez besoin ; les autres restent en mode manuel."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CV_SOURCES.filter(
            (s) => s !== 'manual' && s !== 'local_folder' && s !== 'vivier',
          ).map(
            (source) => {
              const id = source as CVSource;
              const config = settings.fluxConfig[id] ?? {
                status: 'unconfigured',
              };
              return (
                <IntegrationCard
                  key={id}
                  label={CV_SOURCE_LABELS[id]}
                  hint={CV_SOURCE_HINTS[id]}
                  config={config}
                  onSave={(next) =>
                    patchAndSave(
                      {
                        fluxConfig: { ...settings.fluxConfig, [id]: next },
                      },
                      `Intégration ${CV_SOURCE_LABELS[id]} mise à jour.`,
                    )
                  }
                />
              );
            },
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        icon="📢"
        title="Intégrations — Canaux de diffusion"
        description="Credentials pour publier les annonces sur les jobboards. Sans configuration, la diffusion reste en mode trace (l'annonce est rédigée mais pas publiée)."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PUBLICATION_CHANNEL_ORDER.filter((c) => c !== 'generic').map(
            (channel) => {
              const id = channel as PublicationChannel;
              const config = settings.channelsConfig[id] ?? {
                status: 'unconfigured',
              };
              return (
                <IntegrationCard
                  key={id}
                  label={PUBLICATION_CHANNEL_LABELS[id]}
                  hint="API token / OAuth — à brancher via l'agent Publisher"
                  config={config}
                  onSave={(next) =>
                    patchAndSave(
                      {
                        channelsConfig: {
                          ...settings.channelsConfig,
                          [id]: next,
                        },
                      },
                      `Intégration ${PUBLICATION_CHANNEL_LABELS[id]} mise à jour.`,
                    )
                  }
                />
              );
            },
          )}
        </div>
      </SettingsSection>
    </div>
  );
}
