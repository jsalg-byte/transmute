import { randomUUID } from 'node:crypto';

import type postgres from 'postgres';

export const ARCANA_RULE_VERSION = 1;
export const arcanaStages = ['unrevealed', 'revealed', 'refined', 'illuminated', 'mastered'] as const;
export type ArcanaStage = typeof arcanaStages[number];
export type ArcanaSlot = 'past' | 'present' | 'becoming';

export type ArcanaDefinition = {
  id: string;
  number: string;
  name: string;
  meaning: string;
  nextHint: string;
  source: 'commons-alchemical-symbols' | 'original-geometric';
};

export const arcanaDefinitions: ArcanaDefinition[] = [
  ['fool', '0', 'The Fool', 'Beginning the work.', 'Complete qualified sessions to establish the record.'],
  ['magician', 'I', 'The Magician', 'Using every tool.', 'Bring training, food, and recovery into the same week.'],
  ['emperor', 'IV', 'The Emperor', 'Building structure.', 'Complete the work you scheduled in a training block.'],
  ['chariot', 'VII', 'The Chariot', 'Creating momentum.', 'Meet your weekly training target consistently.'],
  ['strength', 'VIII', 'Strength', 'Turning effort into greater capacity.', 'Build repeatable personal progress.'],
  ['hermit', 'IX', 'The Hermit', 'Reflecting on the record.', 'Review the work and make an informed adjustment.'],
  ['justice', 'XI', 'Justice', 'Measuring honestly.', 'Assess a goal and record the decision it asks for.'],
  ['hanged-man', 'XII', 'The Hanged Man', 'Understanding restraint.', 'Use a planned recovery adjustment when it is needed.'],
  ['death', 'XIII', 'Death', 'Ending what no longer works.', 'Close a plan with intention and begin the next one.'],
  ['temperance', 'XIV', 'Temperance', 'Balancing the work.', 'Sustain training, nutrition, and recovery together.'],
  ['tower', 'XVI', 'The Tower', 'Returning after disruption.', 'Return to the work after a meaningful interruption.'],
  ['star', 'XVII', 'The Star', 'Rebuilding momentum.', 'Turn a return into a steady rebuilding period.'],
  ['sun', 'XIX', 'The Sun', 'Reaching a meaningful goal.', 'Complete a goal you set for yourself.'],
  ['judgement', 'XX', 'Judgement', 'Comparing then and now.', 'Reassess the record and choose the next direction.'],
  ['world', 'XXI', 'The World', 'Completing the cycle.', 'Close a full cycle of plan, work, review, and assessment.'],
].map(([id, number, name, meaning, nextHint]) => ({ id, number, name, meaning, nextHint, source: 'original-geometric' }));

type Sql = postgres.Sql<Record<string, unknown>>;
type QualifiedSession = { id: string; ended_at: Date; working_sets: number };
type Block = { id: string; status: string; start_date: string; end_date: string; weekly_target: number; ended_reason: string | null; replacement_block_id: string | null; scheduled_count: number; completed_count: number; recovery_count: number };
type Review = { id: string; decision: string; created_at: Date };
type Goal = { id: string; domain: string; status: string; created_at: Date; assessment_count: number; decision_count: number };

