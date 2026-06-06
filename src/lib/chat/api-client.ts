import type { JobDescription } from '@/lib/storage/job-descriptions';
import type {
  CVAnalysisCriteria,
  CVApplication,
} from '@/types/cv-analysis';
import type { FDPInProgress } from '@/types/field-collection';
import type { IntentClassification } from '@/types/intent';
import type { IsolatedCriteriaInProgress } from '@/types/isolated-criteria';
import type { JobAdResult } from '@/types/job-writer';
import type { PublicationChannel } from '@/types/publication-channel';
import type { ScoringCriterion } from '@/types/scoring';
import type {
  IsolatedManagerResponse,
  ManagerResponse,
} from '@/types/manager-response';
import type { PendingSwitch } from '@/types/switch-dialog';

export type ManagerChatTurn = {
  role: 'user' | 'manager';
  content: string;
};

export type ManagerChatResult = {
  classification: IntentClassification;
  response: ManagerResponse;
  campaignId: string | null;
  preSearchHits: JobDescription[];
  /**
   * Non null quand le serveur a détecté que le DRH ouvre un nouveau
   * poste alors qu'une FDP existante est encore en cours (draft ou
   * validée). Dans ce cas la response courante est un dialogue
   * déterministe avec chips ; le client gère la suite sur clic des
   * chips (archive + reset + nouvelle FDP, ou continuer sur la
   * campagne actuelle). Cf. ManagerChat.handleChipSelect.
   */
  pendingSwitch: PendingSwitch | null;
  metrics: {
    durationMs: number;
    tokensUsed: number;
    costEstimate: number;
  };
};

export type TranscribeResponse = {
  text: string;
};

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string; error?: string };
    return data.message ?? data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function postManagerChat(params: {
  messages: ManagerChatTurn[];
  fdp: FDPInProgress | null;
}): Promise<ManagerChatResult> {
  const res = await fetch('/api/manager/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: params.messages, fdp: params.fdp }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ManagerChatResult;
}

export async function postTranscribe(audio: File): Promise<string> {
  const form = new FormData();
  form.append('audio', audio);
  const res = await fetch('/api/transcribe', { method: 'POST', body: form });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as TranscribeResponse;
  return data.text;
}

export type JobWriterResult = {
  ad: JobAdResult;
  markdown: string;
  fileName: string;
  metrics: {
    durationMs: number;
    tokensUsed: number;
    costEstimate: number;
  };
};

export async function postJobWriter(params: {
  fdp: FDPInProgress;
  taskId?: string;
  channel?: PublicationChannel;
}): Promise<JobWriterResult> {
  const res = await fetch('/api/job-writer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as JobWriterResult;
}

export type ScoringProposalResult = {
  criteria: ScoringCriterion[];
  metrics: {
    durationMs: number;
    tokensUsed: number;
    costEstimate: number;
  };
};

/**
 * Phase 4.2 — demande au Manager de proposer une fiche de scoring à
 * partir d'une FDP validée. Le serveur dérive les poids depuis le
 * niveau (DEFAULT_WEIGHTS) ; le DRH ajuste ensuite via l'UI.
 */
export async function postManagerScoring(params: {
  fdp: FDPInProgress;
}): Promise<ScoringProposalResult> {
  const res = await fetch('/api/manager/scoring', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ScoringProposalResult;
}

export type CVAnalyzerResult = {
  application: CVApplication;
  threshold: number;
  metrics: {
    durationMs: number;
    tokensUsed: number;
    costEstimate: number;
  };
};

export type IsolatedManagerChatResult = {
  response: IsolatedManagerResponse;
  /**
   * Non null quand le serveur détecte en plein milieu d'une pré-collecte
   * isolated que le DRH bascule vers une nouvelle campagne/tâche FDP.
   * Le client traite ce payload comme dans le flow principal (cf.
   * ManagerChat.handleSwitchDialogChoice).
   */
  pendingSwitch: PendingSwitch | null;
  metrics: {
    durationMs: number;
    tokensUsed: number;
    costEstimate: number;
  };
};

export async function postIsolatedManagerChat(params: {
  messages: ManagerChatTurn[];
  criteria: IsolatedCriteriaInProgress;
}): Promise<IsolatedManagerChatResult> {
  const res = await fetch('/api/manager/isolated-criteria', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: params.messages,
      criteria: params.criteria,
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as IsolatedManagerChatResult;
}

export async function postCVAnalyzer(params: {
  file: File;
  criteria: CVAnalysisCriteria;
  threshold: number;
  taskId?: string;
  campaignId?: string;
}): Promise<CVAnalyzerResult> {
  const form = new FormData();
  form.append('cv', params.file);
  form.append('criteria', JSON.stringify(params.criteria));
  form.append('threshold', String(params.threshold));
  if (params.taskId) form.append('taskId', params.taskId);
  if (params.campaignId) form.append('campaignId', params.campaignId);
  const res = await fetch('/api/cv-analyzer', { method: 'POST', body: form });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as CVAnalyzerResult;
}
