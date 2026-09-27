/**
 * Instrumentation TEMPORAIRE de diagnostic de latence (14/09/2026).
 *
 * Activée UNIQUEMENT par `PERF_TRACE=1` (appel depuis `instrumentation.ts`) ;
 * absente, rien n'est patché et ce module n'est même pas chargé. À RETIRER à
 * la fin du diagnostic.
 *
 * Principe, sans toucher aux routes :
 *  - chaque requête HTTP entrante ouvre un contexte `AsyncLocalStorage`
 *    (patch de `http.Server.prototype.emit('request')`) ;
 *  - `fetch` global est enveloppé : chaque appel sortant est classé (auth,
 *    base, stockage, LLM, email, Exa, autre) et accumulé dans le contexte ;
 *  - à la fin de la réponse : une ligne JSON `[perf]` (stdout + fichier
 *    optionnel `PERF_TRACE_FILE`) et un en-tête `Server-Timing` lisible dans
 *    l'onglet Réseau du navigateur.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync } from 'node:fs';
import http from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';

type IoKind = 'auth' | 'db' | 'storage' | 'llm' | 'email' | 'exa' | 'other';

interface IoCall {
  kind: IoKind;
  label: string;
  start: number;
  dur: number;
  status: number;
  range?: string;
}

interface RequestTrace {
  method: string;
  url: string;
  t0: number;
  proxyMs?: number;
  calls: IoCall[];
}

const store = new AsyncLocalStorage<RequestTrace>();
const background = { n: 0, ms: 0, byLabel: new Map<string, number>() };

function classify(rawUrl: string): { kind: IoKind; label: string } {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { kind: 'other', label: rawUrl.slice(0, 60) };
  }
  const host = u.hostname;
  if (host.endsWith('.supabase.co')) {
    const p = u.pathname;
    if (p.startsWith('/auth/v1/')) return { kind: 'auth', label: p.slice(9) };
    if (p.startsWith('/rest/v1/rpc/')) return { kind: 'db', label: `rpc:${p.slice(13)}` };
    if (p.startsWith('/rest/v1/')) return { kind: 'db', label: p.slice(9) };
    if (p.startsWith('/storage/v1/')) return { kind: 'storage', label: p.slice(12, 60) };
    return { kind: 'other', label: `supabase:${p}` };
  }
  if (host.includes('openai.com') || host.includes('anthropic.com')) return { kind: 'llm', label: host };
  if (host.includes('resend.com')) return { kind: 'email', label: host };
  if (host.includes('exa.ai')) return { kind: 'exa', label: host };
  return { kind: 'other', label: host };
}

/** Durée cumulée de l'union des intervalles — le temps « mur » réellement attendu. */
function unionMs(calls: IoCall[]): number {
  const iv = calls.map((c) => [c.start, c.start + c.dur]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: number[] | null = null;
  for (const i of iv) {
    if (!cur || i[0] > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [i[0], i[1]];
    } else cur[1] = Math.max(cur[1], i[1]);
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}

function summarize(t: RequestTrace, status: number) {
  const total = performance.now() - t.t0;
  const by = (k: IoKind) => t.calls.filter((c) => c.kind === k);
  const agg = (k: IoKind) => {
    const cs = by(k);
    return { n: cs.length, sum: Math.round(cs.reduce((s, c) => s + c.dur, 0)), wall: Math.round(unionMs(cs)) };
  };
  const ioWall = unionMs(t.calls);
  return {
    method: t.method,
    url: t.url,
    status,
    totalMs: Math.round(total),
    proxyMs: t.proxyMs === undefined ? null : Math.round(t.proxyMs),
    auth: agg('auth'),
    db: agg('db'),
    storage: agg('storage'),
    llm: agg('llm'),
    email: agg('email'),
    exa: agg('exa'),
    other: agg('other'),
    ioWallMs: Math.round(ioWall),
    nonIoMs: Math.round(total - ioWall),
    calls: t.calls
      .sort((a, b) => a.start - b.start)
      .map((c) => ({ k: c.kind, l: c.label, at: Math.round(c.start), ms: Math.round(c.dur), s: c.status, r: c.range })),
  };
}

function emitLine(obj: unknown): void {
  const line = JSON.stringify(obj);
  console.log(`[perf] ${line}`);
  const file = process.env.PERF_TRACE_FILE;
  if (file) {
    try {
      appendFileSync(file, `${line}\n`);
    } catch {
      /* diagnostic best-effort */
    }
  }
}

function shouldTrace(url: string): boolean {
  return !url.startsWith('/_next/') && !/\.(png|jpg|jpeg|svg|webp|ico|woff2?|css|js|map)(\?|$)/.test(url);
}

export function installRequestTrace(): void {
  const g = globalThis as { __perfTraceInstalled__?: boolean; __perfMarkProxy__?: (ms: number) => void };
  if (g.__perfTraceInstalled__) return;
  g.__perfTraceInstalled__ = true;

  g.__perfMarkProxy__ = (ms: number) => {
    const t = store.getStore();
    if (t) t.proxyMs = (t.proxyMs ?? 0) + ms;
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async function tracedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const t = store.getStore();
    const start = performance.now();
    const { kind, label } = classify(rawUrl);
    let status = 0;
    let range: string | undefined;
    try {
      const res = await origFetch(input, init);
      status = res.status;
      range = res.headers.get('content-range') ?? undefined;
      return res;
    } finally {
      const dur = performance.now() - start;
      if (t) t.calls.push({ kind, label, start: start - t.t0, dur, status, range });
      else if (kind !== 'other' || !rawUrl.includes('localhost')) {
        background.n += 1;
        background.ms += dur;
        background.byLabel.set(`${kind}:${label}`, (background.byLabel.get(`${kind}:${label}`) ?? 0) + 1);
      }
    }
  } as typeof fetch;

  const origEmit = http.Server.prototype.emit as (this: http.Server, event: string, ...a: unknown[]) => boolean;
  http.Server.prototype.emit = function patchedEmit(this: http.Server, event: string, ...args: unknown[]) {
    if (event !== 'request') return origEmit.call(this, event, ...args);
    const req = args[0] as http.IncomingMessage;
    const res = args[1] as http.ServerResponse;
    const url = req.url ?? '';
    if (!shouldTrace(url)) return origEmit.call(this, event, ...args);

    const trace: RequestTrace = { method: req.method ?? 'GET', url, t0: performance.now(), calls: [] };
    const origWriteHead = res.writeHead;
    res.writeHead = function patchedWriteHead(this: http.ServerResponse, ...wh: unknown[]) {
      try {
        const s = summarize({ ...trace, calls: [...trace.calls] }, 0);
        this.setHeader(
          'Server-Timing',
          [
            `total;dur=${s.totalMs}`,
            `proxy;dur=${s.proxyMs ?? 0}`,
            `auth;dur=${s.auth.wall};desc="n=${s.auth.n}"`,
            `db;dur=${s.db.wall};desc="n=${s.db.n} sum=${s.db.sum}"`,
            `ext;dur=${s.llm.wall + s.email.wall + s.exa.wall + s.other.wall}`,
            `nonio;dur=${s.nonIoMs}`,
          ].join(', '),
        );
      } catch {
        /* en-têtes déjà partis */
      }
      return (origWriteHead as (...a: unknown[]) => http.ServerResponse).apply(this, wh);
    } as typeof res.writeHead;

    res.once('close', () => emitLine(summarize(trace, res.statusCode)));
    return store.run(trace, () => origEmit.call(this, event, ...args));
  } as typeof http.Server.prototype.emit;

  const eld = monitorEventLoopDelay({ resolution: 20 });
  eld.enable();
  setInterval(() => {
    emitLine({
      background: { fetches: background.n, ms: Math.round(background.ms), byLabel: Object.fromEntries(background.byLabel) },
      eventLoopDelayMs: { p50: Math.round(eld.percentile(50) / 1e6), p99: Math.round(eld.percentile(99) / 1e6), max: Math.round(eld.max / 1e6) },
    });
    background.n = 0;
    background.ms = 0;
    background.byLabel.clear();
    eld.reset();
  }, 60_000).unref();

  console.log('[perf] request tracing ENABLED (PERF_TRACE=1) — diagnostic temporaire');
}
