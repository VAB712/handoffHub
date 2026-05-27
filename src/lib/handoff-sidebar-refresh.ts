/** Cross-component signal so the handoff date list in the sidebar refetches after API changes. */
export const HANDOFF_SIDEBAR_LIST_REFRESH = "handoff:sidebar-list-refresh";

export function requestHandoffSidebarListRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(HANDOFF_SIDEBAR_LIST_REFRESH));
}
