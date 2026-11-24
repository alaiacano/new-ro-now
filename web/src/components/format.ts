export type YearOption = number | 'upcoming' | null

export const YEAR_OPTS: YearOption[] = [2026, 2025, 2024, 2023, 2022, 'upcoming']

export function yearLabel(y: YearOption): string {
  if (y === 'upcoming') return 'Upcoming'
  return y ? `Since ${y}` : 'All'
}

export function fmtDate(iso: string | null | undefined, withYear = true): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}),
  })
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  return Math.round((day.getTime() - start.getTime()) / 86_400_000)
}
