'use client';

import { RotateCcw } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

import { isAdjustmentSignal } from '@/components/chat/adjustment-signal';

import {
  SWITCH_CHIP_KEEP,
  SWITCH_CHIP_NEW,
  type PendingSwitch,
} from '@/types/switch-dialog';

import { CampaignHeader } from '@/components/chat/CampaignHeader';
import { ChatBubble } from '@/components/chat/ChatBubble';
import { ChatChips } from '@/components/chat/ChatChips';
import { ChatInput } from '@/components/chat/ChatInput';
import { FieldChecklist } from '@/components/chat/FieldChecklist';
import { TypingDots } from '@/components/chat/TypingDots';
import { IsolatedCriteriaChecklist } from '@/components/chat/IsolatedCriteriaChecklist';
import { ValidateFDPButton } from '@/components/chat/ValidateFDPButton';
import { ValidateIsolatedCriteriaButton } from '@/components/chat/ValidateIsolatedCriteriaButton';
import { getAvatarColor, getAvatarUrl } from '@/lib/agents/avatar-colors';
import { fdpToCVCriteria } from '@/lib/agents/fdp-to-criteria';
import {
  postIsolatedManagerChat,
  postManagerChat,
  postTranscribe,
} from '@/lib/chat/api-client';
import {
  chooseExistingCampaign,
  chooseRouteExisting,
  chooseRouteIsolated,
  chooseRouteNewCampaign,
  consumeNewCampaignName,
  dispatchCVBatch,
  dispatchCVRouting,
  dispatchIsolatedCVBatch,
  dispatchJobWriter,
  findPendingByResolvedId,
  newCampaignFullSetup,
  newCampaignSkipSetup,
} from '@/lib/chat/manager-flow';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/stores/agents-store';
import { useArtifactsStore } from '@/stores/artifacts-store';
import { useCampaignsStore } from '@/stores/campaigns-store';
import {
  selectMessages,
  useChatStore,
  type ChatMessage,
} from '@/stores/chat-store';
import { useFdpStore } from '@/stores/fdp-store';
import { useIsolatedCriteriaStore } from '@/stores/isolated-criteria-store';
import {
  type CVAnalysisCriteria,
  DEFAULT_CV_THRESHOLD,
} from '@/types/cv-analysis';
import {
  FIELD_KEYS,
  type FDPInProgress,
} from '@/types/field-collection';
import {
  ISOLATED_CRITERIA_KEYS,
  type IsolatedCriteriaInProgress,
  type IsolatedCriteriaKey,
} from '@/types/isolated-criteria';

const MANAGER_ID = 'agent.manager-rh';

function countMissing(fdp: FDPInProgress): number {
  return FIELD_KEYS.filter((k) => fdp.fields[k]?.status !== 'filled').length;
}

function countMissingIsolated(criteria: IsolatedCriteriaInProgress): number {
  return ISOLATED_CRITERIA_KEYS.filter(
    (k) => criteria.fields[k]?.status !== 'filled',
  ).length;
}

/**
 * Récupère le contenu textuel du DERNIER message DRH dans le tableau.
 * Utilisé sur switch confirmé pour re-seeder le chat reset avec
 * l'intention qui a déclenché la bascule (« en fait je veux un
 * développeur python »), sinon le LLM tomberait sur un greeting nu.
 */
function findLastUserContent(
  messages: ReadonlyArray<{ role: string; content: string }>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && m.content.trim().length > 0) return m.content;
  }
  return null;
}

function buildIsolatedCriteriaPayload(
  criteria: IsolatedCriteriaInProgress,
): CVAnalysisCriteria {
  const out: CVAnalysisCriteria = {};
  const get = (k: IsolatedCriteriaKey): unknown => criteria.fields[k]?.value;
  const jobTitle = get('job_title');
  const seniority = get('seniority');
  const skills = get('key_skills');
  const exp = get('experience_years');
  if (typeof jobTitle === 'string' && jobTitle.trim().length > 0) {
    out.jobTitle = jobTitle.trim();
  }
  if (typeof seniority === 'string' && seniority.trim().length > 0) {
    out.seniority = seniority.trim();
  }
  if (Array.isArray(skills) && skills.length > 0) {
    out.keySkills = skills
      .map((s) => (typeof s === 'string' ? s : ''))
      .filter((s) => s.length > 0);
  }
  if (typeof exp === 'number' && Number.isFinite(exp) && exp >= 0) {
    out.experienceYears = exp;
  }
  return out;
}

