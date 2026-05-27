import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";
import { json } from "@/lib/json";

const optionalContactEmailPatch = z
  .union([z.string().email().max(320), z.literal(""), z.null()])
  .optional();

const updateSchema = z
  .object({
    accessLevel: z.enum(["admin", "workspace"]),
    workspaceIds: z.array(z.string().trim().min(1)).optional(),
    password: z.string().min(6).max(200).optional(),
    userId: z.string().trim().min(1).max(200).optional(),
    contactEmail: optionalContactEmailPatch,
  })
  .superRefine((v, ctx) => {
    if (v.accessLevel === "workspace" && (!v.workspaceIds || v.workspaceIds.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one workspace is required for workspace access",
        path: ["workspaceIds"],
      });
    }
  });

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  let body: z.infer<typeof updateSchema>;
  try {
    body = updateSchema.parse(await req.json());
  } catch {
    return json({ error: "Invalid body" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true },
  });
  if (!target) return json({ error: "User not found" }, { status: 404 });

  const newEmail = body.userId?.trim().toLowerCase();
  if (newEmail && newEmail !== target.email) {
    const taken = await prisma.user.findFirst({
      where: { email: newEmail, NOT: { id } },
      select: { id: true },
    });
    if (taken) return json({ error: "User ID already exists" }, { status: 409 });
  }

  const passwordHash = body.password ? await bcrypt.hash(body.password, 12) : undefined;

  const profilePatch: { email?: string; passwordHash?: string; contactEmail?: string | null } = {};
  if (newEmail && newEmail !== target.email) profilePatch.email = newEmail;
  if (passwordHash) profilePatch.passwordHash = passwordHash;

  if (body.contactEmail !== undefined) {
    const normalized =
      body.contactEmail === null || body.contactEmail === ""
        ? null
        : String(body.contactEmail).trim().toLowerCase();
    if (normalized) {
      const taken = await prisma.user.findFirst({
        where: { contactEmail: normalized, NOT: { id } },
        select: { id: true },
      });
      if (taken) return json({ error: "That email is already in use." }, { status: 409 });
    }
    profilePatch.contactEmail = normalized;
  }

  if (body.accessLevel === "admin") {
    await prisma.user.update({
      where: { id },
      data: {
        ...profilePatch,
        isAdmin: true,
        workspaceAccesses: { deleteMany: {} },
      },
    });
    return json({ ok: true });
  }

  const workspaceIds = [...new Set((body.workspaceIds ?? []).map((x) => x.trim()))];
  const found = await prisma.workspace.findMany({
    where: { id: { in: workspaceIds } },
    select: { id: true },
  });
  if (found.length !== workspaceIds.length) {
    return json({ error: "One or more selected workspaces were not found" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(profilePatch).length > 0) {
      await tx.user.update({
        where: { id },
        data: profilePatch,
      });
    }
    await tx.user.update({
      where: { id },
      data: { isAdmin: false },
    });
    await tx.userWorkspaceAccess.deleteMany({ where: { userId: id } });
    await tx.userWorkspaceAccess.createMany({
      data: workspaceIds.map((workspaceId) => ({ userId: id, workspaceId })),
    });
  });

  return json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (id === admin.userId) {
    return json({ error: "You cannot delete your own account." }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!target) return json({ error: "User not found" }, { status: 404 });

  await prisma.user.delete({ where: { id } });
  return json({ ok: true });
}
