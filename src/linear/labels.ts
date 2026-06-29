import type { LinearLabel } from "./types.js";

export function formatLabel(label: LinearLabel): string {
  return label.parent?.name ? `${label.parent.name}:${label.name}` : label.name;
}

export function matchesLabel(label: LinearLabel, expected: string): boolean {
  return label.name === expected || formatLabel(label) === expected;
}
