'use client';

/**
 * Sortie d'un écran terminal.
 *
 * `window.close()` ne fonctionne QUE sur une fenêtre ouverte par script : le
 * navigateur refuse — en silence — de fermer un onglet né d'un clic sur un
 * lien, ce qui est précisément notre cas puisque l'invité arrive depuis un
 * message. On ne peut donc pas promettre la fermeture ; on la TENTE, et si
 * l'onglet est toujours là au tick suivant, on remplace le bouton par ce
 * qu'il faut faire. Un bouton qui échoue en silence serait pire que pas de
 * bouton du tout : il ferait douter de tout le reste de l'écran.
 */
import { useState } from 'react';

import type { SchedulingLabels } from '../labels';

/** Délai avant de conclure à un refus. Court : c'est un aller-retour local. */
const REFUSAL_DELAY_MS = 250;

export function CloseButton({ labels }: { labels: SchedulingLabels }) {
  const [refused, setRefused] = useState(false);

  if (refused) {
    return (
      <p className="sched-note" style={{ marginTop: 14 }}>
        {labels.closeFallback}
      </p>
    );
  }

  return (
    <button
      type="button"
      className="sched-btn sched-btn--ghost"
      onClick={() => {
        window.close();
        // Si la fermeture avait abouti, ce minuteur n'aurait jamais le temps
        // de se déclencher — la page n'existerait plus.
        window.setTimeout(() => setRefused(true), REFUSAL_DELAY_MS);
      }}
    >
      {labels.closeCta}
    </button>
  );
}
