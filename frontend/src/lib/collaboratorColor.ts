// Section 14: a distinct but *consistent* colour per collaborator, reused for both
// their cursor and their avatar — deterministic by user id so the same person keeps
// the same colour across reconnects and sessions, not a random pick each time.
const PALETTE = [
  "#F97316", // orange
  "#3B82F6", // blue
  "#10B981", // emerald
  "#EC4899", // pink
  "#8B5CF6", // violet
  "#F59E0B", // amber
  "#14B8A6", // teal
  "#EF4444", // red
];

export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
