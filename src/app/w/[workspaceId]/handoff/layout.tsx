import { HandoffShell } from "@/components/HandoffShell";
import { WorkspaceTabBar } from "@/components/WorkspaceTabBar";

export default async function WorkspaceHandoffLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <WorkspaceTabBar workspaceId={workspaceId} />
      <HandoffShell workspaceId={workspaceId}>{children}</HandoffShell>
    </div>
  );
}
