'use client';

/**
 * Dialog d'impact d'un changement de référent.
 *
 * Il dit deux choses, et la seconde compte autant que la première : ce qui
 * BASCULE (les liens encore actifs, sans réémission) et ce qui NE BOUGE PAS
 * (les rendez-vous déjà pris, chez l'ancien référent). Un dialog qui n'annonce
 * que le changement laisserait croire que les entretiens programmés migrent
 * eux aussi — ils ne migrent pas, et c'est voulu : un rendez-vous est un
 * engagement pris avec une personne.
 *
 * Il AVERTIT enfin quand le nouveau référent n'a pas de créneaux : les liens
 * qui basculent ouvriront une page « momentanément indisponible ». On avertit
 * sans refuser — bloquer une réorganisation parce qu'un agenda n'est pas
 * rempli serait excessif, et le geste RH prime sur le geste technique.
 */

export type TargetImpact = {
  native: boolean;
  activeLinks: number;
  bookings: { recruiterName: string; count: number }[];
};

export function OwnerChangeDialog({
  impact,
  nextName,
  nextHasAvailability,
  onCancel,
  onConfirm,
}: {
  impact: TargetImpact;
  nextName: string;
  /** `null` = indéterminé : on n'avertit pas à tort. */
  nextHasAvailability?: boolean | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const totalBookings = impact.bookings.reduce((sum, b) => sum + b.count, 0);
  // L'avertissement ne vaut qu'en réservation native : en régime Cal.com, le
  // lien part de la fiche du recruteur, pas de ses créneaux.
  const noSlots = impact.native && nextHasAvailability === false;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Changer le recruteur référent"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(28,25,23,.45)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 60,
        padding: 16,
      }}
    >
      <div
        style={{
          maxWidth: 460,
          width: '100%',
          background: 'white',
          borderRadius: 12,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h2 className="font-body" style={{ fontSize: 15, fontWeight: 600 }}>
          Changer le référent pour {nextName}
        </h2>

        <ul
          className="font-body"
          style={{ fontSize: 13, lineHeight: 1.55, display: 'grid', gap: 6 }}
        >
          <li>
            <strong>{impact.activeLinks}</strong>{' '}
            {impact.activeLinks > 1
              ? 'liens de réservation actifs basculeront'
              : 'lien de réservation actif basculera'}{' '}
            sur l’agenda de {nextName} — sans réémission, les candidats gardent
            le lien qu’ils ont reçu.
          </li>
          {totalBookings > 0 ? (
            <li>
              <strong>{totalBookings}</strong>{' '}
              {totalBookings > 1
                ? 'rendez-vous déjà pris ne bougent pas'
                : 'rendez-vous déjà pris ne bouge pas'}{' '}
              :{' '}
              {impact.bookings
                .map((b) => `${b.count} chez ${b.recruiterName}`)
                .join(', ')}
              .
            </li>
          ) : (
            <li style={{ color: 'var(--dash-text-secondary)' }}>
              Aucun rendez-vous déjà pris n’est concerné.
            </li>
          )}
        </ul>

        {noSlots ? (
          <p
            className="font-body"
            style={{
              fontSize: 12.5,
              lineHeight: 1.5,
              borderRadius: 8,
              padding: '10px 12px',
              background: 'var(--dash-yellow-light, #fdf6e3)',
              color: 'var(--dash-yellow, #8a6413)',
            }}
          >
            ⚠ {nextName} n’a aucune disponibilité déclarée. Les liens qui
            basculent afficheront « momentanément indisponible », et les
            prochaines invitations seront bloquées — jusqu’à ce que son agenda
            soit rempli dans Paramètres → Agendas &amp; disponibilités.
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            className="font-body"
            style={{
              padding: '7px 12px',
              borderRadius: 8,
              border: '1px solid var(--dash-border)',
              background: 'white',
              fontSize: 13,
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="font-body"
            style={{
              padding: '7px 12px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--dash-text-primary, #292524)',
              color: 'white',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Changer le référent
          </button>
        </div>
      </div>
    </div>
  );
}
