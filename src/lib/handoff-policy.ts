import type { Comment } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function ymdFromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD for the newest handoff day in this workspace, or null. */
export async function getLatestHandoffYmd(workspaceId: string): Promise<string | null> {
  const row = await prisma.handoffDay.findFirst({
    where: { workspaceId },
    orderBy: { handoffDate: "desc" },
    select: { handoffDate: true },
  });
  if (!row) return null;
  return row.handoffDate.toISOString().slice(0, 10);
}

/** Calendar day of the handoff that contains this topic within the workspace. */
export async function getHandoffYmdForTopicInWorkspace(
  topicId: string,
  workspaceId: string,
): Promise<string | null> {
  const link = await prisma.handoffDayTopic.findFirst({
    where: { topicId, handoffDay: { workspaceId } },
    include: { handoffDay: true },
  });
  if (!link) return null;
  return ymdFromDbDate(link.handoffDay.handoffDate);
}

export async function topicBelongsToWorkspace(topicId: string, workspaceId: string): Promise<boolean> {
  const link = await prisma.handoffDayTopic.findFirst({
    where: { topicId, handoffDay: { workspaceId } },
  });
  return !!link;
}

/**
 * Mutations are allowed only on the latest handoff day in this workspace.
 * When there are no handoff days yet, any date is allowed (first sheet).
 */
export function handoffYmdAllowsMutations(handoffYmd: string, latestYmd: string | null): boolean {
  if (latestYmd === null) return true;
  return handoffYmd === latestYmd;
}

/** Among comments on a topic, the id of the one with the greatest activity time (updated, then created). */
export function pickLatestCommentId(comments: Pick<Comment, "id" | "createdAt" | "updatedAt">[]): string | null {
  if (comments.length === 0) return null;
  return comments
    .slice()
    .sort((a, b) => {
      const tu = a.updatedAt.getTime();
      const uu = b.updatedAt.getTime();
      if (tu !== uu) return uu - tu;
      const tc = a.createdAt.getTime();
      const uc = b.createdAt.getTime();
      if (tc !== uc) return uc - tc;
      return a.id.localeCompare(b.id);
    })[0]!.id;
}

export async function assertTopicHandoffIsLatestForMutation(
  topicId: string,
  workspaceId: string,
): Promise<{ ok: true; handoffYmd: string } | { ok: false; status: 403 | 404; message: string }> {
  const handoffYmd = await getHandoffYmdForTopicInWorkspace(topicId, workspaceId);
  if (!handoffYmd) return { ok: false, status: 404, message: "Topic not found" };
  const latestYmd = await getLatestHandoffYmd(workspaceId);
  if (!handoffYmdAllowsMutations(handoffYmd, latestYmd)) {
    return {
      ok: false,
      status: 403,
      message: "Updates are only allowed on the latest handoff.",
    };
  }
  return { ok: true, handoffYmd };
}

export async function assertCommentEditAllowed(
  commentId: string,
  workspaceId: string,
): Promise<{ ok: true } | { ok: false; status: 403 | 404; message: string }> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { topicId: true },
  });
  if (!comment) return { ok: false, status: 404, message: "Not found" };

  const inWs = await topicBelongsToWorkspace(comment.topicId, workspaceId);
  if (!inWs) return { ok: false, status: 404, message: "Not found" };

  const topicCheck = await assertTopicHandoffIsLatestForMutation(comment.topicId, workspaceId);
  if (!topicCheck.ok) return topicCheck;

  const siblings = await prisma.comment.findMany({
    where: { topicId: comment.topicId },
    select: { id: true, createdAt: true, updatedAt: true },
  });
  const latestId = pickLatestCommentId(siblings);
  if (latestId !== commentId) {
    return {
      ok: false,
      status: 403,
      message: "Only the latest update for this item can be edited.",
    };
  }
  return { ok: true };
}
