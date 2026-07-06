import type { Team } from "@prisma/client";
import { getHandoffTz } from "./env";

const teamShort: Record<Exclude<Team, "none">, string> = {
  on_shore: "on-shore",
  off_shore: "off-shore",
};

/** Prefix for display: `12/05 (off-shore) -` or `12/05 -` when team is none. */
export function formatCommentLine(team: Team, createdAt: Date, tz = getHandoffTz()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(createdAt);
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const md = `${day}/${month}`;
  if (team === "none") return `${md} -`;
  return `${md} (${teamShort[team]}) -`;
}

export function teamLabelFor(team: Team): string {
  if (team === "none") return "none";
  return teamShort[team];
}
