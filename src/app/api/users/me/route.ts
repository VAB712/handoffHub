import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/api-auth";
import { json } from "@/lib/json";

const optionalContactEmail = z
  .union([z.string().email().max(320), z.literal(""), z.null()])
  .optional();

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, contactEmail: true },
  });
  if (!u) return json({ error: "Not found" }, { status: 404 });

  return json({
    loginId: u.email,
    contactEmail: u.contactEmail,
  });
}

export async function PATCH(req: Request) {
  const userId = await requireUserId();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  let body: { contactEmail?: string | null };
  try {
    body = z.object({ contactEmail: optionalContactEmail }).parse(await req.json());
  } catch {
    return json({ error: "Invalid body" }, { status: 400 });
  }

  if (body.contactEmail === undefined) {
    return json({ error: "contactEmail is required" }, { status: 400 });
  }

  const normalized =
    body.contactEmail === null || body.contactEmail === ""
      ? null
      : String(body.contactEmail).trim().toLowerCase();

  if (normalized) {
    const taken = await prisma.user.findFirst({
      where: { contactEmail: normalized, NOT: { id: userId } },
      select: { id: true },
    });
    if (taken) return json({ error: "That email is already in use." }, { status: 409 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { contactEmail: normalized },
  });

  return json({ ok: true });
}
