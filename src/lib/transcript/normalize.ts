/**
 * Normalisation d'une transcription d'entretien — PURE, CLIENT-SAFE, testée.
 * Spec : docs/specs/compte-rendu-entretien.md §5.1, §5.2.
 *
 * Entrée : le texte brut tel que l'outil de visio l'exporte — WebVTT (Teams,
 * Meet, Zoom), SubRip (Zoom, Otter), texte (Otter, tl;dv, copier-coller), ou le
 * texte extrait d'un .docx / .pdf. Sortie : des TOURS de parole (locuteur,
 * horodatage du début, texte), les tours consécutifs d'un même locuteur
 * fusionnés.
 *
 * ⚠️ Ce module ne DEVINE pas qui est le candidat : il rend la liste des
 * locuteurs, et c'est l'humain qui désigne le candidat (§5.2). Une étiquette
 * de locuteur est un nom d'affichage (« iPhone de Marc ») — pas une identité.
 *
 * ⚠️ Ce module ne conserve rien : il transforme une chaîne en mémoire.
 */

export type TranscriptTurn = {
  speaker: string | null;
  /** Horodatage du début du tour (`hh:mm:ss`), `null` si le format n'en a pas. */
  at: string | null;
  text: string;
};

export type NormalizedTranscript = {
  turns: TranscriptTurn[];
  /** Locuteurs distincts, dans l'ordre d'apparition. */
  speakers: string[];
  /** Texte des tours seul (sans étiquettes) — la référence des citations. */
  plainText: string;
};

const TIMING_RE =
  /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})(?:[.,]\d{1,3})?\s*-->\s*(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?/u;
const VOICE_RE = /^<v(?:\.[^\s>]+)?\s+([^>]{1,80})>(.*?)(?:<\/v>)?\s*$/u;
/** « Jean Dupont   0:03 » (Otter, Teams .docx) — le texte suit sur les lignes suivantes. */
const HEADER_RE = /^(\S.{0,58}?)\s{2,}((?:\d{1,2}:)?\d{1,2}:\d{2})\s*$/u;
/** « [00:03] Jean Dupont : texte » ou « 00:03 Jean Dupont : texte ». */
const STAMPED_RE = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s+([^:]{1,60}?)\s*:\s+(.+)$/u;
/** « Jean Dupont : texte » — n'est une étiquette que si elle revient (voir `labelsThatRecur`). */
const LABEL_RE = /^([\p{L}][\p{L}\p{M}' .\-]{0,58}?)\s*:\s+(.+)$/u;

function toClock(stamp: string): string {
  const parts = stamp.split(':').map((p) => p.padStart(2, '0'));
  while (parts.length < 3) parts.unshift('00');
  return parts.join(':');
}

function clean(text: string): string {
  return text
    .replace(/<[^>]+>/gu, '')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Une ligne « Mot : texte » n'est une étiquette de locuteur que si elle fait au
 * plus quatre mots ET qu'elle REVIENT (au moins deux fois) — ou qu'elle ouvre
 * un repère de sous-titre, juste après son minutage (SRT/VTT Zoom). Sinon
 * « Remarque : je préfère… » deviendrait un locuteur.
 */
function labelsThatRecur(lines: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const m = LABEL_RE.exec(line.trim());
    if (!m) continue;
    const label = m[1]!.trim();
    if (!isShortLabel(label)) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n >= 2).map(([label]) => label));
}

function isShortLabel(label: string): boolean {
  return label.split(/\s+/u).length <= 4;
}

export function normalizeTranscript(raw: string): NormalizedTranscript {
  const lines = raw
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n')
    .split('\n');
  const recurring = labelsThatRecur(lines);
  const turns: TranscriptTurn[] = [];
  let speaker: string | null = null;
  let at: string | null = null;
  let inNote = false;
  let afterTiming = false;

  const push = (who: string | null, text: string) => {
    const t = clean(text);
    if (t === '') return;
    const last = turns[turns.length - 1];
    if (last && last.speaker === who) last.text = `${last.text} ${t}`;
    else turns.push({ speaker: who, at, text: t });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') {
      inNote = false;
      continue;
    }
    if (inNote) continue;
    if (i === 0 && /^WEBVTT/u.test(line)) {
      inNote = true; // l'en-tête et ses métadonnées vont jusqu'à la ligne vide
      continue;
    }
    if (/^(NOTE|STYLE|REGION)\b/u.test(line)) {
      inNote = true;
      continue;
    }
    const timing = TIMING_RE.exec(line);
    if (timing) {
      at = toClock(timing[1]!);
      afterTiming = true;
      continue;
    }
    const opensCue = afterTiming;
    afterTiming = false;
    // Identifiant de repère (numéro SRT, id VTT) : la ligne suivante est un minutage.
    const next = lines[i + 1]?.trim() ?? '';
    if (TIMING_RE.test(next)) continue;

    const voice = VOICE_RE.exec(line);
    if (voice) {
      speaker = clean(voice[1]!);
      push(speaker, voice[2]!);
      continue;
    }
    const header = HEADER_RE.exec(line);
    if (header) {
      speaker = clean(header[1]!);
      at = toClock(header[2]!);
      continue;
    }
    const stamped = STAMPED_RE.exec(line);
    if (stamped) {
      at = toClock(stamped[1]!);
      speaker = clean(stamped[2]!);
      push(speaker, stamped[3]!);
      continue;
    }
    const label = LABEL_RE.exec(line);
    if (label && (recurring.has(label[1]!.trim()) || (opensCue && isShortLabel(label[1]!.trim())))) {
      speaker = clean(label[1]!);
      push(speaker, label[2]!);
      continue;
    }
    push(speaker, line);
  }

  const speakers: string[] = [];
  for (const t of turns) {
    if (t.speaker && !speakers.includes(t.speaker)) speakers.push(t.speaker);
  }
  return { turns, speakers, plainText: turns.map((t) => t.text).join(' ') };
}

/** Rendu pour le modèle : une ligne par tour, étiquetée quand on le peut. */
export function renderTurns(turns: TranscriptTurn[]): string {
  return turns
    .map((t) => {
      const head = [t.at ? `[${t.at}]` : null, t.speaker ? `${t.speaker} :` : null]
        .filter(Boolean)
        .join(' ');
      return head ? `${head} ${t.text}` : t.text;
    })
    .join('\n');
}
