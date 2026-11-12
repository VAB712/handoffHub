import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";
import { json } from "@/lib/json";
import { buildUsersTemplate, parseUsersSheet } from "@/lib/bulk-users-sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_");
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return json({ error: "Forbidden" }, { status: 403 });

  const workspaces = await prisma.workspace.findMany({
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });

  const output = buildUsersTemplate(workspaces.map((w) => w.name));

  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="handoff-hub-users-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return json({ error: "Upload an Excel file (.xlsx) from the template." }, { status: 400 });
  }

  let rows;
  try {
    rows = parseUsersSheet(await file.arrayBuffer());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read the Excel file.";
    return json({ error: message }, { status: 400 });
  }

  const workspaces = await prisma.workspace.findMany({
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });
  const workspaceByKey = new Map(workspaces.map((w) => [normName(w.name), w.id]));

  const results: Array<{ row: number; userId: string; ok: boolean; error?: string }> = [];
  let created = 0;

  for (const row of rows) {
    const userIdRaw = row.userId;
    if (!userIdRaw) {
      results.push({ row: row.row, userId: "", ok: false, error: "user_id is required" });
      continue;
    }
    if (!row.password || row.password.length < 6) {
      results.push({
        row: row.row,
        userId: userIdRaw,
        ok: false,
        error: "password must be at least 6 characters",
      });
      continue;
    }
    if (row.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.contactEmail)) {
      results.push({ row: row.row, userId: userIdRaw, ok: false, error: "contact_email is invalid" });
      continue;
    }

    const selectedWorkspaceIds: string[] = [];
    if (!row.isAdmin) {
      for (const [key, selected] of row.workspaceFlags) {
        if (!selected) continue;
        const wsId = workspaceByKey.get(key);
        if (wsId) selectedWorkspaceIds.push(wsId);
      }
      if (selectedWorkspaceIds.length === 0) {
        results.push({
          row: row.row,
          userId: userIdRaw,
          ok: false,
          error: "select at least one workspace (put 1 under the workspace column)",
        });
        continue;
      }
    }

    try {
      if (row.contactEmail) {
        const takenCe = await prisma.user.findFirst({
          where: { contactEmail: row.contactEmail },
          select: { id: true },
        });
        if (takenCe) {
          results.push({ row: row.row, userId: userIdRaw, ok: false, error: "contact_email already in use" });
          continue;
        }
      }

      const passwordHash = await bcrypt.hash(row.password, 12);
      await prisma.user.create({
        data: {
          email: userIdRaw,
          contactEmail: row.contactEmail,
          passwordHash,
          isAdmin: row.isAdmin,
          workspaceAccesses: row.isAdmin
            ? undefined
            : {
                create: [...new Set(selectedWorkspaceIds)].map((workspaceId) => ({ workspaceId })),
              },
        },
      });
      created += 1;
      results.push({ row: row.row, userId: userIdRaw, ok: true });
    } catch (err) {
      const duplicate =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      results.push({
        row: row.row,
        userId: userIdRaw,
        ok: false,
        error: duplicate ? "user_id or contact_email already exists" : "user already exists or invalid row",
      });
    }
  }

  return json({
    ok: true,
    totalRows: rows.length,
    created,
    failed: rows.length - created,
    results,
  });
}
