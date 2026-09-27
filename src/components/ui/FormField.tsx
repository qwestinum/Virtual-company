'use client';

/**
 * LE CHAMP DE SAISIE DU PRODUIT — un seul, partagé par les formulaires de
 * campagne (création ET édition) et par les réglages.
 *
 * ⚠️ POURQUOI IL EXISTE. Les formulaires posaient un libellé en petites
 * capitales grises AU-DESSUS d'une zone sans bordure visible : le mot était la
 * seule chose qui se voyait, donc la chose qu'on cliquait. Trois causes, toutes
 * corrigées ici :
 *   ① la bordure du champ était sous 3:1 (jetons de CARTE, faibles par choix) —
 *     d'où le rôle dédié `--dash-field-border`, mesuré ;
 *   ② le libellé, gris clair et en capitales, ressemblait à une étiquette
 *     décorative — il est sombre, en casse de phrase, collé au champ ;
 *   ③ rien ne le liait au champ — c'est un `<label htmlFor>` : le cliquer donne
 *     le focus, ce qui rachète le réflexe au lieu de le punir.
 *
 * L'exemple vit DANS le champ (`placeholder`), jamais au-dessus : au-dessus, il
 * se lit comme une valeur déjà saisie.
 */

import type { CSSProperties, ReactNode } from 'react';

/** Hauteur de frappe confortable, et cible de clic suffisante. */
const HAUTEUR = 40;

/**
 * La boîte de saisie, identique pour un champ, une liste ou une zone.
 *
 * ⚠️ `border: 1px solid var(--dash-field-border)` : si le jeton n'existe pas,
 * le navigateur jette la déclaration ENTIÈRE et le champ se retrouve SANS
 * bordure — exactement le défaut qu'on répare, revenu en silence. Aucune
 * erreur, aucun avertissement. Le test de contraste lève si le jeton disparaît
 * de `globals.css` ; c'est lui qui tient cette garantie.
 */
export const FIELD_BOX: CSSProperties = {
  width: '100%',
  minHeight: HAUTEUR,
  borderRadius: 8,
  border: '1px solid var(--dash-field-border)',
  background: 'var(--dash-surface)',
  color: 'var(--dash-text)',
  fontSize: 13.5,
  padding: '9px 12px',
  fontFamily: 'var(--font-nunito), system-ui, sans-serif',
};

/** Écart entre deux champs — assez large pour qu'un libellé n'appartienne qu'à UN champ. */
export const FIELD_GAP = 22;

export type FormFieldProps = {
  /** Identifiant du contrôle — c'est lui qui relie le libellé au champ. */
  id: string;
  label: string;
  required?: boolean;
  /** Aide contextuelle, SOUS le champ, en petit. */
  hint?: ReactNode;
  /** Message d'erreur : remplace l'aide et colore la bordure. */
  error?: string | null;
  children: ReactNode;
};

export function FormField({
  id,
  label,
  required,
  hint,
  error,
  children,
}: FormFieldProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label
        htmlFor={id}
        className="font-body"
        style={{
          // Collé au champ (5 px) : un libellé qui flotte appartient à tout le
          // monde, donc à personne.
          marginBottom: 5,
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--dash-text)',
          cursor: 'pointer',
          width: 'fit-content',
        }}
      >
        {label}
        {required ? (
          <span
            aria-hidden
            style={{ color: 'var(--dash-orange)', marginLeft: 3, fontWeight: 700 }}
          >
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (obligatoire)</span> : null}
      </label>
      {children}
      {error ? (
        <p
          className="font-body"
          style={{ marginTop: 5, fontSize: 11.5, color: 'var(--dash-red)' }}
        >
          {error}
        </p>
      ) : hint ? (
        <p
          className="font-body"
          style={{ marginTop: 5, fontSize: 11.5, color: 'var(--dash-text-secondary)' }}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Empile des champs avec l'écart canonique. */
export function FormStack({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: FIELD_GAP }}>
      {children}
    </div>
  );
}
