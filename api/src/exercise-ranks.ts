import { randomUUID } from 'node:crypto';

import type postgres from 'postgres';

export const EXERCISE_RANK_RULE_VERSION = 1;
export type RankMetric = 'estimated_1rm_kg' | 'max_reps' | 'max_duration_seconds';
export type RankTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Transmuted';
export type RankUpdate = { exerciseId: string; tier: RankTier; established: boolean };

type Sql = postgres.Sql<Record<string, unknown>>;
type Candidate = {
  exercise_id: string; session_id: string; set_id: string; ended_at: Date;
  tracking_mode: 'reps' | 'timed'; metric: RankMetric; value: string;
};

const thresholds: Array<{ tier: RankTier; lower: number; upper: number | null }> = [
  { tier: 'Bronze', lower: 1, upper: 1.05 },
  { tier: 'Silver', lower: 1.05, upper: 1.15 },
  { tier: 'Gold', lower: 1.15, upper: 1.30 },
  { tier: 'Platinum', lower: 1.30, upper: 1.50 },
  { tier: 'Transmuted', lower: 1.50, upper: null },
];

export function scoreExerciseRank(baselineValue: number, bestValue: number) {
  const ratio = bestValue / baselineValue;
  const definition = [...thresholds].reverse().find((row) => ratio >= row.lower) ?? thresholds[0];
  const next = definition.upper == null ? null : baselineValue * definition.upper;
  const progress = definition.upper == null
    ? 100
    : Math.max(0, Math.min(99, Math.floor(100 * (ratio - definition.lower) / (definition.upper - definition.lower))));
  const span = definition.upper == null ? 1 : (definition.upper - definition.lower) / 3;
  const subdivision = definition.upper == null ? 3 : Math.min(3, Math.floor((ratio - definition.lower) / span) + 1);
  return { ratio, tier: definition.tier, subdivision, progress, next };
}

function dayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

/** Rebuilds current projections from completed, non-warm-up evidence only.
 * Session dates currently use the persisted UTC completion date because the
 * account preference contract has no timezone field yet. */
export async function recomputeExerciseRanks(sql: Sql, userId: string, exerciseIds?: string[]): Promise<RankUpdate[]> {
  const ids = exerciseIds?.length ? [...new Set(exerciseIds)] : undefined;
  const previousRows = await sql<{ exercise_id: string; tracking_mode: string; metric: string; tier: RankTier | null }[]>`
    SELECT exercise_id, tracking_mode, metric, tier FROM exercise_rank_snapshots
    WHERE user_id = ${userId} AND is_current ${ids ? sql`AND exercise_id = ANY(${ids}::uuid[])` : sql``}
  `;
  const previous = new Map(previousRows.map((row) => [`${row.exercise_id}:${row.tracking_mode}:${row.metric}`, row.tier]));
  const updates: RankUpdate[] = [];
  if (ids) {
    await sql`UPDATE exercise_rank_snapshots SET is_current = false, superseded_at = now()
      WHERE user_id = ${userId} AND is_current AND exercise_id = ANY(${ids}::uuid[])`;
  } else {
    await sql`UPDATE exercise_rank_snapshots SET is_current = false, superseded_at = now()
      WHERE user_id = ${userId} AND is_current`;
  }
  const rows = await sql<Candidate[]>`
    WITH qualified_sessions AS (
      SELECT ws.id, ws.ended_at
      FROM workout_sessions ws
      INNER JOIN workout_sets all_sets ON all_sets.session_id = ws.id AND all_sets.is_warmup = false
      WHERE ws.user_id = ${userId} AND ws.status = 'completed' AND ws.ended_at IS NOT NULL
      GROUP BY ws.id, ws.ended_at HAVING count(all_sets.id) >= 3
    ), scored AS (
      SELECT wset.exercise_id, qs.id AS session_id, wset.id AS set_id, qs.ended_at,
        CASE WHEN wset.duration_seconds IS NOT NULL THEN 'timed' ELSE 'reps' END AS tracking_mode,
        CASE
          WHEN wset.duration_seconds IS NOT NULL THEN 'max_duration_seconds'
          WHEN coalesce(wset.weight, 0) > 0 THEN 'estimated_1rm_kg'
          ELSE 'max_reps'
        END AS metric,
        CASE
          WHEN wset.duration_seconds IS NOT NULL THEN wset.duration_seconds::numeric
          WHEN coalesce(wset.weight, 0) > 0 THEN wset.weight * (1 + least(wset.reps, 12)::numeric / 30)
          ELSE wset.reps::numeric
        END AS value
      FROM workout_sets wset INNER JOIN qualified_sessions qs ON qs.id = wset.session_id
      WHERE wset.is_warmup = false ${ids ? sql`AND wset.exercise_id = ANY(${ids}::uuid[])` : sql``}
    )
    SELECT exercise_id, session_id, set_id, ended_at, tracking_mode, metric, value::text
    FROM scored ORDER BY exercise_id, tracking_mode, metric, ended_at ASC, value DESC, set_id ASC
  `;
  const grouped = new Map<string, Candidate[]>();
  for (const row of rows) {
    const key = `${row.exercise_id}:${row.tracking_mode}:${row.metric}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  for (const values of grouped.values()) {
    const sessionBest = new Map<string, Candidate>();
    for (const row of values) {
      const existing = sessionBest.get(row.session_id);
      if (!existing || Number(row.value) > Number(existing.value)) sessionBest.set(row.session_id, row);
    }
    const distinctDates: Candidate[] = [];
    const dateSeen = new Set<string>();
    for (const row of sessionBest.values()) {
      const day = dayKey(row.ended_at);
      if (!dateSeen.has(day)) { dateSeen.add(day); distinctDates.push(row); }
    }
    const first = values[0];
    const evidence = [...sessionBest.values()];
    const baseline = distinctDates.length >= 2
      ? Math.max(Number(distinctDates[0].value), Number(distinctDates[1].value))
      : null;
    const best = evidence.reduce((max, row) => Math.max(max, Number(row.value)), 0);
    const scored = baseline == null ? null : scoreExerciseRank(baseline, best);
    await sql`INSERT INTO exercise_rank_snapshots
      (id, user_id, exercise_id, tracking_mode, metric, baseline_value, best_value, tier, subdivision, progress_points, next_threshold, evidence_session_ids, evidence_set_ids, rule_version)
      VALUES (${randomUUID()}, ${userId}, ${first.exercise_id}, ${first.tracking_mode}, ${first.metric},
        ${baseline}, ${best || null}, ${scored?.tier ?? null}, ${scored?.subdivision ?? null}, ${scored?.progress ?? null}, ${scored?.next ?? null},
        ${evidence.map((row) => row.session_id)}, ${evidence.map((row) => row.set_id)}, ${EXERCISE_RANK_RULE_VERSION})`;
    if (scored != null) {
      const key = `${first.exercise_id}:${first.tracking_mode}:${first.metric}`;
      const before = previous.get(key);
      const order = thresholds.map((item) => item.tier);
      if (before == null || order.indexOf(scored.tier) > order.indexOf(before)) {
        updates.push({ exerciseId: first.exercise_id, tier: scored.tier, established: before == null });
      }
    }
  }
  return updates;
}
