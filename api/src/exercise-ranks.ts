import { randomUUID } from 'node:crypto';

import type postgres from 'postgres';

export const EXERCISE_RANK_RULE_VERSION = 1;
export type RankMetric = 'estimated_1rm_kg' | 'max_reps' | 'max_duration_seconds';
export type RankTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Transmuted';
export type RankUpdate = { exerciseId: string; tier: RankTier; established: boolean };
export type MuscleProjection = {
  groupId: string; label: string; regionId: string; bodySide: 'front' | 'back';
  eligibleExerciseCount: number; score: number | null; tier: RankTier | null;
  delta: number | null; calculatedAt: Date | null; evidenceExerciseIds: string[];
};

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
  await recomputeRankProjections(sql, userId);
  return updates;
}

const curatedContributions = [
  ['barbell bench press', 'chest', 'Chest', 'chest', 'front', 1],
  ['chest-supported row', 'back', 'Back', 'back', 'back', 1],
  ['shoulder press', 'shoulders', 'Shoulders', 'deltoids', 'front', 1],
  ['back squat', 'quads', 'Quads', 'quadriceps', 'front', 1],
  ['back squat', 'glutes', 'Glutes', 'glutes', 'back', .5],
  ['romanian deadlift', 'hamstrings', 'Hamstrings', 'hamstrings', 'back', 1],
  ['romanian deadlift', 'glutes', 'Glutes', 'glutes', 'back', .5],
  ['standing calf raise', 'calves', 'Calves', 'calves', 'back', 1],
  ['barbell wrist curl', 'arms', 'Arms', 'forearms', 'front', 1],
  ['barbell reverse curl', 'arms', 'Arms', 'forearms', 'front', 1],
] as const;

async function ensureCuratedContributions(sql: Sql) {
  for (const [exerciseName, group, _label, region, side, weight] of curatedContributions) {
    await sql`
      INSERT INTO exercise_muscle_contributions (exercise_id, muscle_group, region_id, body_side, contribution_weight)
      SELECT id, ${group}, ${region}, ${side}, ${weight} FROM exercises WHERE lower(name) = ${exerciseName}
      ON CONFLICT (exercise_id, muscle_group) DO UPDATE SET
        region_id = excluded.region_id, body_side = excluded.body_side, contribution_weight = excluded.contribution_weight
    `;
  }
}

/** Rebuilds versioned group and overall projections from current personal
 * exercise projections. It never creates a population position. */
