import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";
import { json } from "@/lib/json";

const optionalContactEmail = z
  .union([z.string().email().max(320), z.literal(""), z.null()])
  .optional();

const createSchema = z
  .object({
    userId: z.string().trim().min(1).max(200),
    password: z.string().min(6).max(200),
    accessLevel: z.enum(["admin", "workspace"]),
    workspaceId: z.string().trim().min(1).optional(),
    workspaceIds: z.array(z.string().trim().min(1)).optional(),
    contactEmail: optionalContactEmail,
  })
  .superRefine((v, ctx) => {
    if (v.accessLevel === "workspace" && !v.workspaceId && (!v.workspaceIds || v.workspaceIds.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one workspace is required for workspace access",
        path: ["workspaceIds"],
      });
    }
  });

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return json({ error: "Forbidden" }, { status: 403 });

  const [users, workspaces] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        contactEmail: true,
        isAdmin: true,
        createdAt: true,
        workspaceAccesses: {
          include: {
            workspace: {
              select: { id: true, name: true },
            },
          },
        },
      },
    }),
    prisma.workspace.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return json({
    users: users.map((u) => ({
      id: u.id,
      userId: u.email,
      contactEmail: u.contactEmail,
      isAdmin: u.isAdmin,
      createdAt: u.createdAt.toISOString(),
      workspaceAccesses: u.workspaceAccesses.map((a) => ({
        workspaceId: a.workspace.id,
        workspaceName: a.workspace.name,
      })),
    })),
    workspaces,
  });
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return json({ error: "Forbidden" }, { status: 403 });

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch {
    return json({ error: "Invalid body" }, { status: 400 });
  }

  const loginId = body.userId.toLowerCase();
  const hash = await bcrypt.hash(body.password, 12);
  const contactEmail =
    body.contactEmail !== undefined && body.contactEmail !== null && String(body.contactEmail).trim() !== ""
      ? String(body.contactEmail).trim().toLowerCase()
      : null;

  if (contactEmail) {
    const taken = await prisma.user.findFirst({
      where: { contactEmail },
      select: { id: true },
    });
    if (taken) return json({ error: "That email is already in use." }, { status: 409 });
  }

  try {
    if (body.accessLevel === "admin") {
      const user = await prisma.user.create({
        data: {
          email: loginId,
          contactEmail,
          passwordHash: hash,
          isAdmin: true,
        },
        select: { id: true, email: true, isAdmin: true },
      });
      return json({ user }, { status: 201 });
    }

    const workspaceIds = [...new Set((body.workspaceIds?.length ? body.workspaceIds : body.workspaceId ? [body.workspaceId] : []).map((id) => id.trim()))];
    if (workspaceIds.length === 0) {
      return json({ error: "At least one workspace is required" }, { status: 400 });
    }
    const found = await prisma.workspace.findMany({
      where: { id: { in: workspaceIds } },
      select: { id: true },
    });
    if (found.length !== workspaceIds.length) {
      return json({ error: "One or more selected workspaces were not found" }, { status: 404 });
    }

    const user = await prisma.user.create({
      data: {
        email: loginId,
        contactEmail,
        passwordHash: hash,
        isAdmin: false,
        workspaceAccesses: {
          create: workspaceIds.map((workspaceId) => ({ workspaceId })),
        },
      },
      select: { id: true, email: true, isAdmin: true },
    });

    return json({ user }, { status: 201 });
  } catch {
    return json({ error: "User ID already exists" }, { status: 409 });
  }
}
