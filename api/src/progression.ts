import type postgres from 'postgres';

type Sql = postgres.Sql<Record<string, unknown>>;

export const XP_RULE_VERSION = 1;
export const DAILY_XP_CAP = 300;

export interface RewardDefinition {
  id: string;
  name: string;
  description: string;
  requiredLevel: number;
  emblemKey: string; // e.g. 'ouroboros', 'purify', 'black_sulfur', 'water', 'putrefaction'
}

export const REWARDS_CATALOG: RewardDefinition[] = [
  {
    id: 'emblem_apprentice',
    name: 'Apprentice Insignia',
    description: 'Begin your journey into personal transmutation.',
    requiredLevel: 1,
    emblemKey: 'ouroboros',
  },
  {
    id: 'emblem_purify',
    name: 'Purification Seal',
    description: 'Awarded for reaching Level 2 in consistent training.',
    requiredLevel: 2,
    emblemKey: 'purify',
  },
  {
    id: 'emblem_black_sulfur',
    name: 'Black Sulfur Sigil',
    description: 'Attained upon mastering Level 3 progression.',
    requiredLevel: 3,
    emblemKey: 'black_sulfur',
  },
  {
    id: 'emblem_water',
    name: 'Aquatic Dissolution Emblem',
    description: 'Attained upon reaching Level 4 transmutation.',
    requiredLevel: 4,
    emblemKey: 'water',
  },
  {
    id: 'emblem_putrefaction',
    name: 'Nigredo Transmutation Crest',
    description: 'The highest honor of early transmutation at Level 5.',
    requiredLevel: 5,
    emblemKey: 'putrefaction',
  },
];

export interface MilestoneQuest {
  id: string;
  title: string;
  subtitle: string;
  category: 'workout' | 'strength' | 'level';
  progress: number; // 0.0 to 1.0
  currentValue: number;
  targetValue: number;
  unit: string;
  actionRoute: string;
  actionLabel: string;
}

export interface ProgressionData {
  lifetimeXp: number;
  currentLevel: number;
  currentLevelXp: number;
  nextLevelThreshold: number;
  xpToNextLevel: number;
  levelProgressRatio: number; // 0.0 to 1.0
  todayXpEarned: number;
  todayXpCap: number;
  recentTransactions: Array<{
    id: string;
    sourceType: string;
    xpAmount: number;
    reason: string;
    eventDate: string;
    createdAt: string;
  }>;
  milestones: MilestoneQuest[];
  rewards: Array<{
    id: string;
    name: string;
    description: string;
    requiredLevel: number;
    emblemKey: string;
    isClaimed: boolean;
    claimedAt: string | null;
    canClaim: boolean;
  }>;
}

/**
 * Calculates level threshold: 100 * (L - 1) * L / 2
 * Level 1: 0 XP
 * Level 2: 100 XP
 * Level 3: 300 XP
 * Level 4: 600 XP
 * Level 5: 1000 XP
 */
export function getThresholdForLevel(level: number): number {
  if (level <= 1) return 0;
  return (100 * (level - 1) * level) / 2;
}

export function calculateLevelFromLifetimeXp(lifetimeXp: number): {
  level: number;
  currentLevelThreshold: number;
  nextLevelThreshold: number;
  currentLevelXp: number;
  xpToNextLevel: number;
  progressRatio: number;
} {
  const safeXp = Math.max(0, lifetimeXp);
  let level = 1;
  while (safeXp >= getThresholdForLevel(level + 1)) {
    level++;
  }

  const currentLevelThreshold = getThresholdForLevel(level);
  const nextLevelThreshold = getThresholdForLevel(level + 1);
  const span = nextLevelThreshold - currentLevelThreshold;
  const currentLevelXp = safeXp - currentLevelThreshold;
  const xpToNextLevel = Math.max(0, nextLevelThreshold - safeXp);
  const progressRatio = span > 0 ? Math.min(1, Math.max(0, currentLevelXp / span)) : 1;

  return {
    level,
    currentLevelThreshold,
    nextLevelThreshold,
    currentLevelXp,
    xpToNextLevel,
    progressRatio,
  };
}

