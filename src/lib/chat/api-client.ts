import type { JobDescription } from '@/lib/storage/job-descriptions';
import type { FDPInProgress } from '@/types/field-collection';
import type { IntentClassification } from '@/types/intent';
import type { ManagerResponse } from '@/types/manager-response';

export type ManagerChatTurn = {
  role: 'user' | 'manager';
  content: string;
};

export type ManagerChatResult = {
  classification: IntentClassification;
  response: ManagerResponse;
  campaignId: string | null;
  preSearchHits: JobDescription[];
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
