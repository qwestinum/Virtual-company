/**
 * Dit pourquoi l'annonce générique ne s'écrit pas ici — au lieu de retirer
 * le panneau en silence (un canal retenu qui disparaît sans un mot fait
 * croire à une panne).
 */
import { panelStyle } from './job-ad-panel-styles';

export function JobboardUnavailableNotice() {
  return (
    <div style={panelStyle} data-jobboard-unavailable>
      <p className="font-body" style={{ fontSize: 13, color: 'var(--dash-text-secondary)', margin: 0 }}>
        Annonce générique : la page d’offres n’est pas activée sur cette
        installation. Le canal est retenu, mais il n’y a nulle part où publier
        le texte.
      </p>
    </div>
  );
}