/**
 * Award XP to a user with daily cap check (maximum 300 XP per training day).
 * Idempotent per (user_id, source_type, source_id, rule_version).
 */
export async function awardXp(
  sql: Sql,
  userId: string,
  sourceType: string,
  sourceId: string | null,
  rawAmount: number,
  reason: string,
  eventDate: string, // YYYY-MM-DD
  metadata: Record<string, unknown> = {},
): Promise<number> {
  if (rawAmount <= 0) return 0;

  // Check how much XP was already earned on this event date
  const [daySum] = await sql<{ sum: string | null }[]>`
    SELECT sum(xp_amount)::text AS sum
    FROM xp_ledger
    WHERE user_id = ${userId}
      AND event_date = ${eventDate}::date
      AND xp_amount > 0
  `;
  const currentDayXp = Number(daySum?.sum ?? 0);
  const remainingAllowance = Math.max(0, DAILY_XP_CAP - currentDayXp);
  const finalAmount = Math.min(rawAmount, remainingAllowance);

  if (finalAmount <= 0) {
    return 0;
  }

  // Insert ledger entry (idempotent ON CONFLICT DO NOTHING if sourceId provided)
  const inserted = await sql<{ id: string; xp_amount: number }[]>`
    INSERT INTO xp_ledger (
      user_id, source_type, source_id, rule_version, event_date, xp_amount, reason, metadata, created_at
    )
    VALUES (
      ${userId}, ${sourceType}, ${sourceId}, ${XP_RULE_VERSION}, ${eventDate}::date, ${finalAmount}, ${reason}, ${JSON.stringify(metadata)}::jsonb, now()
    )
    ON CONFLICT (user_id, source_type, source_id, rule_version) DO NOTHING
    RETURNING id, xp_amount
  `;

  if (!inserted[0]) {
    // Already awarded
    return 0;
  }

  // Update user_level_snapshots
  await refreshUserLevelSnapshot(sql, userId);
  return inserted[0].xp_amount;
}

export async function refreshUserLevelSnapshot(sql: Sql, userId: string) {
  const [lifetimeRow] = await sql<{ sum: string | null }[]>`
    SELECT sum(xp_amount)::text AS sum
    FROM xp_ledger
    WHERE user_id = ${userId}
  `;
  const lifetimeXp = Math.max(0, Number(lifetimeRow?.sum ?? 0));
  const calc = calculateLevelFromLifetimeXp(lifetimeXp);

  await sql`
    INSERT INTO user_level_snapshots (
      user_id, lifetime_xp, current_level, current_level_xp, next_level_threshold, xp_to_next_level, updated_at
    )
    VALUES (
      ${userId}, ${lifetimeXp}, ${calc.level}, ${calc.currentLevelXp}, ${calc.nextLevelThreshold}, ${calc.xpToNextLevel}, now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      lifetime_xp = EXCLUDED.lifetime_xp,
      current_level = EXCLUDED.current_level,
      current_level_xp = EXCLUDED.current_level_xp,
      next_level_threshold = EXCLUDED.next_level_threshold,
      xp_to_next_level = EXCLUDED.xp_to_next_level,
      updated_at = now()
  `;
}

