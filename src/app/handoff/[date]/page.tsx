import { redirect } from "next/navigation";

/** Old URL — handoffs are scoped by workspace. Pick a workspace first. */
export default function LegacyHandoffRedirect() {
  redirect("/workspaces");
}
