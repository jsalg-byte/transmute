import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface SocialPrivacyPreferences {
  socialActivityOptIn: boolean;
  leagueOptIn: boolean;
}

export interface ActivityEvent {
  id: string;
  userId: string;
  username: string;
  name: string | null;
  startedAt: string;
  status: string;
  routineName: string | null;
  dayName: string | null;
  setCount: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  name: string | null;
  xp: number;
  qualifiedSessions: number;
  isCurrentUser: boolean;
}

export interface LeaderboardResponse {
  period: string; // e.g. '2026-10'
  tieRule: string;
  entries: LeaderboardEntry[];
  currentUserEntry: LeaderboardEntry | null;
}

export interface LeagueStandingEntry {
  rank: number;
  userId: string;
  username: string;
  name: string | null;
  tier: string;
  xp: number;
  qualifiedSessions: number;
  isCurrentUser: boolean;
}

export interface LeagueResponse {
  period: string; // e.g. '2026-10'
  cohortSize: number;
  tieRule: string;
  isEligible: boolean; // >= 10 ranked exercises across >= 5 groups
  eligibleExerciseCount: number;
  isOptedIn: boolean;
  entries: LeagueStandingEntry[];
  currentUserEntry: LeagueStandingEntry | null;
}

/**
 * Reads user's social privacy preferences. Defaults: socialActivityOptIn = true, leagueOptIn = false
 */
