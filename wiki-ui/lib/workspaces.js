export const WORKSPACE_IDS = [
  'wiki',
  'sources',
  'search',
  'graph',
  'lint',
  'review',
  'research',
  'chat',
];

export function resolveWorkspace(candidate) {
  return WORKSPACE_IDS.includes(candidate) ? candidate : 'wiki';
}
