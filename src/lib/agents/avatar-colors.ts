type AvatarMeta = {
  color: string;
  initials: string;
  filename: string;
};

const AVATAR_META: Record<string, AvatarMeta> = {
  'agent.manager-rh': { color: '#1e3a8a', initials: 'MR', filename: 'manager' },
  'agent.cv-analyzer': { color: '#0d9488', initials: 'CV', filename: 'cv-analyzer' },
  'agent.mail-composer': { color: '#d97706', initials: 'MC', filename: 'mail-composer' },
  'agent.job-writer': { color: '#7c3aed', initials: 'JW', filename: 'job-writer' },
  'agent.publisher': { color: '#db2777', initials: 'PU', filename: 'publisher' },
  'agent.scheduler': { color: '#16a34a', initials: 'SC', filename: 'scheduler' },
};

const FALLBACK_COLOR = '#64748b';
const FALLBACK_INITIALS = '??';

/**
 * Couleur signature du donneur d'ordre (DRH humain). Distincte des
 * agents IA pour qu'il soit identifiable d'un coup d'œil dans le chat
 * (avatar, label, accent). Emerald-600 — cf. directive utilisateur
 * Session 3 / refonte design.
 */
export const DRH_COLOR = '#059669';
export const DRH_INITIALS = 'DRH';
export const MANAGER_AGENT_ID = 'agent.manager-rh';

export function getAvatarColor(agentId: string): string {
  return AVATAR_META[agentId]?.color ?? FALLBACK_COLOR;
}

export function getAvatarInitials(agentId: string): string {
  return AVATAR_META[agentId]?.initials ?? FALLBACK_INITIALS;
}

export function getAvatarUrl(agentId: string): string | null {
  const meta = AVATAR_META[agentId];
  return meta ? `/avatars/${meta.filename}.png` : null;
}

export function listAvatarMeta(): Array<AvatarMeta & { agentId: string }> {
  return Object.entries(AVATAR_META).map(([agentId, meta]) => ({
    agentId,
    ...meta,
  }));
}
