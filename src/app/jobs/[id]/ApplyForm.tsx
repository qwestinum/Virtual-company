'use client';

/**
 * Formulaire de candidature du jobboard fictif.
 *
 * ⚠️ CHAQUE ENVOI PART VRAIMENT — un mail réel, avec pièce jointe, vers la
 * boîte de la campagne. Le bouton est donc désarmé DÈS le clic et ne se
 * réarme qu'en cas d'échec : un double-clic n'enverrait pas deux fois « la
 * même » candidature, il enverrait deux mails, donc deux candidatures
 * analysées, donc deux fiches à traiter. Il n'y a pas de jeton d'idempotence
 * sur ce chemin — le désarmement du bouton EST la protection, et c'est aussi
 * pour ça que la route compte les envois par adresse.
 */
import { useRef, useState } from 'react';

import { MAX_CV_BYTES } from '@/lib/jobboard/application-mail';

type State = 'idle' | 'sending' | 'sent';

export function ApplyForm({ campaignId }: { campaignId: string }) {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state !== 'idle') return;

    const form = new FormData(event.currentTarget);
    form.append('campaignId', campaignId);
    setState('sending');
    setError(null);

    try {
      const res = await fetch('/api/jobs/apply', { method: 'POST', body: form });
      if (!res.ok) {
        // `fetch` ne rejette pas sur 4xx/5xx : sans ce contrôle, un refus
        // passerait pour un succès et le candidat repartirait convaincu
        // d'avoir postulé.
        const data = (await res.json().catch(() => null)) as
          | { message?: string }
          | null;
        setError(data?.message ?? 'L’envoi a échoué. Merci de réessayer.');
        setState('idle');
        return;
      }
      setState('sent');
    } catch {
      setError('Connexion interrompue. Merci de réessayer.');
      setState('idle');
    }
  }

  if (state === 'sent') {
    return (
      <section className="jb-panel jb-done">
        <p className="jb-done-mark">✓</p>
        <h2>Candidature envoyée</h2>
        <p className="jb-hint">
          Votre candidature pour la référence {campaignId} a bien été transmise.
          Nous revenons vers vous par email.
        </p>
      </section>
    );
  }

  return (
    <section className="jb-panel">
      <h2 style={{ fontSize: 17, fontWeight: 650, margin: '0 0 16px' }}>
        Candidater
      </h2>

      {error && <p className="jb-error">{error}</p>}

      <form ref={formRef} onSubmit={handleSubmit}>
        <label className="jb-field">
          <span className="jb-label">Nom complet *</span>
          <input className="jb-input" name="fullName" required maxLength={120} />
        </label>

        <label className="jb-field">
          <span className="jb-label">Email *</span>
          <input className="jb-input" name="email" type="email" required maxLength={200} />
        </label>

        <label className="jb-field">
          <span className="jb-label">Téléphone</span>
          <input className="jb-input" name="phone" type="tel" maxLength={40} />
        </label>

        <label className="jb-field">
          <span className="jb-label">CV (PDF ou DOCX) *</span>
          <input
            className="jb-file"
            name="cv"
            type="file"
            required
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          />
        </label>

        <button className="jb-submit" type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? 'Envoi en cours…' : 'Envoyer ma candidature'}
        </button>

        <p className="jb-hint">
          Taille maximale : {Math.round(MAX_CV_BYTES / (1024 * 1024))} Mo. Vos
          données sont traitées pour cette offre uniquement et conservées 24
          mois. Vous pouvez demander leur suppression à tout moment.
        </p>
      </form>
    </section>
  );
}
