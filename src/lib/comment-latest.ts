/** Same rules as server `pickLatestCommentId` for API-serialized comments. */
export function pickLatestCommentIdFromRows(
  comments: { id: string; createdAt: string; updatedAt: string }[],
): string | null {
  if (comments.length === 0) return null;
  const sorted = [...comments].sort((a, b) => {
    const tu = new Date(a.updatedAt).getTime();
    const uu = new Date(b.updatedAt).getTime();
    if (tu !== uu) return uu - tu;
    const tc = new Date(a.createdAt).getTime();
    const uc = new Date(b.createdAt).getTime();
    if (tc !== uc) return uc - tc;
    return a.id.localeCompare(b.id);
  });
  return sorted[0]!.id;
}