export function ManagerChat() {
  const messages = useChatStore(selectMessages);
  const isSending = useChatStore((s) => s.isSending);
  const isTranscribing = useChatStore((s) => s.isTranscribing);
  const error = useChatStore((s) => s.error);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const setSending = useChatStore((s) => s.setSending);
  const setTranscribing = useChatStore((s) => s.setTranscribing);
  const setError = useChatStore((s) => s.setError);
  const dismissLastManagerChips = useChatStore(
    (s) => s.dismissLastManagerChips,
  );
  const resetChat = useChatStore((s) => s.reset);

  const [inputFocusToken, setInputFocusToken] = useState(0);
  const [isAgentBusy, setAgentBusy] = useState(false);
  const [openFirstMissingToken, setOpenFirstMissingToken] = useState(0);
  const [
    openFirstMissingIsolatedToken,
    setOpenFirstMissingIsolatedToken,
  ] = useState(0);

  const fdp = useFdpStore((s) => s.fdp);
  const createFDP = useFdpStore((s) => s.createFDP);
  const applyExtractions = useFdpStore((s) => s.applyExtractions);
  const validateFDP = useFdpStore((s) => s.validateFDP);
  const resetFdp = useFdpStore((s) => s.reset);
  const resetArtifacts = useArtifactsStore((s) => s.reset);
  const addCampaign = useCampaignsStore((s) => s.addCampaign);
  const resetCampaigns = useCampaignsStore((s) => s.reset);
  const isolatedCriteria = useIsolatedCriteriaStore((s) => s.criteria);
  const applyIsolatedExtractions = useIsolatedCriteriaStore(
    (s) => s.applyExtractions,
  );
  const validateIsolated = useIsolatedCriteriaStore((s) => s.validate);
  const resetIsolated = useIsolatedCriteriaStore((s) => s.reset);
  const resetAgents = useAgentsStore((s) => s.resetToRegistry);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  /**
   * Switch déterministe (sub-phase 1.3) : payload renvoyé par le serveur
   * quand le DRH ouvre un nouveau poste alors qu'une campagne en cours
   * (draft ou validée) existe. handleChipSelect le consomme pour soit
   * archiver + créer une nouvelle FDP, soit conserver l'actuelle.
   */
  const pendingSwitchRef = useRef<PendingSwitch | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, isSending, isTranscribing]);

  function handleReset() {
    resetChat();
    resetFdp();
    resetArtifacts();
    resetCampaigns();
    resetIsolated();
    resetAgents();
  }

  async function handleValidateFDP() {
    const current = useFdpStore.getState().fdp;
    if (!current || !current.isComplete || current.isValidated) return;
    validateFDP();
    const validated = useFdpStore.getState().fdp;
    if (!validated) return;
    // On enregistre la campagne dans le store actif AVANT de
    // dispatcher : si dispatchJobWriter émet un message d'attente, le
    // DRH peut déjà voir cette campagne dans un éventuel CV upload
    // ultérieur.
    addCampaign({ fdp: validated });
    setAgentBusy(true);
    try {
      await dispatchJobWriter(validated);
    } finally {
      setAgentBusy(false);
    }
  }

  async function handleValidateIsolated() {
    const current = useIsolatedCriteriaStore.getState().criteria;
    if (!current || !current.isComplete || current.isValidated) return;
    validateIsolated();
    const pending = findPendingByResolvedId(current.taskId);
    if (!pending) return;
    const pendingId = pending.pendingId;
    const criteria = buildIsolatedCriteriaPayload(current);
    setAgentBusy(true);
    try {
      await dispatchIsolatedCVBatch({ pendingId, criteria });
    } finally {
      setAgentBusy(false);
    }
  }

  function handleSourcePick(source: 'manuel') {
    if (source !== 'manuel') return;
    const last = [...useChatStore.getState().messages]
      .reverse()
      .find((m) => m.block?.kind === 'source-picker');
    if (last && last.block?.kind === 'source-picker') {
      updateMessage(last.id, {
        block: { kind: 'source-picker', selected: 'manuel' },
      });
    }
    appendMessage({
      role: 'user',
      source: 'text',
      content: 'Source : manuel.',
    });
    appendMessage({
      role: 'manager',
      source: 'text',
      content:
        "Parfait. Utilisez le trombone ci-dessous pour me téléverser un ou plusieurs CV — j'enchaîne dès qu'ils arrivent.",
    });
  }

  async function handleFilesSelected(files: File[]) {
    if (files.length === 0 || isAgentBusy) return;
    const current = useFdpStore.getState().fdp;
    const sourceSelected = lastSourcePickerSelected();

    // Cas 1 — campagne validée + source "Manuel" déjà choisie : on
    // analyse direct avec les critères de la campagne courante (pas
    // de routing question, c'est implicite).
    if (current?.isValidated && sourceSelected === 'manuel') {
      const userBubble =
        files.length === 1
          ? `J'ai joint un CV : ${files[0].name}.`
          : `J'ai joint ${files.length} CV : ${files.map((f) => f.name).join(', ')}.`;
      appendMessage({ role: 'user', source: 'text', content: userBubble });
      setAgentBusy(true);
      try {
        await dispatchCVBatch({
          files,
          criteria: fdpToCVCriteria(current),
          threshold: DEFAULT_CV_THRESHOLD,
          campaignId: current.campaignId,
        });
      } finally {
        setAgentBusy(false);
      }
      return;
    }

    // Cas 2 — tous les autres cas : on demande explicitement à quoi
    // rattacher ces CV via le route-picker (nouvelle / existante / isolée).
    dispatchCVRouting(files);
  }

  function handleRoutePick(
    pendingId: string,
    route: 'new' | 'existing' | 'isolated',
  ) {
    if (isAgentBusy || isSending || isTranscribing) return;
    if (route === 'isolated') {
      chooseRouteIsolated(pendingId);
    } else if (route === 'existing') {
      chooseRouteExisting(pendingId);
    } else {
      chooseRouteNewCampaign(pendingId);
    }
  }

  async function handleCampaignPick(pendingId: string, campaignId: string) {
    if (isAgentBusy || isSending || isTranscribing) return;
    setAgentBusy(true);
    try {
      await chooseExistingCampaign(pendingId, campaignId);
    } finally {
      setAgentBusy(false);
    }
  }

  function lastSourcePickerSelected(): 'manuel' | null {
    const list = useChatStore.getState().messages;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.block?.kind === 'source-picker') {
        return m.block.selected;
      }
    }
    return null;
  }

  async function sendToManager(history: ChatMessage[]) {
    setSending(true);
    setError(null);
    try {
      const turns = history
        .filter((m) => m.role === 'user' || m.role === 'manager')
        .map((m) => ({
          role: m.role as 'user' | 'manager',
          content: m.content,
        }));
      const result = await postManagerChat({
        messages: turns,
        fdp: useFdpStore.getState().fdp,
      });

      if (result.campaignId && !useFdpStore.getState().fdp) {
        createFDP(result.campaignId);
      }
      if (result.response.fieldExtractions) {
        applyExtractions(result.response.fieldExtractions);
      }

      // Si le serveur a renvoyé un dialogue de switch, on stocke le
      // payload pour que handleChipSelect puisse l'exploiter au clic.
      // Le payload reste valide tant qu'un nouveau tour Manager n'est
      // pas posté (auquel cas il sera écrasé ou réinitialisé).
      pendingSwitchRef.current = result.pendingSwitch;

      appendMessage({
        role: 'manager',
        source: 'text',
        content: result.response.message,
        chips: result.response.chips,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur Manager.');
    } finally {
      setSending(false);
    }
  }

  async function sendToManagerIsolated(
    history: ChatMessage[],
    criteria: IsolatedCriteriaInProgress,
  ) {
    setSending(true);
    setError(null);
    try {
      const turns = history
        .filter((m) => m.role === 'user' || m.role === 'manager')
        .map((m) => ({
          role: m.role as 'user' | 'manager',
          content: m.content,
        }));
      const result = await postIsolatedManagerChat({
        messages: turns,
        criteria,
      });
      if (result.response.fieldExtractions) {
        applyIsolatedExtractions(result.response.fieldExtractions);
      }
      appendMessage({
        role: 'manager',
        source: 'text',
        content: result.response.message,
        chips: result.response.chips,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur Manager.');
    } finally {
      setSending(false);
    }
  }

  async function handleSendText(
    text: string,
    source: 'text' | 'voice' = 'text',
  ) {
    // On commence TOUJOURS par afficher la bulle DRH avant de router
    // vers les sous-flows : sinon, des handlers comme
    // consumeNewCampaignName (qui posent une réponse Manager
    // immédiate) inversent visuellement l'ordre des bulles et cassent
    // la position des chips (qui ne s'affichent que sur la DERNIÈRE
    // bulle Manager).
    appendMessage({ role: 'user', source, content: text });

    // Cas A : on attend un nom de nouvelle campagne. Pas de tour LLM,
    // c'est la fonction de consume qui poste la suite.
    if (consumeNewCampaignName(text)) return;

    // Cas B : pré-collecte critères isolés via endpoint dédié.
    const isoActive = useIsolatedCriteriaStore.getState().criteria;
    if (isoActive && !isoActive.isValidated) {
      void sendToManagerIsolated(
        useChatStore.getState().messages,
        useIsolatedCriteriaStore.getState().criteria!,
      );
      return;
    }

    // Cas C : conversation normale Manager (collecte FDP, etc.).
    void sendToManager(useChatStore.getState().messages);
  }

  function handleChipSelect(option: string) {
    if (isSending || isTranscribing) return;
    if (isAdjustmentSignal(option)) {
      // Pas de tour LLM : le DRH veut juste reprendre la main.
      dismissLastManagerChips();
      setInputFocusToken((token) => token + 1);
      return;
    }
    // Interception du dialogue de switch déterministe (sub-phase 1.3).
    // Les libellés sont les constantes exportées par manager.ts pour
    // garder le couplage explicite. Hors d'un dialogue de switch
    // (pendingSwitchRef null), on laisse passer les libellés en bulle
    // utilisateur normale — l'utilisateur peut très bien dire « Oui,
    // nouvelle campagne » dans un autre contexte.
    const pendingSwitch = pendingSwitchRef.current;
    if (pendingSwitch && (option === SWITCH_CHIP_NEW || option === SWITCH_CHIP_KEEP)) {
      pendingSwitchRef.current = null;
      void handleSwitchDialogChoice(pendingSwitch, option);
      return;
    }
    // Interception des chips de la nouvelle campagne après nom donné.
    if (option === "Juste l'analyse CV pour l'instant") {
      if (newCampaignSkipSetup()) return;
    }
    if (option === 'Cadrer la fiche complète') {
      const choice = newCampaignFullSetup();
      if (choice) {
        // Bascule vers la collecte FDP normale : on instancie une FDP
        // vide sous le campaignId déjà créé, puis on déclenche un tour
        // LLM Manager qui se chargera de poser la première question
        // (avec l'état FDP "tous champs vides" en contexte). Pas de
        // message Manager codé en dur — c'est ce qui faisait diverger
        // le LLM au tour suivant.
        // Limite Session 4 : les CV uploadés ne sont pas re-attachés
        // automatiquement après validation FDP — le DRH les ré-upload
        // via le source-picker. À améliorer en Session 5.
        if (!useFdpStore.getState().fdp) {
          createFDP(choice.campaignId);
        }
        appendMessage({
          role: 'user',
          source: 'text',
          content: `Cadrer la fiche complète pour ${choice.campaignId}.`,
        });
        void sendToManager(useChatStore.getState().messages);
        return;
      }
    }
    void handleSendText(option, 'text');
  }

  /**
   * Consomme le clic sur un chip du dialogue de switch déterministe.
   *
   *   - SWITCH_CHIP_NEW  : on archive la FDP courante dans
   *                        campaigns-store (qu'elle soit draft ou
   *                        validée — campaigns-store accepte les deux),
   *                        puis on WIPE intégralement le chat, la FDP
   *                        et les critères isolés pour repartir d'un
   *                        fil propre. Le dernier message DRH avant
   *                        le chip est réinjecté comme seed pour
   *                        conserver son intention. Le tour Manager
   *                        suivant démarre la collecte sur la nouvelle
   *                        campagne sans pollution de contexte.
   *                        Cf. memory/feedback_chat_reset_on_switch.md.
   *   - SWITCH_CHIP_KEEP : on dismiss simplement le dialogue. La FDP
   *                        courante reste active. On relance UN tour
   *                        Manager pour qu'il revienne sur la collecte
   *                        en cours et reformule sa dernière question.
   */
  async function handleSwitchDialogChoice(
    pending: PendingSwitch,
    option: typeof SWITCH_CHIP_NEW | typeof SWITCH_CHIP_KEEP,
  ): Promise<void> {
    if (option === SWITCH_CHIP_KEEP) {
      // Branche simple : on poste le chip comme bulle user et on
      // relance un tour pour reprendre la collecte courante.
      appendMessage({ role: 'user', source: 'text', content: option });
      void sendToManager(useChatStore.getState().messages);
      return;
    }

    // SWITCH_CHIP_NEW — wipe complet du chat avec seed du dernier
    // message user (l'intention qui a déclenché la bascule).
    const seedUserMessage = findLastUserContent(
      useChatStore.getState().messages,
    );

    const currentFdp = useFdpStore.getState().fdp;
    if (currentFdp) {
      // L'archive précède le reset : le snapshot de la FDP (draft ou
      // validée) reste dans campaigns-store, ré-affichable via le
      // futur sélecteur de campagne (sub-phase 1.4).
      addCampaign({ fdp: currentFdp });
    }

    // Reset chat + FDP + isolated criteria (artifacts-store reste
    // intact : les annonces/rapports déjà produits doivent rester
    // accessibles par campagne archivée). campaigns-store reste aussi
    // intact, sinon on perd l'archive qu'on vient juste de poser.
    resetChat();
    resetFdp();
    resetIsolated();
    createFDP(pending.proposedCampaignId);

    if (seedUserMessage) {
      appendMessage({
        role: 'user',
        source: 'text',
        content: seedUserMessage,
      });
    }

    void sendToManager(useChatStore.getState().messages);
  }

  async function handleTranscribe(audio: File): Promise<string> {
    setTranscribing(true);
    setError(null);
    try {
      return await postTranscribe(audio);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erreur transcription.';
      setError(message);
      throw err;
    } finally {
      setTranscribing(false);
    }
  }

  return (
    <div className="h-full w-full flex flex-col">
      <ChatHeader onReset={handleReset} />
      {fdp ? (
        <>
          <CampaignHeader campaignId={fdp.campaignId} />
          <FieldChecklist
            fdp={fdp}
            defaultCollapsed={fdp.campaignId.startsWith('TASK-')}
            editingDisabled={
              fdp.isValidated || isSending || isTranscribing || isAgentBusy
            }
            openFirstMissingToken={openFirstMissingToken}
          />
        </>
      ) : null}

      {isolatedCriteria && !fdp ? (
        <>
          <CampaignHeader campaignId={isolatedCriteria.taskId} />
          <IsolatedCriteriaChecklist
            criteria={isolatedCriteria}
            editingDisabled={
              isolatedCriteria.isValidated ||
              isSending ||
              isTranscribing ||
              isAgentBusy
            }
            openFirstMissingToken={openFirstMissingIsolatedToken}
          />
        </>
      ) : null}

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-4 py-5 space-y-4"
      >
        {messages.map((message, index) => {
          const isLast = index === messages.length - 1;
          const showBelow =
            isLast &&
            message.role === 'manager' &&
            message.chips?.placement === 'below_bubble' &&
            !isSending &&
            !isTranscribing;
          return (
            <div key={message.id}>
              <ChatBubble
                message={message}
                onChipSelect={handleChipSelect}
                chipsDisabled={isSending || isTranscribing || isAgentBusy}
                onSourcePick={handleSourcePick}
                onRoutePick={handleRoutePick}
                onCampaignPick={handleCampaignPick}
                blocksDisabled={isSending || isTranscribing || isAgentBusy}
              />
              {showBelow && message.chips ? (
                <ChatChips
                  chips={message.chips}
                  onSelect={handleChipSelect}
                  disabled={isSending || isTranscribing || isAgentBusy}
                />
              ) : null}
            </div>
          );
        })}
        {isSending ? <TypingPreview /> : null}
        {error ? (
          <p className="font-body text-[11.5px] text-red-600 px-1">{error}</p>
        ) : null}
      </div>

      {(() => {
        const last = messages[messages.length - 1];
        if (
          !last ||
          last.role !== 'manager' ||
          last.chips?.placement !== 'above_input' ||
          isSending ||
          isTranscribing
        )
          return null;
        return (
          <ChatChips
            chips={last.chips}
            onSelect={handleChipSelect}
            disabled={isSending || isTranscribing}
          />
        );
      })()}

      {fdp ? (
        <ValidateFDPButton
          campaignId={fdp.campaignId}
          isComplete={fdp.isComplete}
          isValidated={fdp.isValidated}
          disabled={isSending || isTranscribing || isAgentBusy}
          onValidate={handleValidateFDP}
          missingCount={countMissing(fdp)}
          onRequestComplete={() =>
            setOpenFirstMissingToken((t) => t + 1)
          }
        />
      ) : null}

      {isolatedCriteria && !fdp ? (
        <ValidateIsolatedCriteriaButton
          taskId={isolatedCriteria.taskId}
          isComplete={isolatedCriteria.isComplete}
          isValidated={isolatedCriteria.isValidated}
          disabled={isSending || isTranscribing || isAgentBusy}
          onValidate={handleValidateIsolated}
          missingCount={countMissingIsolated(isolatedCriteria)}
          onRequestComplete={() =>
            setOpenFirstMissingIsolatedToken((t) => t + 1)
          }
        />
      ) : null}

      <ChatInput
        disabled={isSending || isTranscribing || isAgentBusy}
        onSendText={handleSendText}
        onTranscribe={handleTranscribe}
        focusToken={inputFocusToken}
        onFilesSelected={handleFilesSelected}
      />
    </div>
  );
}

function ChatHeader({ onReset }: { onReset: () => void }) {
  const url = getAvatarUrl(MANAGER_ID);
  const color = getAvatarColor(MANAGER_ID);
  return (
    <header
      className="relative flex items-center justify-between gap-3 px-4 py-3.5 border-b border-stone-200 text-white"
      style={{
        background: `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)`,
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="relative h-11 w-11 shrink-0 rounded-full overflow-hidden ring-2 ring-white/80 shadow-md"
          style={{ backgroundColor: color }}
        >
          {url ? (
            <Image
              src={url}
              alt="Manager RH"
              fill
              sizes="44px"
              className="object-cover"
            />
          ) : null}
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-white"
            aria-hidden
          />
        </div>
        <div className="min-w-0">
          <p className="font-display text-[10px] uppercase tracking-[0.22em] text-white/70 font-medium">
            Conversation
          </p>
          <h2 className="font-display text-[15px] font-semibold leading-tight">
            Manager RH
          </h2>
          <p className="font-body text-[10.5px] text-white/80 mt-0.5 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden />
            En ligne · prêt à cadrer une demande
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <HeaderIconButton
          ariaLabel="Réinitialiser la conversation"
          onClick={onReset}
        >
          <RotateCcw className="h-4 w-4" />
        </HeaderIconButton>
      </div>
    </header>
  );
}

function HeaderIconButton({
  ariaLabel,
  onClick,
  children,
}: {
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'h-8 w-8 grid place-items-center rounded-lg text-white/85',
        'hover:bg-white/15 hover:text-white transition-colors',
      )}
    >
      {children}
    </button>
  );
}

function TypingPreview() {
  const url = getAvatarUrl(MANAGER_ID);
  const color = getAvatarColor(MANAGER_ID);
  return (
    <div className="chat-msg-rise flex items-end gap-2.5">
      <div
        className="relative h-8 w-8 shrink-0 rounded-full overflow-hidden ring-2 ring-white shadow-sm"
        style={{ backgroundColor: color }}
      >
        {url ? (
          <Image
            src={url}
            alt="Manager RH"
            fill
            sizes="32px"
            className="object-cover"
          />
        ) : null}
      </div>
      <div className="flex flex-col items-start max-w-[78%]">
        <span
          className="font-display text-[11px] font-semibold mb-1 px-1"
          style={{ color }}
        >
          Manager RH
        </span>
        <div
          className="bg-white border border-stone-200 border-l-[3px] rounded-2xl rounded-bl-md px-4 py-3 shadow-sm"
          style={{ borderLeftColor: color }}
        >
          <TypingDots color={color} />
        </div>
      </div>
    </div>
  );
}
