import type { LinearLabel } from "./types.js"

export const formatLabel = (label: LinearLabel): string =>
  label.parent?.name ? `${label.parent.name}:${label.name}` : label.name

export const matchesLabel = (label: LinearLabel, expected: string): boolean =>
  label.name === expected || formatLabel(label) === expected