export async function getUserProgression(sql: Sql, userId: string): Promise<ProgressionData> {
  // Ensure snapshot exists
  await refreshUserLevelSnapshot(sql, userId);

  const [snapshot] = await sql<{
    lifetime_xp: number;
    current_level: number;
    current_level_xp: number;
    next_level_threshold: number;
    xp_to_next_level: number;
  }[]>`
    SELECT lifetime_xp, current_level, current_level_xp, next_level_threshold, xp_to_next_level
    FROM user_level_snapshots
    WHERE user_id = ${userId}
  `;

  const lifetimeXp = snapshot?.lifetime_xp ?? 0;
  const calc = calculateLevelFromLifetimeXp(lifetimeXp);

  // Today's XP earned
  const todayDate = new Date().toISOString().slice(0, 10);
  const [todaySum] = await sql<{ sum: string | null }[]>`
    SELECT sum(xp_amount)::text AS sum
    FROM xp_ledger
    WHERE user_id = ${userId}
      AND event_date = ${todayDate}::date
      AND xp_amount > 0
  `;
  const todayXpEarned = Number(todaySum?.sum ?? 0);

  // Recent transactions
  const transactions = await sql<{
    id: string;
    source_type: string;
    xp_amount: number;
    reason: string;
    event_date: string;
    created_at: Date;
  }[]>`
    SELECT id, source_type, xp_amount, reason, to_char(event_date, 'YYYY-MM-DD') AS event_date, created_at
    FROM xp_ledger
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 10
  `;

  // Reward claims
  const claims = await sql<{ reward_id: string; claimed_at: Date }[]>`
    SELECT reward_id, claimed_at
    FROM reward_claims
    WHERE user_id = ${userId}
  `;
  const claimMap = new Map(claims.map((c) => [c.reward_id, c.claimed_at.toISOString()]));

  const rewards = REWARDS_CATALOG.map((r) => {
    const isClaimed = claimMap.has(r.id);
    const canClaim = !isClaimed && calc.level >= r.requiredLevel;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      requiredLevel: r.requiredLevel,
      emblemKey: r.emblemKey,
      isClaimed,
      claimedAt: claimMap.get(r.id) ?? null,
      canClaim,
    };
  });

  // Calculate dynamic quests / milestones
  // 1. Next level milestone
  // 2. Completed workouts milestone
  // 3. Working sets milestone
  const [stats] = await sql<{ workout_count: number; set_count: number }[]>`
    SELECT
      count(DISTINCT ws.id)::int AS workout_count,
      count(wset.id)::int AS set_count
    FROM workout_sessions ws
    LEFT JOIN workout_sets wset ON wset.session_id = ws.id AND wset.is_warmup = false
    WHERE ws.user_id = ${userId} AND ws.status = 'completed'
  `;
  const workoutCount = stats?.workout_count ?? 0;
  const targetWorkouts = workoutCount < 5 ? 5 : workoutCount < 10 ? 10 : Math.ceil((workoutCount + 1) / 5) * 5;

  const milestones: MilestoneQuest[] = [
    {
      id: 'quest_level',
      title: `Advance to Level ${calc.level + 1}`,
      subtitle: `Earn ${calc.xpToNextLevel} more XP from completed workouts and sets.`,
      category: 'level',
      progress: calc.progressRatio,
      currentValue: calc.currentLevelXp,
      targetValue: calc.nextLevelThreshold - calc.currentLevelThreshold,
      unit: 'XP',
      actionRoute: '/workout',
      actionLabel: 'Train now',
    },
    {
      id: 'quest_workouts',
      title: 'Workout Consistency',
      subtitle: `Complete ${targetWorkouts} verified training sessions.`,
      category: 'workout',
      progress: Math.min(1.0, workoutCount / targetWorkouts),
      currentValue: workoutCount,
      targetValue: targetWorkouts,
      unit: 'workouts',
      actionRoute: '/workout',
      actionLabel: 'Start workout',
    },
  ];

  return {
    lifetimeXp,
    currentLevel: calc.level,
    currentLevelXp: calc.currentLevelXp,
    nextLevelThreshold: calc.nextLevelThreshold,
    xpToNextLevel: calc.xpToNextLevel,
    levelProgressRatio: calc.progressRatio,
    todayXpEarned,
    todayXpCap: DAILY_XP_CAP,
    recentTransactions: transactions.map((t) => ({
      id: t.id,
      sourceType: t.source_type,
      xpAmount: t.xp_amount,
      reason: t.reason,
      eventDate: t.event_date,
      createdAt: t.created_at.toISOString(),
    })),
    milestones,
    rewards,
  };
}
