'use client';

/**
 * Hub de paramètres applicatifs.
 *
 * Familles et sections viennent du REGISTRE (`@/lib/settings/sections-registry`)
 * — titres, descriptions et mots-clés y sont déclarés une fois, et la
 * recherche, la liste des manques et l'écran les lisent au même endroit. Ce
 * composant ne fait que relier chaque section à son contenu.
 *
 * 02/10/2026 (demande du donneur d'ordre) :
 *   - tout est REPLIÉ à chaque arrivée, sans mémoire ;
 *   - une recherche en tête filtre les sections et ouvre un résultat unique ;
 *   - les modèles de messages ont leur famille, un modèle par entrée ;
 *   - les réglages essentiels manquants sont NOMMÉS, situés, et « Y aller »
 *     ouvre la section.
 *
 * Les modifications PUT immédiatement vers /api/settings. Pas de bouton
 * « Enregistrer » global — chaque section a son propre flux.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { PUBLICATION_CHANNEL_ORDER } from '@/types/publication-channel';
import { DEFAULT_INTERVIEW_CONFIG } from '@/types/interview-settings';
import { DEFAULT_VIVIER_CONFIG } from '@/types/vivier-settings';
import { DEFAULT_BRANDING_CONFIG } from '@/types/branding';
import { DEFAULT_ADEP_CONFIG } from '@/types/adep-settings';
import { DEFAULT_SOURCING_CONFIG } from '@/types/sourcing-settings';
import {
  brandingSummary,
  channelsSummary,
  integrationsSummary,
  interviewSummary,
  listMissingSettings,
  resendSummary,
  senderSummary,
  synthesisSummary,
  vivierSummary,
  type SectionState,
  type SummarySource,
} from '@/lib/settings/section-summary';
import {
  MESSAGE_TEMPLATES,
  currentTemplateText,
  defaultTemplateText,
  templateSummary,
  type MessageTemplate,
} from '@/lib/settings/message-templates';
import {
  findSection,
  searchSettings,
  settingsFamilies,
} from '@/lib/settings/sections-registry';

import { DonneursOrdreManager } from './DonneursOrdreManager';
import { RecruitersManager } from './RecruitersManager';
import { AgendaSettings } from './AgendaSettings';
import { SourcingConfigManager } from './SourcingConfigManager';
import { TranscriptImportSettings } from './TranscriptImportSettings';
import { BrandingManager } from './BrandingManager';
import { CabinetSignatureManager } from './CabinetSignatureManager';
import { InterviewConfigManager } from './InterviewConfigManager';
import { MailboxesManager } from './MailboxesManager';
import { ResendKeyManager } from './ResendKeyManager';
import { MessageTemplateEditor } from './MessageTemplateEditor';
import { SenderAddressSettings, SynthesisAddressSettings } from './MailAddressSettings';
import {
  ChannelIntegrations,
  FluxIntegrations,
  INTEGRATION_SOURCES,
} from './IntegrationsSettings';
import { SettingsGroup } from './SettingsGroup';
import { SettingsSection } from './SettingsSection';
import { SettingsToolbar } from './SettingsToolbar';
import { useSectionToggles } from './useSectionToggles';
import { SitesManager } from './SitesManager';
import { VivierConfigManager } from './VivierConfigManager';
import type { SettingsData, SettingsFallbacks } from './settings-data';

export type { IntegrationConfig } from './settings-data';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; settings: SettingsData; offline: boolean; fallbacks: SettingsFallbacks }
  | { kind: 'error'; message: string };

const countConfigured = (config: SettingsData['fluxConfig']): number =>
  Object.values(config).filter((c) => c.status === 'configured').length;

export function SettingsHub({
  isAdmin = false,
  currentUserId = null,
}: { isAdmin?: boolean; currentUserId?: string | null } = {}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [flash, setFlash] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          offline: boolean;
          settings: SettingsData;
          fallbacks?: SettingsFallbacks;
        };
        if (!cancelled)
          setState({
            kind: 'ready',
            settings: {
              ...json.settings,
              synthesisEmailsActive: json.settings.synthesisEmailsActive ?? [],
              vivierConfig: json.settings.vivierConfig ?? DEFAULT_VIVIER_CONFIG,
              interviewConfig: json.settings.interviewConfig ?? DEFAULT_INTERVIEW_CONFIG,
              brandingConfig: json.settings.brandingConfig ?? DEFAULT_BRANDING_CONFIG,
              adepConfig: json.settings.adepConfig ?? DEFAULT_ADEP_CONFIG,
              sourcingConfig: json.settings.sourcingConfig ?? DEFAULT_SOURCING_CONFIG,
              resendApiKeyConfigured: json.settings.resendApiKeyConfigured ?? false,
            },
            offline: json.offline,
            fallbacks: json.fallbacks ?? { synthesisEmail: null, senderEmail: null },
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

  // Hooks AVANT les retours anticipés : un hook appelé après un `return`
  // conditionnel n'est pas appelé au même rang d'un rendu à l'autre.
  const families = useMemo(() => settingsFamilies(isAdmin), [isAdmin]);
  const sectionIds = useMemo(
    () => families.flatMap((f) => f.sections.map((s) => s.id)),
    [families],
  );
  const familyLabels = useMemo(() => families.map((f) => f.label), [families]);
  const toggles = useSectionToggles(sectionIds);
  const groupes = useSectionToggles(familyLabels);

  if (state.kind === 'loading') {
    return <p className="font-body text-stone-500 text-sm">Chargement des paramètres…</p>;
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
  const putSettings = async (body: Record<string, unknown>, flashMessage: string) => {
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
      setFlash(`Erreur réseau (${err instanceof Error ? err.message : 'inconnue'}).`);
    }
    window.setTimeout(() => setFlash(null), 3500);
  };

  const patchAndSave = async (patch: Partial<SettingsData>, flashMessage: string) => {
    setState({ kind: 'ready', settings: { ...settings, ...patch }, offline, fallbacks });
    await putSettings(patch, flashMessage);
  };

  // Clé Resend (write-only) : on PUT la valeur brute mais on ne reflète QUE le
  // statut côté UI. `''` retire la clé.
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

  // Un modèle s'enregistre SEUL, fusionné dans la configuration COURANTE :
  // les autres modèles et réglages du même objet restent tels qu'en base.
  const saveTemplate = (t: MessageTemplate, text: string) => {
    const flashMessage = `Modèle « ${t.title} » enregistré.`;
    if (t.ref.scope === 'vivier') {
      void patchAndSave(
        { vivierConfig: { ...settings.vivierConfig, invitationTemplate: text } },
        flashMessage,
      );
    } else {
      void patchAndSave(
        { interviewConfig: { ...settings.interviewConfig, [t.ref.key]: text } },
        flashMessage,
      );
    }
  };

  const source: SummarySource = {
    synthesisEmails: settings.synthesisEmails,
    synthesisEmailsActive: settings.synthesisEmailsActive,
    senderEmail: settings.senderEmail,
    senderEmails: settings.senderEmails,
    resendApiKeyConfigured: settings.resendApiKeyConfigured,
    interviewConfig: settings.interviewConfig,
    vivierConfig: settings.vivierConfig,
    brandingConfig: settings.brandingConfig,
    adepConfig: settings.adepConfig,
    fluxConfigured: countConfigured(settings.fluxConfig),
    channelsConfigured: countConfigured(settings.channelsConfig),
  };
  const states: Record<string, SectionState> = {
    synthese: synthesisSummary(source),
    expediteur: senderSummary(source),
    resend: resendSummary(source),
    entretiens: interviewSummary(source),
    identite: brandingSummary(source),
    vivier: vivierSummary(source),
    flux: integrationsSummary(source.fluxConfigured, INTEGRATION_SOURCES.length),
    canaux: channelsSummary(source, PUBLICATION_CHANNEL_ORDER.length - 2),
    ...Object.fromEntries(
      MESSAGE_TEMPLATES.map((t) => [
        t.id,
        { summary: templateSummary(t, settings), status: 'neutral' } satisfies SectionState,
      ]),
    ),
  };
  const missing = listMissingSettings(states, families);

  // Recherche : `null` = pas de filtre. Un résultat UNIQUE s'ouvre de lui-même
  // — on cherchait une chose, on la trouve dépliée.
  const hits = searchSettings(families, query);
  const onQueryChange = (q: string) => {
    setQuery(q);
    const next = searchSettings(families, q);
    if (next && next.length === 1) toggles.reveal(next);
  };

  // « Y aller » : on quitte la recherche, on ouvre la famille ET la section,
  // puis on y fait défiler — une fois le rendu posé, sinon l'ancre n'existe
  // pas encore dans une famille qui était repliée.
  const goTo = (sectionId: string) => {
    const found = findSection(families, sectionId);
    if (!found) return;
    setQuery('');
    groupes.reveal([found.family.label]);
    toggles.reveal([sectionId]);
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        const el = document.getElementById(`reglage-${sectionId}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el?.querySelector<HTMLButtonElement>('h2 button')?.focus({ preventScroll: true });
      }),
    );
  };

  const templateById = new Map(MESSAGE_TEMPLATES.map((t) => [t.id, t]));

  const content = (id: string): ReactNode => {
    const template = templateById.get(id);
    if (template) {
      return (
        <MessageTemplateEditor
          template={template}
          value={currentTemplateText(template.ref, settings)}
          defaultValue={defaultTemplateText(template.ref)}
          onSave={(text) => saveTemplate(template, text)}
        />
      );
    }
    switch (id) {
      case 'vivier':
        return (
          <VivierConfigManager
            config={settings.vivierConfig}
            onSave={(fields) =>
              patchAndSave(
                { vivierConfig: { ...settings.vivierConfig, ...fields } },
                'Réglages vivier mis à jour.',
              )
            }
          />
        );
      case 'entretiens':
        return (
          <InterviewConfigManager
            config={settings.interviewConfig}
            onSave={(fields) =>
              patchAndSave(
                { interviewConfig: { ...settings.interviewConfig, ...fields } },
                'Agenda des entretiens mis à jour.',
              )
            }
          />
        );
      case 'comptes-rendus':
        return (
          <TranscriptImportSettings
            config={settings.interviewConfig}
            onSave={(next) =>
              patchAndSave({ interviewConfig: next }, 'Réglage des comptes rendus mis à jour.')
            }
          />
        );
      case 'identite':
        return (
          <>
            <CabinetSignatureManager
              config={settings.interviewConfig}
              onSave={(fields) =>
                patchAndSave(
                  { interviewConfig: { ...settings.interviewConfig, ...fields } },
                  'Nom du cabinet et signataire mis à jour.',
                )
              }
            />
            <div className="mt-2 border-t border-stone-200 pt-4">
              <BrandingManager
                config={settings.brandingConfig}
                onSave={(next) =>
                  patchAndSave({ brandingConfig: next }, 'Identité du cabinet mise à jour.')
                }
              />
            </div>
          </>
        );
      case 'agendas':
        return <AgendaSettings currentUserId={currentUserId} isAdmin={isAdmin} />;
      case 'recruteurs':
        return <RecruitersManager />;
      case 'sourcing':
        return (
          <SourcingConfigManager
            config={settings.sourcingConfig}
            onSave={(next) =>
              patchAndSave({ sourcingConfig: next }, 'Recherche de profils mise à jour.')
            }
          />
        );
      case 'donneurs':
        return <DonneursOrdreManager />;
      case 'sites':
        return <SitesManager />;
      case 'boites':
        return <MailboxesManager />;
      case 'synthese':
        return (
          <SynthesisAddressSettings
            settings={settings}
            fallbacks={fallbacks}
            patchAndSave={patchAndSave}
          />
        );
      case 'expediteur':
        return (
          <SenderAddressSettings
            settings={settings}
            fallbacks={fallbacks}
            patchAndSave={patchAndSave}
          />
        );
      case 'resend':
        return (
          <ResendKeyManager
            configured={settings.resendApiKeyConfigured}
            onSave={saveResendKey}
          />
        );
      case 'flux':
        return <FluxIntegrations settings={settings} patchAndSave={patchAndSave} />;
      case 'canaux':
        return <ChannelIntegrations settings={settings} patchAndSave={patchAndSave} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {offline ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 font-body">
          Mode local — Supabase n&apos;est pas connecté. Les valeurs ci-dessous
          ne seront pas persistées tant que la connexion DB n&apos;est pas
          configurée.
        </div>
      ) : null}
      {flash ? (
        <div className="sticky top-2 z-10 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800 font-body">
          {flash}
        </div>
      ) : null}

      <SettingsToolbar
        query={query}
        onQueryChange={onQueryChange}
        resultCount={hits?.length ?? null}
        missing={missing}
        onGoTo={goTo}
        openCount={toggles.openCount}
        total={sectionIds.length}
        onOpenAll={() => {
          groupes.openAll();
          toggles.openAll();
        }}
        onCloseAll={() => {
          groupes.closeAll();
          toggles.closeAll();
        }}
      />

      {families.map((family) => {
        const visible = hits
          ? family.sections.filter((s) => hits.includes(s.id))
          : family.sections;
        if (visible.length === 0) return null;
        return (
          <SettingsGroup
            key={family.label}
            label={family.label}
            // En recherche, la famille d'un résultat est montrée OUVERTE et
            // verrouillée : la replier cacherait ce qu'on vient de trouver.
            open={hits ? true : groupes.isOpen(family.label)}
            locked={hits !== null}
            onToggle={() => groupes.toggle(family.label)}
            count={visible.length}
          >
            {visible.map((s) => (
              <SettingsSection
                key={s.id}
                sectionId={s.id}
                icon={s.icon}
                title={s.title}
                description={s.description}
                summary={states[s.id]?.summary}
                status={states[s.id]?.status}
                open={toggles.isOpen(s.id)}
                onToggle={() => toggles.toggle(s.id)}
              >
                {content(s.id)}
              </SettingsSection>
            ))}
          </SettingsGroup>
        );
      })}
    </div>
  );
}
