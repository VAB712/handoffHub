import { notFound } from "next/navigation";
import { HandoffView } from "@/components/HandoffView";

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

export default async function WorkspaceHandoffPage({
  params,
}: {
  params: Promise<{ workspaceId: string; date: string }>;
}) {
  const { workspaceId, date } = await params;
  if (!dateRe.test(date)) notFound();
  return <HandoffView workspaceId={workspaceId} date={date} />;
}
