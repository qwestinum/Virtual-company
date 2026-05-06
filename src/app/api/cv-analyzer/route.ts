import { NextResponse } from 'next/server';

import { CVExtractError, extractCVText } from '@/lib/agents/cv-extract';
import {
  CVAnalyzerError,
  executeCVAnalyzer,
} from '@/lib/agents/server/cv-analyzer-execute';
import { AIProviderError } from '@/lib/ai/errors';
import {
  CVAnalysisCriteriaSchema,
  CVAnalysisResultSchema,
  DEFAULT_CV_THRESHOLD,
} from '@/types/cv-analysis';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Form data invalide.',
      },
      { status: 400 },
    );
  }

  const file = form.get('cv');
  const criteriaRaw = form.get('criteria');
  const thresholdRaw = form.get('threshold');
  const taskIdRaw = form.get('taskId');
  const campaignIdRaw = form.get('campaignId');

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Champ "cv" manquant.' },
      { status: 400 },
    );
  }

  let criteria;
  try {
    const parsed = criteriaRaw ? JSON.parse(String(criteriaRaw)) : {};
    criteria = CVAnalysisCriteriaSchema.parse(parsed);
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Critères invalides.',
      },
      { status: 400 },
    );
  }

  const threshold = (() => {
    const n = thresholdRaw ? Number(thresholdRaw) : NaN;
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
    return DEFAULT_CV_THRESHOLD;
  })();

  const taskId =
    typeof taskIdRaw === 'string' && taskIdRaw.length > 0
      ? taskIdRaw
      : `task_${Date.now().toString(36)}`;
  const campaignId =
    typeof campaignIdRaw === 'string' && campaignIdRaw.length > 0
      ? campaignIdRaw
      : undefined;

  try {
    const extracted = await extractCVText(file);
    const output = await executeCVAnalyzer({
      taskId,
      correlationId: taskId,
      agentId: 'agent.cv-analyzer',
      payload: {
        cvText: extracted.text,
        fileName: extracted.fileName,
        criteria,
        threshold,
      },
      context: {
        campaignId,
        priority: 'normal',
        requestedBy: 'agent.manager-rh',
      },
    });

    const result = CVAnalysisResultSchema.parse(output.data.result);
    return NextResponse.json({
      result,
      threshold,
      metrics: output.metrics,
    });
  } catch (err) {
    if (err instanceof CVExtractError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 422 },
      );
    }
    if (err instanceof CVAnalyzerError) {
      const status = err.code === 'empty_cv' ? 422 : 502;
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status },
      );
    }
    if (err instanceof AIProviderError) {
      const status = err.code === 'config_missing' ? 500 : 502;
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status },
      );
    }
    return NextResponse.json(
      {
        error: 'unexpected_error',
        message: err instanceof Error ? err.message : 'Unexpected error.',
      },
      { status: 500 },
    );
  }
}
