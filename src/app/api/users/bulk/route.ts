import bcrypt from "bcryptjs";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";
import { json } from "@/lib/json";

function isTruthyCell(v: unknown): boolean {
  if (typeof v === "number") return v === 1;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "y";
  }
  return false;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return json({ error: "Forbidden" }, { status: 403 });

  const workspaces = await prisma.workspace.findMany({
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });

  const headers = ["user_id", "contact_email", "password", "is_admin", ...workspaces.map((w) => w.name)];
  const sample = ["new.user", "", "Password@123", 0, ...workspaces.map(() => 0)];
  const sheet = XLSX.utils.aoa_to_sheet([headers, sample]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "users");
  const output = XLSX.write(book, { type: "buffer", bookType: "xlsx" });

  return new Response(output, {
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
  if (!(file instanceof File)) {
    return json({ error: "Upload an Excel file under field name 'file'." }, { status: 400 });
  }

  const ab = await file.arrayBuffer();
  const wb = XLSX.read(Buffer.from(ab), { type: "buffer" });
  const first = wb.SheetNames[0];
  if (!first) return json({ error: "Excel file is empty." }, { status: 400 });
  const ws = wb.Sheets[first];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  if (rows.length === 0) return json({ error: "No rows found in sheet." }, { status: 400 });

  const workspaces = await prisma.workspace.findMany({
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });
  const workspaceByLowerName = new Map(workspaces.map((w) => [w.name.trim().toLowerCase(), w.id]));
  const RESERVED_KEYS = new Set(["user_id", "contact_email", "password", "is_admin"]);

  const results: Array<{ row: number; userId: string; ok: boolean; error?: string }> = [];
  let created = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    const rowNum = i + 2;
    const userIdRaw = String(r.user_id ?? "").trim().toLowerCase();
    const passwordRaw = String(r.password ?? "");
    const isAdmin = isTruthyCell(r.is_admin);
    const contactEmailRaw = String(r.contact_email ?? "").trim().toLowerCase();
    let contactEmail: string | null = null;
    if (contactEmailRaw) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmailRaw)) {
        results.push({ row: rowNum, userId: userIdRaw, ok: false, error: "contact_email is invalid" });
        continue;
      }
      contactEmail = contactEmailRaw;
    }

    if (!userIdRaw) {
      results.push({ row: rowNum, userId: "", ok: false, error: "user_id is required" });
      continue;
    }
    if (!passwordRaw || passwordRaw.length < 6) {
      results.push({ row: rowNum, userId: userIdRaw, ok: false, error: "password must be at least 6 characters" });
      continue;
    }

    const selectedWorkspaceIds: string[] = [];
    if (!isAdmin) {
      for (const [key, val] of Object.entries(r)) {
        const lower = key.trim().toLowerCase();
        if (RESERVED_KEYS.has(lower)) continue;
        const wsId = workspaceByLowerName.get(lower);
        if (!wsId) continue;
        if (isTruthyCell(val)) selectedWorkspaceIds.push(wsId);
      }
      if (selectedWorkspaceIds.length === 0) {
        results.push({ row: rowNum, userId: userIdRaw, ok: false, error: "select at least one workspace (put 1)" });
        continue;
      }
    }

    try {
      if (contactEmail) {
        const takenCe = await prisma.user.findFirst({
          where: { contactEmail },
          select: { id: true },
        });
        if (takenCe) {
          results.push({ row: rowNum, userId: userIdRaw, ok: false, error: "contact_email already in use" });
          continue;
        }
      }

      const passwordHash = await bcrypt.hash(passwordRaw, 12);
      await prisma.user.create({
        data: {
          email: userIdRaw,
          contactEmail,
          passwordHash,
          isAdmin,
          workspaceAccesses: isAdmin
            ? undefined
            : {
                create: [...new Set(selectedWorkspaceIds)].map((workspaceId) => ({ workspaceId })),
              },
        },
      });
      created += 1;
      results.push({ row: rowNum, userId: userIdRaw, ok: true });
    } catch {
      results.push({ row: rowNum, userId: userIdRaw, ok: false, error: "user already exists or invalid row" });
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
