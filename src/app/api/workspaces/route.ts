import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireAdmin } from "@/lib/api-auth";
import { json } from "@/lib/json";

const createSchema = z.object({
  name: z.string().min(1).max(200).trim(),
});

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const workspaces = session.user.isAdmin
    ? await prisma.workspace.findMany({
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, sortOrder: true },
      })
    : await prisma.workspace.findMany({
        where: {
          userAccesses: {
            some: {
              userId,
            },
          },
        },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, sortOrder: true },
      });

  return json({ workspaces });
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

  const max = await prisma.workspace.aggregate({ _max: { sortOrder: true } });
  const sortOrder = (max._max.sortOrder ?? -1) + 1;

  const ws = await prisma.workspace.create({
    data: { name: body.name, sortOrder },
    select: { id: true, name: true, sortOrder: true },
  });

  return json({ workspace: ws }, { status: 201 });
}
