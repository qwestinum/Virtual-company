'use client';

/**
 * Choix du recruteur référent sur un brouillon de campagne (création).
 *
 * Symétrique d'`OwnerEditBlock`, mais sans store ni PATCH : le parent détient
 * la valeur et l'envoie avec le reste au bouton « Créer la campagne ».
 *
 * Trois différences ASSUMÉES avec l'édition :
 *
 *  1. **Aucun dialog d'impact.** Changer de référent en édition bascule les
 *     liens de réservation déjà envoyés — ici il n'y en a aucun, donc rien à
 *     confirmer. Faire cliquer pour un impact nul serait du bruit.
 *  2. **Le défaut est VISIBLE.** Le serveur pose déjà « le créateur » comme
 *     référent par défaut quand le champ est absent ; le formulaire, lui,
 *     envoie toujours le champ. Le sélecteur montre donc d'emblée le nom
 *     retenu — et « aucun référent » redevient un choix explicite.
 *  3. **Un seul manque signalé : les DISPONIBILITÉS.** Sur une campagne neuve,
 *     l'absence de lien Cal.com n'est pas une alerte — Cal.com est en
 *     extinction, et le signaler pousserait vers le régime qu'on quitte. Ce qui
 *     compte est qu'un candidat puisse réserver un créneau : sans agenda
 *     rempli, il n'y en a aucun. L'édition, elle, garde l'alerte Cal.com pour
 *     les campagnes qui tournent ENCORE dessus.
 */

import {
  recruiterOptionLabel,
  type RecruiterOption,
} from '@/lib/campaign/use-recruiter-options';

export type OwnerDraftEditorProps = {
  value: string | null;
  onChange: (next: string | null) => void;
  /** `null` = liste pas encore chargée (le sélecteur est alors désactivé). */
  options: RecruiterOption[] | null;
};

export function OwnerDraftEditor({
  value,
  onChange,
  options,
}: OwnerDraftEditorProps) {
  const selected = options?.find((o) => o.id === value) ?? null;
  const loaded = options !== null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p
        className="font-body"
        style={{ fontSize: 12.5, color: 'var(--dash-text-secondary)' }}
      >
        Le référent porte l’agenda des entretiens de cette campagne : c’est sur
        ses disponibilités que les candidats retenus réservent leur créneau.
        Sans référent, l’agenda global des paramètres s’applique.
      </p>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.currentTarget.value || null)}
        disabled={!loaded}
        aria-label="Recruteur référent"
        className="font-body"
        style={{
          height: 38,
          borderRadius: 8,
          border: '1px solid var(--dash-border)',
          background: 'white',
          padding: '0 10px',
          fontSize: 13,
        }}
      >
        <option value="">— Aucun (agenda global)</option>
        {(options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {recruiterOptionLabel(o, 'availability')}
          </option>
        ))}
      </select>
      {loaded && options.length === 0 ? (
        <p className="font-body" style={{ fontSize: 12, color: 'var(--dash-yellow)' }}>
          Aucun recruteur actif n’est enregistré — la campagne se créera sans
          référent et utilisera l’agenda global (Paramètres → Recruteurs).
        </p>
      ) : null}
      {selected?.hasAvailability === false ? (
        <p className="font-body" style={{ fontSize: 12, color: 'var(--dash-yellow)' }}>
          Ce recruteur n’a aucune disponibilité déclarée : aucun créneau ne
          pourra lui être réservé tant que son agenda est vide (Paramètres →
          Agendas &amp; disponibilités).
        </p>
      ) : null}
    </div>
  );
}
