const AVATAR_COLORS: Record<string, string> = {
  'agent.manager-rh': '#1e3a8a',
  'agent.cv-analyzer': '#0d9488',
  'agent.mail-composer': '#d97706',
  'agent.job-writer': '#7c3aed',
  'agent.scheduler': '#16a34a',
};

const FALLBACK_COLOR = '#64748b';

export function getAvatarColor(agentId: string): string {
  return AVATAR_COLORS[agentId] ?? FALLBACK_COLOR;
}

export function getAvatarPhase(agentId: string): number {
  let hash = 0;
  for (let i = 0; i < agentId.length; i += 1) {
    hash = (hash * 31 + agentId.charCodeAt(i)) | 0;
  }
  const positive = hash < 0 ? -hash : hash;
  return (positive % 1000) / 1000 * Math.PI * 2;
}
