import type { Team } from "@prisma/client";

/** User.team set → only that team may edit that team's update. Otherwise only the author may edit. */
export function canEditComment(opts: {
  userId: string;
  userTeam: Team | null | undefined;
  commentAuthorId: string;
  commentTeam: Team;
}): boolean {
  if (opts.userTeam != null && opts.userTeam === opts.commentTeam) {
    return true;
  }
  if (opts.commentTeam === "none" && opts.commentAuthorId === opts.userId) {
    return true;
  }
  if (opts.userTeam != null) {
    return false;
  }
  return opts.commentAuthorId === opts.userId;
}