function dateKey(value: Date | string) {
  const date = new Date(value);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function weekKey(value: Date | string) {
  const date = new Date(value);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return dateKey(date);
}

function longestRun(weeks: string[]) {
  const unique = [...new Set(weeks)].sort();
  let longest = 0;
  let current = 0;
  let previous: Date | null = null;
  for (const key of unique) {
    const value = new Date(`${key}T12:00:00Z`);
    if (previous && value.getTime() - previous.getTime() === 7 * 86_400_000) current += 1;
    else current = 1;
    longest = Math.max(longest, current);
    previous = value;
  }
  return longest;
}

function stageFor(thresholds: boolean[]) {
  return thresholds.reduce((stage, complete, index) => complete ? index + 1 : stage, 0);
}

export function resolvePermanentStage(previousStage: number, calculatedStage: number) {
  return Math.max(previousStage, calculatedStage);
}

function stageName(stage: number): ArcanaStage {
  return arcanaStages[Math.max(0, Math.min(stage, arcanaStages.length - 1))];
}

function evidence(sourceIds: string[], summary: string, stats: Record<string, number | string | boolean>) {
  return { triggeringEventIds: sourceIds.slice(0, 12), summary, stats };
}

export async function recordProgressionEvent(sql: Sql, userId: string, eventType: string, sourceType: string, sourceId: string | null, payload: Record<string, unknown> = {}) {
  const [event] = await sql<{ id: string }[]>`
    INSERT INTO progression_events (id, user_id, event_type, source_type, source_id, payload)
    VALUES (${randomUUID()}, ${userId}, ${eventType}, ${sourceType}, ${sourceId}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (user_id, event_type, source_type, source_id, source_revision) DO NOTHING
    RETURNING id
  `;
  return event?.id ?? null;
}

export async function evaluateArcanaForUser(sql: Sql, userId: string, source: 'live' | 'recovered' = 'live') {
  const [qualified, meals, checkins, blocks, reviews, goals, performances, targetRows, currentStates, pins, events] = await Promise.all([
    sql<QualifiedSession[]>`
      SELECT ws.id, ws.ended_at, count(wset.id)::int AS working_sets
      FROM workout_sessions ws
      INNER JOIN workout_sets wset ON wset.session_id = ws.id AND wset.is_warmup = false
      WHERE ws.user_id = ${userId} AND ws.status = 'completed' AND ws.ended_at IS NOT NULL
      GROUP BY ws.id HAVING count(wset.id) >= 3 ORDER BY ws.ended_at ASC
    `,
    sql<{ day: Date }[]>`SELECT DISTINCT consumed_at::date AS day FROM meal_logs WHERE user_id = ${userId}`,
    sql<{ checked_on: Date }[]>`SELECT checked_on FROM recovery_checkins WHERE user_id = ${userId}`,
    sql<Block[]>`
      SELECT b.id, b.status, b.start_date::text, b.end_date::text, b.weekly_target, b.ended_reason, b.replacement_block_id,
        count(s.id)::int AS scheduled_count,
        count(s.id) FILTER (WHERE s.status = 'completed')::int AS completed_count,
        count(s.id) FILTER (WHERE s.status = 'recovery' OR s.is_deload OR s.is_recovery_session)::int AS recovery_count
      FROM training_blocks b LEFT JOIN training_block_sessions s ON s.block_id = b.id
      WHERE b.user_id = ${userId} GROUP BY b.id ORDER BY b.start_date ASC
    `,
    sql<Review[]>`SELECT id, decision, created_at FROM weekly_reviews WHERE user_id = ${userId} ORDER BY created_at ASC`,
    sql<Goal[]>`
      SELECT g.id, g.domain, g.status, g.created_at,
        count(a.id)::int AS assessment_count,
        count(a.id) FILTER (WHERE a.decision IS NOT NULL AND btrim(a.decision) <> '')::int AS decision_count
      FROM goals g LEFT JOIN goal_assessments a ON a.goal_id = g.id
      WHERE g.user_id = ${userId} GROUP BY g.id ORDER BY g.created_at ASC
    `,
    sql<{ exercise_id: string; ended_at: Date; reps: number; weight: string | null }[]>`
      SELECT wset.exercise_id, ws.ended_at, wset.reps, wset.weight
      FROM workout_sets wset INNER JOIN workout_sessions ws ON ws.id = wset.session_id
      WHERE ws.user_id = ${userId} AND ws.status = 'completed' AND ws.ended_at IS NOT NULL
        AND wset.is_warmup = false AND wset.reps BETWEEN 1 AND 10 AND wset.weight IS NOT NULL
      ORDER BY ws.ended_at ASC
    `,
    sql<{ meal_days_per_week: number }[]>`SELECT meal_days_per_week FROM nutrition_adherence_targets WHERE user_id = ${userId} LIMIT 1`,
    sql<{ card_id: string; highest_stage: number; stage_evidence: Record<string, unknown> }[]>`SELECT card_id, highest_stage, stage_evidence FROM user_arcana_states WHERE user_id = ${userId}`,
    sql<{ slot: ArcanaSlot; card_id: string }[]>`SELECT slot, card_id FROM user_arcana_pins WHERE user_id = ${userId}`,
    sql<{ id: string; source_id: string | null }[]>`SELECT id, source_id FROM progression_events WHERE user_id = ${userId}`,
  ]);

  const eventIdsBySource = new Map(events.filter((event) => event.source_id).map((event) => [event.source_id as string, event.id]));

  const weeklyTarget = 2;
  const mealTarget = targetRows[0]?.meal_days_per_week ?? 4;
  const sessionWeeks = new Map<string, number>();
  for (const session of qualified) sessionWeeks.set(weekKey(session.ended_at), (sessionWeeks.get(weekKey(session.ended_at)) ?? 0) + 1);
  const mealWeeks = new Map<string, number>();
  for (const meal of meals) mealWeeks.set(weekKey(meal.day), (mealWeeks.get(weekKey(meal.day)) ?? 0) + 1);
  const recoveryWeeks = new Map<string, number>();
  for (const checkin of checkins) recoveryWeeks.set(weekKey(checkin.checked_on), (recoveryWeeks.get(weekKey(checkin.checked_on)) ?? 0) + 1);
  const consistentWeeks = [...sessionWeeks.entries()].filter(([, count]) => count >= weeklyTarget).map(([week]) => week);
  const balancedWeeks = consistentWeeks.filter((week) => (mealWeeks.get(week) ?? 0) >= mealTarget && (recoveryWeeks.get(week) ?? 0) >= 4);
  const consistentRun = longestRun(consistentWeeks);
  const balancedRun = longestRun(balancedWeeks);

  const performanceByExercise = new Map<string, Array<{ date: Date; score: number }>>();
  for (const item of performances) {
    const weight = Number(item.weight);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const values = performanceByExercise.get(item.exercise_id) ?? [];
    values.push({ date: item.ended_at, score: weight * (1 + item.reps / 30) });
    performanceByExercise.set(item.exercise_id, values);
  }
  const prDates = new Set<string>();
  let sustainedImprovement = false;
  for (const values of performanceByExercise.values()) {
    let highest = 0;
    const baseline = values.slice(0, 3).map((item) => item.score).sort((a, b) => a - b)[1];
    for (const item of values) {
      if (highest > 0 && item.score > highest * 1.005) prDates.add(dateKey(item.date));
      highest = Math.max(highest, item.score);
    }
    if (baseline && values.length >= 8 && highest >= baseline * 1.05) sustainedImprovement = true;
  }

  const completedBlocks = blocks.filter((block) => block.status === 'completed');
  const structuredBlocks = blocks.filter((block) => block.scheduled_count > 0);
  const highAdherenceBlocks = structuredBlocks.filter((block) => block.completed_count / Math.max(block.scheduled_count, 1) >= 0.8);
  const recoveryAdjustments = blocks.reduce((sum, block) => sum + block.recovery_count, 0);
  const replacementBlocks = blocks.filter((block) => Boolean(block.replacement_block_id));
  const completedGoals = goals.filter((goal) => goal.status === 'completed');
  const reassessedGoals = goals.filter((goal) => goal.assessment_count > 0);
  const decidedGoals = goals.filter((goal) => goal.decision_count > 0);
  const decisions = reviews.filter((review) => review.decision.trim().length > 0).length;
  const sessionDates = qualified.map((session) => session.ended_at).sort((a, b) => a.getTime() - b.getTime());
  let returnSessions = 0;
  let hasDisruption = false;
  for (let index = 1; index < sessionDates.length; index += 1) {
    if (sessionDates[index].getTime() - sessionDates[index - 1].getTime() >= 14 * 86_400_000) {
      hasDisruption = true;
      returnSessions = sessionDates.length - index;
    }
  }

  const stages: Record<string, { stage: number; summary: string; stats: Record<string, number | string | boolean>; sourceIds: string[] }> = {
    fool: { stage: stageFor([qualified.length >= 1, qualified.length >= 3, qualified.length >= 10 && consistentWeeks.length >= 1, qualified.length >= 50 && consistentWeeks.length >= 12]), summary: 'Qualified sessions recover the beginning of the work.', stats: { qualifiedSessions: qualified.length, activeWeeks: consistentWeeks.length }, sourceIds: qualified.map((session) => session.id) },
    magician: { stage: stageFor([balancedWeeks.length >= 1, balancedWeeks.length >= 3, balancedRun >= 4, balancedWeeks.length >= 12]), summary: 'Balanced weeks combine training, meals, and recovery check-ins.', stats: { balancedWeeks: balancedWeeks.length, longestRun: balancedRun }, sourceIds: [] },
    emperor: { stage: stageFor([structuredBlocks.some((block) => block.completed_count >= 1), highAdherenceBlocks.length >= 1, completedBlocks.some((block) => block.completed_count / Math.max(block.scheduled_count, 1) >= 0.85), highAdherenceBlocks.length >= 2]), summary: 'Training blocks provide the record of planned work.', stats: { structuredBlocks: structuredBlocks.length, highAdherenceBlocks: highAdherenceBlocks.length }, sourceIds: structuredBlocks.map((block) => block.id) },
    chariot: { stage: stageFor([consistentWeeks.length >= 1, consistentRun >= 4, consistentRun >= 8, consistentRun >= 16]), summary: 'Consistent weeks measure momentum.', stats: { consistentWeeks: consistentWeeks.length, longestRun: consistentRun }, sourceIds: qualified.map((session) => session.id) },
    strength: { stage: stageFor([prDates.size >= 1, prDates.size >= 3, sustainedImprovement, sustainedImprovement && prDates.size >= 6]), summary: 'Strength is based on comparable non-warmup performances.', stats: { personalBestDates: prDates.size, sustainedImprovement }, sourceIds: qualified.map((session) => session.id) },
    hermit: { stage: stageFor([reviews.length >= 1, reviews.length >= 4, decisions >= 1 && qualified.length >= 3, reviews.length >= 12 && decisions >= 3]), summary: 'Reviews turn the record into an intentional next step.', stats: { reviews: reviews.length, decisions }, sourceIds: reviews.map((review) => review.id) },
    justice: { stage: stageFor([goals.length >= 1, reassessedGoals.length >= 1, decidedGoals.length >= 1, decidedGoals.length >= 3]), summary: 'Goals, reassessments, and decisions make measurement honest.', stats: { goals: goals.length, reassessedGoals: reassessedGoals.length, decidedGoals: decidedGoals.length }, sourceIds: goals.map((goal) => goal.id) },
    'hanged-man': { stage: stageFor([recoveryAdjustments >= 1, recoveryAdjustments >= 3, completedBlocks.some((block) => block.recovery_count >= 1), completedBlocks.filter((block) => block.recovery_count >= 1).length >= 3]), summary: 'Planned recovery is recorded as part of the work.', stats: { recoveryAdjustments, completedRecoveryBlocks: completedBlocks.filter((block) => block.recovery_count >= 1).length }, sourceIds: structuredBlocks.map((block) => block.id) },
    death: { stage: stageFor([blocks.some((block) => block.status === 'archived' && Boolean(block.ended_reason)), replacementBlocks.length >= 1, replacementBlocks.some((block) => block.completed_count >= 4), replacementBlocks.length >= 1 && highAdherenceBlocks.length >= 1]), summary: 'A replacement block records purposeful change.', stats: { archivedBlocks: blocks.filter((block) => block.status === 'archived').length, replacements: replacementBlocks.length }, sourceIds: blocks.map((block) => block.id) },
    temperance: { stage: stageFor([balancedWeeks.length >= 1, balancedWeeks.length >= 4, balancedWeeks.length >= 8, balancedWeeks.length >= 16]), summary: 'Balance is measured without requiring perfection.', stats: { balancedWeeks: balancedWeeks.length }, sourceIds: [] },
    tower: { stage: stageFor([hasDisruption, hasDisruption && returnSessions >= 3, hasDisruption && consistentRun >= 2, hasDisruption && consistentRun >= 8]), summary: 'The Tower recognizes the return after a real interruption.', stats: { hasDisruption, returnSessions, consistentRun }, sourceIds: qualified.map((session) => session.id) },
    star: { stage: stageFor([hasDisruption && consistentRun >= 2, hasDisruption && consistentRun >= 4 && checkins.length >= 4, hasDisruption && sustainedImprovement, hasDisruption && consistentRun >= 12 && sustainedImprovement]), summary: 'The Star is rebuilding after the return.', stats: { consistentRun, sustainedImprovement }, sourceIds: qualified.map((session) => session.id) },
    sun: { stage: stageFor([completedGoals.length >= 1, completedGoals.length >= 2, new Set(completedGoals.map((goal) => goal.domain)).size >= 2, completedGoals.length >= 4 && reassessedGoals.length >= 1]), summary: 'The Sun requires goals created before their completion.', stats: { completedGoals: completedGoals.length, goalDomains: new Set(completedGoals.map((goal) => goal.domain)).size }, sourceIds: completedGoals.map((goal) => goal.id) },
    judgement: { stage: stageFor([reassessedGoals.length >= 1, reassessedGoals.length >= 1 && goals.length >= 1, decidedGoals.length >= 1, reassessedGoals.length >= 3]), summary: 'Judgement compares an assessment with the earlier record.', stats: { reassessedGoals: reassessedGoals.length, decidedGoals: decidedGoals.length }, sourceIds: reassessedGoals.map((goal) => goal.id) },
    world: { stage: stageFor([completedBlocks.length >= 1 && goals.length >= 1 && reviews.length >= 1 && reassessedGoals.length >= 1, completedBlocks.length >= 2, completedBlocks.length >= 3 && decisions >= 1, completedBlocks.length >= 4 && sustainedImprovement]), summary: 'The World joins plan, work, review, and reassessment into one cycle.', stats: { completedBlocks: completedBlocks.length, goals: goals.length, reviews: reviews.length, reassessedGoals: reassessedGoals.length }, sourceIds: completedBlocks.map((block) => block.id) },
  };

  const currentByCard = new Map(currentStates.map((state) => [state.card_id, state]));
  const cards = [] as Array<Record<string, unknown>>;
  for (const definition of arcanaDefinitions) {
    const calculated = stages[definition.id];
    const previous = currentByCard.get(definition.id);
    const highestStage = resolvePermanentStage(previous?.highest_stage ?? 0, calculated.stage);
    const nextStage = Math.min(highestStage + 1, 4);
    const stageEvidence = previous?.stage_evidence ?? {};
    if (highestStage > (previous?.highest_stage ?? 0)) {
      const triggeringEventIds = calculated.sourceIds.map((id) => eventIdsBySource.get(id)).filter((id): id is string => Boolean(id));
      const nextEvidence = { ...stageEvidence, [stageName(highestStage)]: { ...evidence(triggeringEventIds, calculated.summary, calculated.stats), source, earnedAt: new Date().toISOString() } };
      await sql`
        INSERT INTO user_arcana_states (user_id, card_id, rule_version, highest_stage, stage_evidence)
        VALUES (${userId}, ${definition.id}, ${ARCANA_RULE_VERSION}, ${highestStage}, ${JSON.stringify(nextEvidence)}::jsonb)
        ON CONFLICT (user_id, card_id) DO UPDATE SET
          rule_version = EXCLUDED.rule_version,
          highest_stage = GREATEST(user_arcana_states.highest_stage, EXCLUDED.highest_stage),
          stage_evidence = EXCLUDED.stage_evidence,
          updated_at = now()
      `;
    } else if (!previous) {
      await sql`INSERT INTO user_arcana_states (user_id, card_id, rule_version, highest_stage) VALUES (${userId}, ${definition.id}, ${ARCANA_RULE_VERSION}, 0) ON CONFLICT DO NOTHING`;
    }
    const triggeringEventIds = calculated.sourceIds.map((id) => eventIdsBySource.get(id)).filter((id): id is string => Boolean(id));
    const resolvedEvidence = highestStage > (previous?.highest_stage ?? 0)
      ? { ...stageEvidence, [stageName(highestStage)]: { ...evidence(triggeringEventIds, calculated.summary, calculated.stats), source, earnedAt: new Date().toISOString() } }
      : stageEvidence;
    const activeEvidence = resolvedEvidence[stageName(highestStage)] as { earnedAt?: string } | undefined;
    cards.push({
      id: definition.id,
      number: definition.number,
      name: definition.name,
      focus: definition.meaning,
      source: definition.source,
      stage: stageName(highestStage),
      earnedAt: activeEvidence?.earnedAt ?? null,
      stageEvidence: resolvedEvidence,
      nextMilestone: highestStage >= 4 ? null : { stage: stageName(nextStage), description: definition.nextHint, current: highestStage, target: 4 },
    });
  }
  return { ruleVersion: ARCANA_RULE_VERSION, cards, pins: Object.fromEntries(pins.map((pin) => [pin.slot, pin.card_id])) };
}
