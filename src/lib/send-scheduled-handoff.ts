import { prisma } from "@/lib/prisma";
import { formatCommentLine } from "@/lib/format-comment";
import { formatDdMmYyyyFromYmd } from "@/lib/date-display";
import { parseMailRecipients } from "@/lib/mail-recipients";
import { sendHandoffMail } from "@/lib/mail";
import { buildHandoffMailTableHtml, handoffMailPlainText, type MailTopic } from "@/lib/handoff-mail-html";

export type ScheduledSendResult =
  | { sent: true; handoffDate: string }
  | { sent: false; reason: "no-mail" | "no-handoff" };

/** Email the workspace's latest handoff to the mail / DL already saved on the workspace. */
export async function sendLatestHandoffToWorkspaceMail(
  workspaceId: string,
  displayTz: string,
): Promise<ScheduledSendResult> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true, mailTo: true },
  });
  if (!workspace) throw new Error("Workspace not found");

  const recipients = parseMailRecipients(workspace.mailTo);
  if (recipients.length === 0) return { sent: false, reason: "no-mail" };

  const day = await prisma.handoffDay.findFirst({
    where: { workspaceId },
    orderBy: { handoffDate: "desc" },
    include: {
      topics: {
        orderBy: { sortOrder: "asc" },
        include: {
          topic: {
            include: {
              comments: {
                orderBy: { createdAt: "asc" },
                include: {
                  attachments: { select: { originalFilename: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!day) return { sent: false, reason: "no-handoff" };

  const handoffDate = day.handoffDate.toISOString().slice(0, 10);
  const topics: MailTopic[] = day.topics.map((row) => ({
    summary: row.topic.summary,
    owner: row.topic.owner,
    priority: row.topic.priority,
    isClosed: row.topic.isClosed,
    sheetData: row.topic.sheetData,
    comments: row.topic.comments.map((c) => ({
      id: c.id,
      team: c.team,
      body: c.body,
      prefix: formatCommentLine(c.team, c.createdAt, displayTz),
      createdAt: c.createdAt.toISOString(),
      attachments: c.attachments.map((a) => ({ originalFilename: a.originalFilename })),
    })),
  }));

  const dateLabel = formatDdMmYyyyFromYmd(handoffDate);
  const table = buildHandoffMailTableHtml(topics);
  const html = `<!DOCTYPE html><html><body style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#0f172a;">
<p style="margin:0 0 12px 0;font-size:14px;"><strong>${escapeHtml(workspace.name)}</strong> — ${escapeHtml(dateLabel)}</p>
${table}
</body></html>`;

  await sendHandoffMail({
    to: recipients,
    subject: `Handoff ${workspace.name} ${dateLabel}`,
    html,
    text: handoffMailPlainText(topics) || `${workspace.name} handoff ${dateLabel}`,
  });
  return { sent: true, handoffDate };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
