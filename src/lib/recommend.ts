/**
 * Exercise alternatives, session add-on suggestions and library search. Pure functions.
 */
import type { Equipment, EquipmentProfile, Exercise, Level, MuscleGroup } from './types'
import { EQUIPMENT_LABEL, MUSCLE_LABEL, getBuiltinExercise, patternOf, type MovementPattern } from '../data/exercises'

/** Equipment usable per profile; `null` = everything. */
export const PROFILE_EQUIPMENT: Record<EquipmentProfile, readonly Equipment[] | null> = {
  gym: null,
  home_dumbbells: ['dumbbell', 'bodyweight', 'band', 'bench', 'pullup_bar', 'kettlebell'],
  bodyweight: ['bodyweight', 'pullup_bar', 'band'],
}

/** True when every piece of equipment the exercise needs is available in the profile. */
export function isAvailable(ex: Exercise, profile: EquipmentProfile | undefined): boolean {
  const allowed = profile ? PROFILE_EQUIPMENT[profile] : null
  if (!allowed) return true
  return ex.equipment.every((eq) => allowed.includes(eq))
}

export const LEVEL_RANK: Record<Level, number> = { beginner: 0, intermediate: 1, advanced: 2 }

/** Higher = more similar. Used to rank candidates within the same tier. */
function similarity(target: Exercise, c: Exercise): number {
  let s = 0
  if (c.isCompound === target.isCompound) s += 3
  if (c.kind === target.kind) s += 2
  s += 2 * c.secondary.filter((m) => target.secondary.includes(m)).length
  if (c.equipment.some((e) => target.equipment.includes(e))) s += 1
  s -= Math.abs(LEVEL_RANK[c.level] - LEVEL_RANK[target.level])
  return s
}

/**
 * Patterns that can stand in for each other when nothing closer exists (e.g. burpees → mountain
 * climbers for someone with no equipment). Used only as the last tier.
 */
const RELATED_PATTERNS: Partial<Record<MovementPattern, readonly MovementPattern[]>> = {
  full_body: ['conditioning'],
  conditioning: ['full_body'],
}

/**
 * Best substitutes for `exerciseId`, best first:
 * tier 0 = same movement pattern AND same primary muscle, tier 1 = same primary muscle,
 * tier 2 = same pattern (different primary), tier 3 = a related pattern (full body ↔ conditioning).
 * Only exercises doable with the profile's equipment. Within a tier: most similar first, then the
 * order of `all` (stable). The target is looked up in `all` first, then in the built-in library.
 */
export function alternatives(
  exerciseId: string,
  all: Exercise[],
  equipment: EquipmentProfile | undefined,
  limit = 6,
): Exercise[] {
  const target = all.find((e) => e.id === exerciseId) ?? getBuiltinExercise(exerciseId)
  if (!target || limit <= 0) return []
  const tPattern = patternOf(target.id)
  const related: readonly MovementPattern[] = (tPattern && RELATED_PATTERNS[tPattern]) || []
  const seen = new Set<string>([target.id])
  const ranked: { ex: Exercise; tier: number; score: number; index: number }[] = []

  all.forEach((c, index) => {
    if (seen.has(c.id)) return
    seen.add(c.id)
    if (!isAvailable(c, equipment)) return
    const samePrimary = c.primary === target.primary
    const cPattern = patternOf(c.id)
    const samePattern = tPattern !== undefined && cPattern === tPattern
    const tier =
      samePattern && samePrimary ? 0 : samePrimary ? 1 : samePattern ? 2 : cPattern && related.includes(cPattern) ? 3 : -1
    if (tier < 0) return
    ranked.push({ ex: c, tier, score: similarity(target, c), index })
  })

  ranked.sort((a, b) => a.tier - b.tier || b.score - a.score || a.index - b.index)
  return ranked.slice(0, limit).map((r) => r.ex)
}

/** Rough weekly working-set targets used to detect under-trained muscles. */
export const WEEKLY_SET_TARGET: Partial<Record<MuscleGroup, number>> = {
  back: 10,
  chest: 10,
  quads: 10,
  hamstrings: 8,
  glutes: 8,
  shoulders: 8,
  core: 6,
  triceps: 6,
  biceps: 6,
  calves: 6,
  forearms: 4,
}

/** Tie-break order when two muscles are equally under-trained (bigger muscles first). */
const MUSCLE_PRIORITY = Object.keys(WEEKLY_SET_TARGET) as MuscleGroup[]

/** Estimated sets a session exercise will add (used so suggestions balance today's session too). */
const SESSION_PRIMARY_SETS = 3
const SESSION_SECONDARY_SETS = 1

/**
 * Exercises to add to a session to balance it. Muscles with the lowest weekly volume (relative to
 * WEEKLY_SET_TARGET, counting the current session's exercises as ~3 sets) come first; one pick per
 * muscle in round-robin so suggestions are varied. Within a muscle: isolation/accessories first,
 * movements not already covered by the session's patterns first, easier levels first.
 * `weeklyMuscleSets` = sets per muscle from completed sessions in the last 7 days.
 */
