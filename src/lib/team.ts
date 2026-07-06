import type { Team } from "@prisma/client";

export const TEAM_VALUES = ["on_shore", "off_shore", "none"] as const;

export function teamSelectLabel(team: Team): string {
  switch (team) {
    case "on_shore":
      return "On-shore";
    case "off_shore":
      return "Off-shore";
    case "none":
      return "None";
  }
}

export function teamTextClass(team: Team): string {
  switch (team) {
    case "on_shore":
      return "text-blue-700";
    case "off_shore":
      return "text-orange-700";
    case "none":
      return "text-green-700";
  }
}

/** Hex color for mail/clipboard HTML export. */
export function teamMailColor(team: Team): string {
  switch (team) {
    case "on_shore":
      return "#1D4ED8";
    case "off_shore":
      return "#C2410C";
    case "none":
      return "#15803D";
  }
}

export function parseTeamValue(value: string): Team | null {
  if (value === "on_shore" || value === "off_shore" || value === "none") return value;
  return null;
}
