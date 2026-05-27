import type { Team } from "@prisma/client";
import { getHandoffTz } from "./env";

const teamLabel: Record<Team, string> = {
  on_shore: "on-shore team",
  off_shore: "off-shore team",
};

/** Bracketed DD-MM-YYYY date + team prefix for display. */
export function formatCommentLine(team: Team, createdAt: Date, tz = getHandoffTz()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(createdAt);
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const md = `${day}-${month}-${year}`;
  return `[${md}] ${teamLabel[team]} -`;
}

export function teamLabelFor(team: Team): string {
  return teamLabel[team];
}