export function suggestAddOns(
  currentExerciseIds: string[],
  weeklyMuscleSets: Partial<Record<MuscleGroup, number>>,
  all: Exercise[],
  equipment: EquipmentProfile | undefined,
  limit = 4,
): Exercise[] {
  if (limit <= 0) return []
  const inSession = new Set(currentExerciseIds)
  const byId = new Map(all.map((e) => [e.id, e]))

  // volume = weekly history + estimate for today's session
  const volume: Partial<Record<MuscleGroup, number>> = { ...weeklyMuscleSets }
  const sessionKeys = new Set<string>() // `${pattern}|${primary}` already covered today
  for (const id of currentExerciseIds) {
    const ex = byId.get(id)
    if (!ex) continue
    volume[ex.primary] = (volume[ex.primary] ?? 0) + SESSION_PRIMARY_SETS
    for (const m of ex.secondary) volume[m] = (volume[m] ?? 0) + SESSION_SECONDARY_SETS
    sessionKeys.add(`${patternOf(ex.id) ?? 'custom'}|${ex.primary}`)
  }

  // candidates grouped by primary muscle
  const groups = new Map<MuscleGroup, { ex: Exercise; key: number[] }[]>()
  all.forEach((ex, index) => {
    if (inSession.has(ex.id) || !isAvailable(ex, equipment)) return
    if (WEEKLY_SET_TARGET[ex.primary] === undefined) return // cardio / full body are not "balance" work
    const redundant = sessionKeys.has(`${patternOf(ex.id) ?? 'custom'}|${ex.primary}`) ? 1 : 0
    const key = [redundant, ex.isCompound ? 1 : 0, LEVEL_RANK[ex.level], index]
    const list = groups.get(ex.primary) ?? []
    list.push({ ex, key })
    groups.set(ex.primary, list)
  })
  for (const list of groups.values()) {
    list.sort((a, b) => {
      for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i]
      return 0
    })
  }

  const ratio = (m: MuscleGroup) => (volume[m] ?? 0) / (WEEKLY_SET_TARGET[m] ?? 1)
  const muscles = [...groups.keys()].sort(
    (a, b) => ratio(a) - ratio(b) || MUSCLE_PRIORITY.indexOf(a) - MUSCLE_PRIORITY.indexOf(b),
  )

  const out: Exercise[] = []
  const used = new Set<string>()
  for (let round = 0; out.length < limit; round++) {
    let added = false
    for (const m of muscles) {
      const pick = groups.get(m)?.[round]
      if (!pick || used.has(pick.ex.id)) continue
      used.add(pick.ex.id)
      out.push(pick.ex)
      added = true
      if (out.length >= limit) break
    }
    if (!added) break
  }
  return out
}

/** Lowercase, strip accents/diacritics, collapse punctuation and whitespace. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

interface SearchIndex {
  name: string
  nameWords: string[]
  aliases: string[]
  allWords: string[]
  text: string // name + aliases
  primary: string
  extra: string // secondary muscles + equipment labels
}

const indexCache = new WeakMap<Exercise, SearchIndex>()

function indexOf(ex: Exercise): SearchIndex {
  let idx = indexCache.get(ex)
  if (idx) return idx
  const name = normalizeText(ex.name)
  const aliases = ex.aliases.map(normalizeText).filter(Boolean)
  const text = [name, ...aliases].join(' ')
  idx = {
    name,
    nameWords: name.split(' '),
    aliases,
    allWords: text.split(' '),
    text,
    primary: normalizeText(MUSCLE_LABEL[ex.primary] ?? ''),
    extra: [...ex.secondary.map((m) => MUSCLE_LABEL[m] ?? ''), ...ex.equipment.map((e) => EQUIPMENT_LABEL[e] ?? '')]
      .map(normalizeText)
      .join(' '),
  }
  indexCache.set(ex, idx)
  return idx
}

/**
 * 0 = best, -1 = no match.
 * 0 name starts with the query · 1 the query names the primary muscle ("pecho", "pecho mancuernas")
 * · 2 every word is a word-prefix of the name · 3 an alias starts with the query · 4 word-prefixes
 * across name + aliases · 5 substrings of name + aliases · 6 + primary muscle · 7 + secondary
 * muscles and equipment.
 */
function matchRank(idx: SearchIndex, q: string, tokens: string[]): number {
  if (idx.name.startsWith(q)) return 0
  const isPrefixIn = (t: string, words: string[]) => words.some((w) => w.startsWith(t))
  const prefixOf = (words: string[]) => tokens.every((t) => isPrefixIn(t, words))
  const primaryWords = idx.primary.split(' ')
  if (tokens.some((t) => isPrefixIn(t, primaryWords)) && prefixOf([...idx.nameWords, ...primaryWords])) return 1
  if (prefixOf(idx.nameWords)) return 2
  if (idx.aliases.some((a) => a.startsWith(q))) return 3
  if (prefixOf(idx.allWords)) return 4
  if (tokens.every((t) => idx.text.includes(t))) return 5
  const withPrimary = `${idx.text} ${idx.primary}`
  if (tokens.every((t) => withPrimary.includes(t))) return 6
  const withExtra = `${withPrimary} ${idx.extra}`
  if (tokens.every((t) => withExtra.includes(t))) return 7
  return -1
}

const byName = (a: Exercise, b: Exercise) => a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id)

/** Connector words ignored when matching ("curl de bíceps" → curl + biceps), unless the query is only that. */
const STOP_WORDS = new Set(['a', 'al', 'con', 'de', 'del', 'el', 'en', 'la', 'las', 'lo', 'los', 'para', 'por', 'un', 'una', 'y'])

/**
 * Case/accent-insensitive search over name + aliases + muscle labels (+ equipment labels).
 * Prefix matches rank first. Empty query returns everything sorted by name.
 */
export function searchExercises(query: string, all: Exercise[]): Exercise[] {
  const q = normalizeText(query)
  if (!q) return all.slice().sort(byName)
  const words = q.split(' ')
  const meaningful = words.filter((w) => !STOP_WORDS.has(w))
  const tokens = meaningful.length > 0 ? meaningful : words
  const hits: { ex: Exercise; rank: number }[] = []
  for (const ex of all) {
    const rank = matchRank(indexOf(ex), q, tokens)
    if (rank >= 0) hits.push({ ex, rank })
  }
  hits.sort((a, b) => a.rank - b.rank || byName(a.ex, b.ex))
  return hits.map((h) => h.ex)
}
