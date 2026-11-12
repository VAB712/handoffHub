import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function requireAdmin(): Promise<{ userId: string } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!session.user.isAdmin) return null;
  return { userId: session.user.id };
}

export async function requireWorkspaceAccess(
  workspaceId: string,
): Promise<{ userId: string } | { error: string; status: 401 | 403 | 404 }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized", status: 401 };

  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!ws) return { error: "Workspace not found", status: 404 };

  if (session.user.isAdmin) return { userId: session.user.id };

  const access = await prisma.userWorkspaceAccess.findUnique({
    where: {
      userId_workspaceId: {
        userId: session.user.id,
        workspaceId,
      },
    },
    select: { userId: true },
  });
  if (!access) return { error: "Forbidden", status: 403 };
  return { userId: session.user.id };
}

export async function requireWorkspaceAdmin(
  workspaceId: string,
): Promise<{ userId: string } | { error: string; status: 401 | 403 | 404 }> {
  const access = await requireWorkspaceAccess(workspaceId);
  if ("error" in access) return access;
  const admin = await requireAdmin();
  if (!admin) return { error: "Only an admin can schedule mail.", status: 403 };
  return access;
}
