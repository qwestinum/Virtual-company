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
  'agent.scheduler': { color: '#16a34a', initials: 'SC', filename: 'scheduler' },
};

const FALLBACK_COLOR = '#64748b';
const FALLBACK_INITIALS = '??';

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