export async function recomputeRankProjections(sql: Sql, userId: string) {
  await ensureCuratedContributions(sql);
  const calculatedAt = new Date();
  const rows = await sql<{
    muscle_group: string; region_id: string; body_side: 'front' | 'back';
    eligible_exercise_count: number; score: string | null; evidence_exercise_ids: string[];
  }[]>`
    WITH distinct_exercise AS (
      SELECT DISTINCT c.muscle_group, c.region_id, c.body_side, c.contribution_weight, ers.exercise_id,
        (ers.best_value / nullif(ers.baseline_value, 0))::numeric AS ratio
      FROM exercise_rank_snapshots ers
      INNER JOIN exercise_muscle_contributions c ON c.exercise_id = ers.exercise_id
      WHERE ers.user_id = ${userId} AND ers.is_current AND ers.tier IS NOT NULL
        AND ers.baseline_value IS NOT NULL AND ers.best_value IS NOT NULL
    ),
    ranked AS (
      SELECT muscle_group, region_id, body_side, contribution_weight, exercise_id, ratio,
        row_number() OVER (PARTITION BY muscle_group ORDER BY ratio DESC, exercise_id) AS position,
        count(exercise_id) OVER (PARTITION BY muscle_group) AS eligible_count
      FROM distinct_exercise
    )
    SELECT muscle_group, min(region_id) AS region_id, min(body_side) AS body_side,
      max(eligible_count)::int AS eligible_exercise_count,
      (sum(ratio * contribution_weight) FILTER (WHERE position <= 2) /
       nullif(sum(contribution_weight) FILTER (WHERE position <= 2), 0))::text AS score,
      array_agg(exercise_id ORDER BY ratio DESC) FILTER (WHERE position <= 2) AS evidence_exercise_ids
    FROM ranked GROUP BY muscle_group
  `;
  const previous = await sql<{
    muscle_group: string; score: string | null; eligible_exercise_count: number; tier: RankTier | null;
  }[]>`SELECT muscle_group, score::text, eligible_exercise_count, tier FROM muscle_rank_snapshots WHERE user_id = ${userId} AND is_current`;
  const previousByGroup = new Map(previous.map((item) => [item.muscle_group, item]));
  const projections: MuscleProjection[] = [];
  for (const row of rows) {
    const score = row.score == null ? null : Number(row.score);
    const tier = score == null ? null : scoreExerciseRank(1, score).tier;
    const prior = previousByGroup.get(row.muscle_group);
    const previousScore = prior?.score == null ? null : Number(prior.score);
    const changed = !prior || previousScore !== score || prior.eligible_exercise_count !== row.eligible_exercise_count || prior.tier !== tier;
    if (changed) {
      if (prior) await sql`UPDATE muscle_rank_snapshots SET is_current = false, superseded_at = ${calculatedAt} WHERE user_id = ${userId} AND muscle_group = ${row.muscle_group} AND is_current`;
      await sql`INSERT INTO muscle_rank_snapshots
        (id, user_id, muscle_group, region_id, body_side, eligible_exercise_count, score, tier, previous_value, delta_value, evidence_exercise_ids, rule_version, calculated_at)
        VALUES (${randomUUID()}, ${userId}, ${row.muscle_group}, ${row.region_id}, ${row.body_side}, ${row.eligible_exercise_count}, ${score}, ${tier}, ${previousScore}, ${score == null || previousScore == null ? null : score - previousScore}, ${row.evidence_exercise_ids}, ${EXERCISE_RANK_RULE_VERSION}, ${calculatedAt})`;
    }
    projections.push({
      groupId: row.muscle_group, label: curatedContributions.find((item) => item[1] === row.muscle_group)?.[2] ?? row.muscle_group,
      regionId: row.region_id, bodySide: row.body_side, eligibleExerciseCount: row.eligible_exercise_count,
      score, tier, delta: score == null || previousScore == null ? null : score - previousScore,
      calculatedAt: changed ? calculatedAt : null, evidenceExerciseIds: row.evidence_exercise_ids ?? [],
    });
  }
  for (const prior of previous) {
    if (rows.some((row) => row.muscle_group === prior.muscle_group)) continue;
    await sql`UPDATE muscle_rank_snapshots SET is_current = false, superseded_at = ${calculatedAt}
      WHERE user_id = ${userId} AND muscle_group = ${prior.muscle_group} AND is_current`;
    const definition = curatedContributions.find((item) => item[1] === prior.muscle_group);
    if (!definition) continue;
    await sql`INSERT INTO muscle_rank_snapshots
      (id, user_id, muscle_group, region_id, body_side, eligible_exercise_count, score, tier, previous_value, delta_value, evidence_exercise_ids, rule_version, calculated_at)
      VALUES (${randomUUID()}, ${userId}, ${prior.muscle_group}, ${definition[3]}, ${definition[4]}, 0, null, null, ${prior.score == null ? null : Number(prior.score)}, null, ${[] as string[]}, ${EXERCISE_RANK_RULE_VERSION}, ${calculatedAt})`;
    projections.push({ groupId: prior.muscle_group, label: definition[2], regionId: definition[3], bodySide: definition[4], eligibleExerciseCount: 0, score: null, tier: null, delta: null, calculatedAt, evidenceExerciseIds: [] });
  }
  const eligible = await sql<{ count: number }[]>`
    SELECT count(DISTINCT ers.exercise_id)::int AS count FROM exercise_rank_snapshots ers
    INNER JOIN exercise_muscle_contributions c ON c.exercise_id = ers.exercise_id
    WHERE ers.user_id = ${userId} AND ers.is_current AND ers.tier IS NOT NULL
  `;
  const overallScore = projections.length >= 5 && eligible[0].count >= 10
    ? projections.map((item) => item.score!).reduce((left, right) => left + right, 0) / projections.length
    : null;
  const overallTier = overallScore == null ? null : scoreExerciseRank(1, overallScore).tier;
  const placementEligible = overallScore != null;
  const [previousOverall] = await sql<{
    score: string | null; eligible_exercise_count: number; mapped_group_count: number; placement_eligible: boolean; tier: RankTier | null;
  }[]>`SELECT score::text, eligible_exercise_count, mapped_group_count, placement_eligible, tier FROM overall_rank_snapshots WHERE user_id = ${userId} AND is_current`;
  const previousScore = previousOverall?.score == null ? null : Number(previousOverall.score);
  const overallChanged = !previousOverall || previousScore !== overallScore || previousOverall.eligible_exercise_count !== eligible[0].count || previousOverall.mapped_group_count !== projections.length || previousOverall.placement_eligible !== placementEligible || previousOverall.tier !== overallTier;
  if (overallChanged) {
    if (previousOverall) await sql`UPDATE overall_rank_snapshots SET is_current = false, superseded_at = ${calculatedAt} WHERE user_id = ${userId} AND is_current`;
    await sql`INSERT INTO overall_rank_snapshots
      (id, user_id, eligible_exercise_count, mapped_group_count, placement_eligible, score, tier, previous_value, delta_value, evidence_exercise_ids, rule_version, calculated_at)
      VALUES (${randomUUID()}, ${userId}, ${eligible[0].count}, ${projections.length}, ${placementEligible}, ${overallScore}, ${overallTier}, ${previousScore}, ${overallScore == null || previousScore == null ? null : overallScore - previousScore}, ${projections.flatMap((item) => item.evidenceExerciseIds)}, ${EXERCISE_RANK_RULE_VERSION}, ${calculatedAt})`;
  }
  return { projections, overall: { eligibleExerciseCount: eligible[0].count, mappedGroupCount: projections.length, placementEligible, score: overallScore, tier: overallTier } };
}