export async function getSocialPrivacyPreferences(
  sql: Sql,
  userId: string,
): Promise<SocialPrivacyPreferences> {
  const [row] = await sql<{
    social_activity_opt_in: boolean | null;
    league_opt_in: boolean | null;
  }[]>`
    SELECT social_activity_opt_in, league_opt_in
    FROM user_preferences
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  return {
    socialActivityOptIn: row?.social_activity_opt_in ?? true,
    leagueOptIn: row?.league_opt_in ?? false,
  };
}

/**
 * Updates user's social privacy preferences.
 */
export async function updateSocialPrivacyPreferences(
  sql: Sql,
  userId: string,
  prefs: Partial<SocialPrivacyPreferences>,
): Promise<SocialPrivacyPreferences> {
  const current = await getSocialPrivacyPreferences(sql, userId);
  const updatedSocial = prefs.socialActivityOptIn ?? current.socialActivityOptIn;
  const updatedLeague = prefs.leagueOptIn ?? current.leagueOptIn;

  await sql`
    INSERT INTO user_preferences (user_id, weight_unit, theme_overrides, social_activity_opt_in, league_opt_in, updated_at)
    VALUES (${userId}, 'lbs', '{}'::jsonb, ${updatedSocial}, ${updatedLeague}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      social_activity_opt_in = EXCLUDED.social_activity_opt_in,
      league_opt_in = EXCLUDED.league_opt_in,
      updated_at = now()
  `;

  return {
    socialActivityOptIn: updatedSocial,
    leagueOptIn: updatedLeague,
  };
}

/**
 * Gets paginated friend activity feed. Only includes workouts of accepted friends who have social_activity_opt_in = true.
 */
export async function getFriendsActivityFeed(
  sql: Sql,
  userId: string,
  cursor?: string,
  limit = 20,
): Promise<{ activity: ActivityEvent[]; nextCursor: string | null }> {
  const safeLimit = Math.min(50, Math.max(1, limit));

  const rows = await sql<{
    id: string;
    user_id: string;
    username: string;
    name: string | null;
    started_at: Date;
    status: string;
    routine_name: string | null;
    day_name: string | null;
    set_count: number;
  }[]>`
    SELECT ws.id, u.id AS user_id, u.username, u.name, ws.started_at, ws.status,
      r.name AS routine_name, rd.day_name, count(wset.id)::int AS set_count
    FROM workout_sessions ws
    INNER JOIN users u ON u.id = ws.user_id
    INNER JOIN friend_requests fr ON fr.status = 'accepted' AND (
      (fr.requester_id = ${userId} AND fr.addressee_id = ws.user_id) OR
      (fr.addressee_id = ${userId} AND fr.requester_id = ws.user_id)
    )
    LEFT JOIN user_preferences up ON up.user_id = ws.user_id
    LEFT JOIN routines r ON r.id = ws.routine_id
    LEFT JOIN routine_days rd ON rd.id = ws.routine_day_id
    LEFT JOIN workout_sets wset ON wset.session_id = ws.id
    WHERE coalesce(up.social_activity_opt_in, true) = true
      ${cursor ? sql`AND ws.started_at < ${new Date(cursor)}` : sql``}
    GROUP BY ws.id, u.id, r.name, rd.day_name
    ORDER BY ws.started_at DESC
    LIMIT ${safeLimit + 1}
  `;

  const hasMore = rows.length > safeLimit;
  const items = hasMore ? rows.slice(0, safeLimit) : rows;
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].started_at.toISOString() : null;

  return {
    activity: items.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username,
      name: r.name,
      startedAt: r.started_at.toISOString(),
      status: r.status,
      routineName: r.routine_name,
      dayName: r.day_name,
      setCount: r.set_count,
    })),
    nextCursor,
  };
}

/**
 * Creates or gets an active shareable invitation link token for the user.
 */
export async function getOrCreateInvitation(
  sql: Sql,
  userId: string,
): Promise<{ token: string; url: string; createdAt: string }> {
  const [existing] = await sql<{
    token: string;
    created_at: Date;
  }[]>`
    SELECT token, created_at FROM friend_invitations
    WHERE user_id = ${userId} AND is_active = true
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (existing) {
    return {
      token: existing.token,
      url: `/friends/invite/${existing.token}`,
      createdAt: existing.created_at.toISOString(),
    };
  }

  const token = randomUUID().replace(/-/g, '').slice(0, 12);
  const [inserted] = await sql<{
    token: string;
    created_at: Date;
  }[]>`
    INSERT INTO friend_invitations (user_id, token, is_active, created_at)
    VALUES (${userId}, ${token}, true, now())
    RETURNING token, created_at
  `;

  return {
    token: inserted.token,
    url: `/friends/invite/${inserted.token}`,
    createdAt: inserted.created_at.toISOString(),
  };
}

/**
 * Resolves an invitation token to the inviter's details.
 */
export async function resolveInvitation(
  sql: Sql,
  token: string,
): Promise<{ inviterId: string; username: string; name: string | null } | null> {
  const [row] = await sql<{
    user_id: string;
    username: string;
    name: string | null;
  }[]>`
    SELECT fi.user_id, u.username, u.name
    FROM friend_invitations fi
    INNER JOIN users u ON u.id = fi.user_id
    WHERE fi.token = ${token} AND fi.is_active = true
    LIMIT 1
  `;

  if (!row) return null;
  return {
    inviterId: row.user_id,
    username: row.username,
    name: row.name,
  };
}

/**
 * Revokes an existing invitation token.
 */
export async function revokeInvitation(
  sql: Sql,
  userId: string,
  token: string,
): Promise<boolean> {
  const result = await sql`
    UPDATE friend_invitations
    SET is_active = false, revoked_at = now()
    WHERE user_id = ${userId} AND token = ${token} AND is_active = true
  `;
  return result.count > 0;
}

/**
 * Calculates friends leaderboard for a given calendar month (e.g. '2026-10').
 * Includes current user and accepted friends who have social_activity_opt_in = true.
 * Tie rule: XP desc, then qualified sessions desc, then first achieved.
 */
export async function getFriendsLeaderboard(
  sql: Sql,
  userId: string,
  period?: string,
): Promise<LeaderboardResponse> {
  // Determine period start and end date
  const now = new Date();
  const effectivePeriod = period && /^\d{4}-\d{2}$/.test(period)
    ? period
    : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  const [yearStr, monthStr] = effectivePeriod.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const startDate = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const endDate = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);

  // Cohort is current user + accepted friends with social_activity_opt_in = true
  const cohortUsers = await sql<{
    user_id: string;
    username: string;
    name: string | null;
  }[]>`
    SELECT u.id AS user_id, u.username, u.name
    FROM users u
    LEFT JOIN user_preferences up ON up.user_id = u.id
    WHERE (
      u.id = ${userId} OR
      u.id IN (
        SELECT CASE WHEN fr.requester_id = ${userId} THEN fr.addressee_id ELSE fr.requester_id END
        FROM friend_requests fr
        WHERE fr.status = 'accepted' AND (fr.requester_id = ${userId} OR fr.addressee_id = ${userId})
      )
    )
    AND coalesce(up.social_activity_opt_in, true) = true
  `;

  if (cohortUsers.length === 0) {
    return {
      period: effectivePeriod,
      tieRule: 'XP, then qualified sessions, then earliest completion',
      entries: [],
      currentUserEntry: null,
    };
  }

  const userIds = cohortUsers.map((u) => u.user_id);

  // Compute monthly XP and qualified session count for cohort users
  const statsRows = await sql<{
    user_id: string;
    total_xp: number;
    qualified_sessions: number;
    earliest_session: Date | null;
  }[]>`
    SELECT u_id AS user_id,
      coalesce(xp.xp_sum, 0)::int AS total_xp,
      coalesce(sess.sess_count, 0)::int AS qualified_sessions,
      sess.min_started AS earliest_session
    FROM unnest(${userIds}::uuid[]) AS u_id
    LEFT JOIN (
      SELECT user_id, sum(xp_amount) AS xp_sum
      FROM xp_ledger
      WHERE event_date >= ${startDate}::date AND event_date < ${endDate}::date
      GROUP BY user_id
    ) xp ON xp.user_id = u_id
    LEFT JOIN (
      SELECT ws.user_id, count(DISTINCT ws.id) AS sess_count, min(ws.started_at) AS min_started
      FROM workout_sessions ws
      INNER JOIN workout_sets wset ON wset.session_id = ws.id AND wset.is_warmup = false
      WHERE ws.status = 'completed' AND ws.started_at >= ${startDate}::timestamptz AND ws.started_at < ${endDate}::timestamptz
      GROUP BY ws.user_id
      HAVING count(wset.id) >= 3
    ) sess ON sess.user_id = u_id
  `;

  const statsMap = new Map(statsRows.map((r) => [r.user_id, r]));

  const entriesWithStats = cohortUsers.map((u) => {
    const stats = statsMap.get(u.user_id);
    return {
      userId: u.user_id,
      username: u.username,
      name: u.name,
      xp: Math.max(0, stats?.total_xp ?? 0),
      qualifiedSessions: stats?.qualified_sessions ?? 0,
      earliestSession: stats?.earliest_session ?? new Date(0),
      isCurrentUser: u.user_id === userId,
    };
  });

  // Sort by XP desc, qualifiedSessions desc, earliestSession asc
  entriesWithStats.sort((a, b) => {
    if (b.xp !== a.xp) return b.xp - a.xp;
    if (b.qualifiedSessions !== a.qualifiedSessions) return b.qualifiedSessions - a.qualifiedSessions;
    return a.earliestSession.getTime() - b.earliestSession.getTime();
  });

  const rankedEntries: LeaderboardEntry[] = entriesWithStats.map((item, index) => ({
    rank: index + 1,
    userId: item.userId,
    username: item.username,
    name: item.name,
    xp: item.xp,
    qualifiedSessions: item.qualifiedSessions,
    isCurrentUser: item.isCurrentUser,
  }));

  const currentUserEntry = rankedEntries.find((e) => e.isCurrentUser) ?? null;

  return {
    period: effectivePeriod,
    tieRule: 'XP, then qualified sessions, then earliest completion',
    entries: rankedEntries,
    currentUserEntry,
  };
}

