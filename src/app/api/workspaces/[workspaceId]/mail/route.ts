import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/api-auth";
import { json } from "@/lib/json";
import { parseMailRecipients } from "@/lib/mail-recipients";
import { sendHandoffMail } from "@/lib/mail";
import { formatDdMmYyyyFromYmd } from "@/lib/date-display";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  handoffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  html: z.string().min(1).max(2_000_000),
  text: z.string().max(500_000).optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await ctx.params;
  const access = await requireWorkspaceAccess(workspaceId);
  if ("error" in access) return json({ error: access.error }, { status: access.status });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return json({ error: "Invalid mail request" }, { status: 400 });
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true, mailTo: true },
  });
  if (!workspace) return json({ error: "Workspace not found" }, { status: 404 });

  const recipients = parseMailRecipients(workspace.mailTo);
  if (recipients.length === 0) {
    return json(
      {
        error:
          "No mail / DL is set for this workspace. An admin can add it from Edit on the workspace tab or the Workspaces page.",
      },
      { status: 400 },
    );
  }

  const dateLabel = formatDdMmYyyyFromYmd(body.handoffDate);
  const subject = `Handoff ${workspace.name} ${dateLabel}`;
  const html = `<!DOCTYPE html><html><body style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#0f172a;">
<p style="margin:0 0 12px 0;font-size:14px;"><strong>${escapeHtml(workspace.name)}</strong> — ${escapeHtml(dateLabel)}</p>
${body.html}
</body></html>`;

  try {
    await sendHandoffMail({
      to: recipients,
      subject,
      html,
      text: body.text?.trim() || `${workspace.name} handoff ${dateLabel}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not send mail";
    return json({ error: message }, { status: 502 });
  }

  return json({ ok: true, message: `Handoff mailed to ${recipients.join(", ")}` });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
