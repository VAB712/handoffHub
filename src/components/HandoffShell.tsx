"use client";

import { useState } from "react";
import { HandoffSidebar } from "./HandoffSidebar";

export function HandoffShell({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: React.ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50 lg:flex-row">
      <HandoffSidebar
        workspaceId={workspaceId}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
        onCollapse={() => setSidebarCollapsed(true)}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