/**
 * Calculates League standings for the period.
 * Eligibility requirement: at least 10 ranked exercises across at least 5 muscle groups.
 * Only users who are eligible AND have league_opt_in = true appear in league standings.
 */
export async function getLeagueStandings(
  sql: Sql,
  userId: string,
  period?: string,
): Promise<LeagueResponse> {
  const now = new Date();
  const effectivePeriod = period && /^\d{4}-\d{2}$/.test(period)
    ? period
    : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  const [yearStr, monthStr] = effectivePeriod.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const startDate = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const endDate = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);

  // Check current user eligibility and preferences
  const [eligibilityRow] = await sql<{
    exercise_count: number;
    group_count: number;
    league_opt_in: boolean | null;
  }[]>`
    SELECT 
      count(DISTINCT ers.exercise_id)::int AS exercise_count,
      count(DISTINCT emc.muscle_group)::int AS group_count,
      up.league_opt_in
    FROM users u
    LEFT JOIN user_preferences up ON up.user_id = u.id
    LEFT JOIN exercise_rank_snapshots ers ON ers.user_id = u.id AND ers.is_current = true AND ers.tier IS NOT NULL
    LEFT JOIN exercise_muscle_contributions emc ON emc.exercise_id = ers.exercise_id
    WHERE u.id = ${userId}
    GROUP BY up.league_opt_in
  `;

  const exerciseCount = eligibilityRow?.exercise_count ?? 0;
  const groupCount = eligibilityRow?.group_count ?? 0;
  const isEligible = exerciseCount >= 10 && groupCount >= 5;
  const isOptedIn = eligibilityRow?.league_opt_in === true;

  // Find all eligible users who opted into league
  const eligibleOptedInUsers = await sql<{
    user_id: string;
    username: string;
    name: string | null;
    overall_tier: string | null;
  }[]>`
    SELECT u.id AS user_id, u.username, u.name, ors.tier AS overall_tier
    FROM users u
    INNER JOIN user_preferences up ON up.user_id = u.id AND up.league_opt_in = true
    LEFT JOIN overall_rank_snapshots ors ON ors.user_id = u.id AND ors.is_current = true
    WHERE (
      SELECT count(DISTINCT ers.exercise_id)
      FROM exercise_rank_snapshots ers
      WHERE ers.user_id = u.id AND ers.is_current = true AND ers.tier IS NOT NULL
    ) >= 10
    AND (
      SELECT count(DISTINCT emc.muscle_group)
      FROM exercise_rank_snapshots ers
      INNER JOIN exercise_muscle_contributions emc ON emc.exercise_id = ers.exercise_id
      WHERE ers.user_id = u.id AND ers.is_current = true AND ers.tier IS NOT NULL
    ) >= 5
  `;

  if (eligibleOptedInUsers.length === 0) {
    return {
      period: effectivePeriod,
      cohortSize: 0,
      tieRule: 'XP, then qualified sessions, then earliest completion',
      isEligible,
      eligibleExerciseCount: exerciseCount,
      isOptedIn,
      entries: [],
      currentUserEntry: null,
    };
  }

  const userIds = eligibleOptedInUsers.map((u) => u.user_id);

  // Compute stats for period
  const statsRows = await sql<{
    user_id: string;
    total_xp: number;
    qualified_sessions: number;
    earliest_session: Date | null;
  }[]>`
    SELECT u_id AS user_id,
      coalesce(xp.xp_sum, 0)::int AS total_xp,
      coalesce(sess.sess_count, 0)::int AS qualified_sessions,
      sess.min_started AS earliest_session
    FROM unnest(${userIds}::uuid[]) AS u_id
    LEFT JOIN (
      SELECT user_id, sum(xp_amount) AS xp_sum
      FROM xp_ledger
      WHERE event_date >= ${startDate}::date AND event_date < ${endDate}::date
      GROUP BY user_id
    ) xp ON xp.user_id = u_id
    LEFT JOIN (
      SELECT ws.user_id, count(DISTINCT ws.id) AS sess_count, min(ws.started_at) AS min_started
      FROM workout_sessions ws
      INNER JOIN workout_sets wset ON wset.session_id = ws.id AND wset.is_warmup = false
      WHERE ws.status = 'completed' AND ws.started_at >= ${startDate}::timestamptz AND ws.started_at < ${endDate}::timestamptz
      GROUP BY ws.user_id
      HAVING count(wset.id) >= 3
    ) sess ON sess.user_id = u_id
  `;

  const statsMap = new Map(statsRows.map((r) => [r.user_id, r]));

  const entriesWithStats = eligibleOptedInUsers.map((u) => {
    const stats = statsMap.get(u.user_id);
    return {
      userId: u.user_id,
      username: u.username,
      name: u.name,
      tier: u.overall_tier ?? 'Initiate',
      xp: Math.max(0, stats?.total_xp ?? 0),
      qualifiedSessions: stats?.qualified_sessions ?? 0,
      earliestSession: stats?.earliest_session ?? new Date(0),
      isCurrentUser: u.user_id === userId,
    };
  });

  entriesWithStats.sort((a, b) => {
    if (b.xp !== a.xp) return b.xp - a.xp;
    if (b.qualifiedSessions !== a.qualifiedSessions) return b.qualifiedSessions - a.qualifiedSessions;
    return a.earliestSession.getTime() - b.earliestSession.getTime();
  });

  const rankedEntries: LeagueStandingEntry[] = entriesWithStats.map((item, index) => ({
    rank: index + 1,
    userId: item.userId,
    username: item.username,
    name: item.name,
    tier: item.tier,
    xp: item.xp,
    qualifiedSessions: item.qualifiedSessions,
    isCurrentUser: item.isCurrentUser,
  }));

  const currentUserEntry = rankedEntries.find((e) => e.isCurrentUser) ?? null;

  return {
    period: effectivePeriod,
    cohortSize: rankedEntries.length,
    tieRule: 'XP, then qualified sessions, then earliest completion',
    isEligible,
    eligibleExerciseCount: exerciseCount,
    isOptedIn,
    entries: rankedEntries,
    currentUserEntry,
  };
}
