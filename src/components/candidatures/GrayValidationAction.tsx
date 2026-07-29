'use client';

/**
 * Action d'un gris « à valider » : retrouve la validation suspendue par uid et
 * rend la carte partagée (`ValidationCard` → decideGrayValidation). Extrait de
 * CandidatureActions (limite 200 lignes/fichier).
 */

import { useEffect, useState } from 'react';

import { ValidationCard } from '@/components/validations/ValidationCard';
import type { PendingValidation } from '@/types/hitl';
import type { CandidateListItem } from '@/types/reporting';

export function GrayValidationAction({
  item,
  onActed,
}: {
  item: CandidateListItem;
  onActed: () => void;
}) {
  const [validation, setValidation] = useState<PendingValidation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/validations', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as { validations?: PendingValidation[] };
        const match =
          json.validations?.find(
            (v) =>
              typeof v.payload?.uid === 'string' && v.payload.uid === item.uid,
          ) ?? null;
        if (!cancelled) setValidation(match);
      } catch {
        // silencieux
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.uid]);

  if (loading) {
    return (
      <p className="font-body text-[12px] text-stone-400">
        Chargement de la validation…
      </p>
    );
  }
  if (!validation) {
    return (
      <p className="font-body text-[12px] italic text-stone-400">
        Validation introuvable (déjà traitée ?).
      </p>
    );
  }
  return <ValidationCard v={validation} onSent={() => onActed()} />;
}
