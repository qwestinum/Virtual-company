'use client';

/**
 * Dépôt multi-fichiers de CV dans le vivier (Session V1, spec §3.1 porte 1).
 *
 * Formats : PDF, TXT, MD. DOCX et autres ⇒ message explicite (jamais d'échec
 * silencieux). Chaque fichier traverse : extraction (serveur) → upsert par
 * email → indexation asynchrone. La file de traitement (store) reste visible
 * et survit au changement d'onglet ; quitter la page n'interrompt pas
 * l'indexation (poursuivie côté serveur).
 */

import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  UploadCloud,
} from 'lucide-react';
import { useRef, useState } from 'react';

import {
  useVivierUploadStore,
  type VivierUploadItem,
} from '@/stores/vivier-store';
import { buildUploadQueue } from '@/lib/vivier/upload-batch';

const ACCEPT = '.pdf,.txt,.md,application/pdf,text/plain,text/markdown';

export function VivierUpload({ onUploaded }: { onUploaded?: () => void }) {
  const uploads = useVivierUploadStore((s) => s.uploads);
  const enqueue = useVivierUploadStore((s) => s.enqueue);
  const patch = useVivierUploadStore((s) => s.patch);
  const clear = useVivierUploadStore((s) => s.clear);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;
    const batch = crypto.randomUUID().slice(0, 8);
    const meta = buildUploadQueue(files);
    const items: VivierUploadItem[] = meta.map((m, idx) => ({
      key: `${batch}:${idx}`,
      name: m.name,
      status: m.supported ? 'extracting' : 'unsupported',
      message: m.reason,
      candidateId: null,
      email: null,
    }));
    enqueue(items);

    const seen = new Set<string>();
    for (let idx = 0; idx < files.length; idx++) {
      if (!meta[idx]!.supported) continue;
      const key = items[idx]!.key;
      const fd = new FormData();
      fd.append('cv', files[idx]!);
      try {
        const res = await fetch('/api/vivier', { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          patch(key, {
            status: 'error',
            message: data.message ?? `Erreur (HTTP ${res.status}).`,
          });
          continue;
        }
        const email: string = data.email;
        const lower = email.toLowerCase();
        if (seen.has(lower)) {
          patch(key, {
            status: 'duplicate',
            message: `Doublon dans le lot — le dossier de ${email} a été mis à jour.`,
            candidateId: data.candidate.id,
            email,
          });
        } else {
          seen.add(lower);
          patch(key, {
            status: 'queued',
            message: data.created
              ? 'Dossier créé — indexation en cours.'
              : 'Dossier existant mis à jour — réindexation en cours.',
            candidateId: data.candidate.id,
            email,
          });
        }
      } catch (err) {
        patch(key, {
          status: 'error',
          message: err instanceof Error ? err.message : 'Erreur réseau.',
        });
      }
    }
    onUploaded?.();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    void handleFiles(Array.from(e.dataTransfer.files));
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragging
            ? 'border-amber-500 bg-amber-50'
            : 'border-stone-300 bg-white hover:border-stone-400'
        }`}
      >
        <UploadCloud className="h-8 w-8 text-stone-400" aria-hidden />
        <p className="font-body text-[14px] font-semibold text-stone-700">
          Déposez des CV ou cliquez pour parcourir
        </p>
        <p className="font-body text-[12px] text-stone-500">
          PDF, TXT ou MD — plusieurs fichiers acceptés
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          onChange={(e) => {
            const list = e.target.files;
            if (list) void handleFiles(Array.from(list));
            e.target.value = '';
          }}
          className="hidden"
        />
      </div>

      {uploads.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="font-body text-[12px] font-semibold uppercase tracking-wide text-stone-500">
              File de traitement
            </p>
            <button
              type="button"
              onClick={clear}
              className="font-body text-[12px] text-stone-500 hover:text-stone-700"
            >
              Effacer la liste
            </button>
          </div>
          <ul className="flex flex-col gap-1.5">
            {uploads.map((u) => (
              <UploadRow key={u.key} item={u} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function UploadRow({ item }: { item: VivierUploadItem }) {
  const tone =
    item.status === 'error' || item.status === 'unsupported'
      ? 'text-rose-600'
      : item.status === 'duplicate'
        ? 'text-amber-700'
        : item.status === 'queued'
          ? 'text-emerald-700'
          : 'text-stone-500';
  return (
    <li className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2">
      <StatusIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-body text-[13px] font-semibold text-stone-800">
          {item.name}
        </p>
        {item.message ? (
          <p className={`truncate font-body text-[12px] ${tone}`}>
            {item.message}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function StatusIcon({ status }: { status: VivierUploadItem['status'] }) {
  if (status === 'extracting') {
    return <Loader2 className="h-4 w-4 animate-spin text-stone-400" aria-hidden />;
  }
  if (status === 'queued') {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />;
  }
  if (status === 'duplicate') {
    return <Copy className="h-4 w-4 text-amber-600" aria-hidden />;
  }
  return <AlertCircle className="h-4 w-4 text-rose-500" aria-hidden />;
}
