import type { JobDescription } from '@/lib/storage/job-descriptions';
import type {
  CVAnalysisCriteria,
  CVAnalysisResult,
} from '@/types/cv-analysis';
import type { FDPInProgress } from '@/types/field-collection';
import type { IntentClassification } from '@/types/intent';
import type { IsolatedCriteriaInProgress } from '@/types/isolated-criteria';
import type { JobAdResult } from '@/types/job-writer';
import type {
  IsolatedManagerResponse,
  ManagerResponse,
} from '@/types/manager-response';

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
   * Vrai quand le DRH a basculé sur une nouvelle intention (campagne ou
   * tâche isolée) après une FDP déjà validée. Le client doit alors
   * reset la FDP courante et créer une FDP fraîche sous le `campaignId`
   * retourné (cf. ManagerChat.sendToManager).
   */
  switchIntent: boolean;
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
}): Promise<JobWriterResult> {
  const res = await fetch('/api/job-writer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as JobWriterResult;
}

export type CVAnalyzerResult = {
  result: CVAnalysisResult;
  threshold: number;
  metrics: {
    durationMs: number;
    tokensUsed: number;
    costEstimate: number;
  };
};

export type IsolatedManagerChatResult = {
  response: IsolatedManagerResponse;
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
