import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/api-auth";
import { json } from "@/lib/json";

const bodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(200),
});

export async function PATCH(req: Request) {
  const userId = await requireUserId();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return json({ error: "Invalid body" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const ok = await bcrypt.compare(body.currentPassword, user.passwordHash);
  if (!ok) return json({ error: "Current password is incorrect" }, { status: 400 });

  const nextHash = await bcrypt.hash(body.newPassword, 12);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: nextHash },
  });

  return json({ ok: true });
}
