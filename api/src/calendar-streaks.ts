import type postgres from 'postgres';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface CalendarDayStatus {
  date: string; // YYYY-MM-DD
  status: 'qualified' | 'completed' | 'rest' | 'future';
  workingSetCount: number;
  workoutCount: number;
  totalDurationSeconds: number;
}

export interface TrainingCalendarMonth {
  year: number;
  month: number;
  days: CalendarDayStatus[];
}

export interface StreakData {
  currentStreak: number;
  bestStreak: number;
  lastQualifiedDate: string | null;
  weekDays: {
    dayOfWeek: string; // 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'
    date: string; // YYYY-MM-DD
    isQualified: boolean;
    isToday: boolean;
    isFuture: boolean;
  }[];
  calendarMonth: TrainingCalendarMonth;
}

export function getLocalTrainingDate(date: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date); // YYYY-MM-DD
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Recompute qualified training days and streaks for a user.
 * Triggered on session complete, edit, or delete.
 */
export async function recomputeStreaksForUser(sql: Sql, userId: string): Promise<{ currentStreak: number; bestStreak: number }> {
  // Fetch user preference timezone
  const [pref] = await sql<{ timezone: string }[]>`
    SELECT coalesce(timezone, 'UTC') AS timezone FROM user_preferences WHERE user_id = ${userId}
  `;
  const userTimezone = pref?.timezone || 'UTC';

  // Find all completed workout sessions and their non-warmup set counts
  const sessions = await sql<{
    id: string;
    ended_at: Date;
    working_set_count: number;
  }[]>`
    SELECT ws.id, ws.ended_at, count(wset.id)::int AS working_set_count
    FROM workout_sessions ws
    LEFT JOIN workout_sets wset ON wset.session_id = ws.id AND wset.is_warmup = false
    WHERE ws.user_id = ${userId}
      AND ws.status = 'completed'
      AND ws.ended_at IS NOT NULL
    GROUP BY ws.id, ws.ended_at
    ORDER BY ws.ended_at ASC
  `;

  // Aggregate by training_date
  // A day is qualified if any session in it has >= 3 working sets, or sum of working sets is >= 3
  const qualifiedDaysMap = new Map<string, { sessionId: string; workingSets: number; endedAt: Date }>();
  for (const s of sessions) {
    const localDate = getLocalTrainingDate(s.ended_at, userTimezone);
    const existing = qualifiedDaysMap.get(localDate);
    const currentSets = (existing?.workingSets ?? 0) + s.working_set_count;
    if (s.working_set_count >= 3 || currentSets >= 3) {
      if (!existing || s.working_set_count >= existing.workingSets) {
        qualifiedDaysMap.set(localDate, {
          sessionId: s.id,
          workingSets: currentSets,
          endedAt: s.ended_at,
        });
      } else {
        existing.workingSets = currentSets;
      }
    }
  }

  // Sync qualified_training_days table
  // Clear and insert to ensure deletions/reversals are accurate
  await sql`DELETE FROM qualified_training_days WHERE user_id = ${userId}`;
  for (const [dateStr, info] of qualifiedDaysMap.entries()) {
    await sql`
      INSERT INTO qualified_training_days (
        user_id, training_date, session_id, timezone_at_completion, working_set_count, completed_at
      ) VALUES (
        ${userId}, ${dateStr}::date, ${info.sessionId}, ${userTimezone}, ${info.workingSets}, ${info.endedAt}
      )
      ON CONFLICT (user_id, training_date) DO UPDATE SET
        working_set_count = EXCLUDED.working_set_count,
        completed_at = EXCLUDED.completed_at
    `;
  }

  // Calculate streaks
  // Distinct sorted local dates: ascending
  const sortedDates = Array.from(qualifiedDaysMap.keys()).sort();

  let bestStreak = 0;
  let tempStreak = 0;
  let prevDate: Date | null = null;

  for (const dateStr of sortedDates) {
    const currentDate = new Date(dateStr + 'T00:00:00Z');
    if (!prevDate) {
      tempStreak = 1;
    } else {
      const diffMs = currentDate.getTime() - prevDate.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        tempStreak++;
      } else {
        tempStreak = 1;
      }
    }
    if (tempStreak > bestStreak) {
      bestStreak = tempStreak;
    }
    prevDate = currentDate;
  }

  // Current streak: counts consecutive days ending today or yesterday
  const now = new Date();
  const todayStr = getLocalTrainingDate(now, userTimezone);
  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = getLocalTrainingDate(yesterdayDate, userTimezone);

  let currentStreak = 0;
  const lastQualified = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : null;

  if (lastQualified && (lastQualified === todayStr || lastQualified === yesterdayStr)) {
    // Walk backwards from lastQualified
    let walkDate = new Date(lastQualified + 'T00:00:00Z');
    let streakCount = 0;
    while (true) {
      const walkStr = walkDate.toISOString().slice(0, 10);
      if (qualifiedDaysMap.has(walkStr)) {
        streakCount++;
        walkDate = new Date(walkDate.getTime() - 24 * 60 * 60 * 1000);
      } else {
        break;
      }
    }
    currentStreak = streakCount;
  }

  // Save to user_streak_snapshots
  await sql`
    INSERT INTO user_streak_snapshots (
      user_id, current_streak, best_streak, last_qualified_date, updated_at
    ) VALUES (
      ${userId}, ${currentStreak}, ${bestStreak}, ${lastQualified ? lastQualified + '::date' : null}, now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      current_streak = EXCLUDED.current_streak,
      best_streak = EXCLUDED.best_streak,
      last_qualified_date = EXCLUDED.last_qualified_date,
      updated_at = now()
  `;

  return { currentStreak, bestStreak };
}

export async function getStreaksAndCalendar(
  sql: Sql,
  userId: string,
  targetYear?: number,
  targetMonth?: number,
): Promise<StreakData> {
  const [pref] = await sql<{ timezone: string }[]>`
    SELECT coalesce(timezone, 'UTC') AS timezone FROM user_preferences WHERE user_id = ${userId}
  `;
  const userTimezone = pref?.timezone || 'UTC';

  // Ensure streak snapshot exists
  const [snapshot] = await sql<{
    current_streak: number;
    best_streak: number;
    last_qualified_date: string | null;
  }[]>`
    SELECT current_streak, best_streak, to_char(last_qualified_date, 'YYYY-MM-DD') AS last_qualified_date
    FROM user_streak_snapshots
    WHERE user_id = ${userId}
  `;

  let currentStreak = snapshot?.current_streak ?? 0;
  let bestStreak = snapshot?.best_streak ?? 0;
  let lastQualifiedDate = snapshot?.last_qualified_date ?? null;

  if (!snapshot) {
    const recomputed = await recomputeStreaksForUser(sql, userId);
    currentStreak = recomputed.currentStreak;
    bestStreak = recomputed.bestStreak;
    const [fresh] = await sql<{ last_qualified_date: string | null }[]>`
      SELECT to_char(last_qualified_date, 'YYYY-MM-DD') AS last_qualified_date
      FROM user_streak_snapshots WHERE user_id = ${userId}
    `;
    lastQualifiedDate = fresh?.last_qualified_date ?? null;
  }

  const now = new Date();
  const todayStr = getLocalTrainingDate(now, userTimezone);

  // Week days for streak week row (current week: Sun -> Sat)
  const todayDateObj = new Date(todayStr + 'T12:00:00Z');
  const dayOfWeekIdx = todayDateObj.getUTCDay(); // 0 is Sunday
  const sundayMs = todayDateObj.getTime() - dayOfWeekIdx * 24 * 60 * 60 * 1000;

  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sundayMs + i * 24 * 60 * 60 * 1000);
    weekDates.push(d.toISOString().slice(0, 10));
  }

  // Fetch qualified days in this week
  const weekQualified = await sql<{ training_date: string }[]>`
    SELECT to_char(training_date, 'YYYY-MM-DD') AS training_date
    FROM qualified_training_days
    WHERE user_id = ${userId}
      AND training_date >= ${weekDates[0]}::date
      AND training_date <= ${weekDates[6]}::date
  `;
  const weekQualifiedSet = new Set(weekQualified.map((r) => r.training_date));

  const weekDays = weekDates.map((dateStr, idx) => ({
    dayOfWeek: dayNames[idx],
    date: dateStr,
    isQualified: weekQualifiedSet.has(dateStr),
    isToday: dateStr === todayStr,
    isFuture: dateStr > todayStr,
  }));

  // Calendar month
  const year = targetYear ?? Number(todayStr.slice(0, 4));
  const month = targetMonth ?? Number(todayStr.slice(5, 7)); // 1-12

  const startOfMonthStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endOfMonthStr = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  // Fetch all sessions in this month
  const monthSessions = await sql<{
    date: string;
    working_set_count: number;
    duration_seconds: number;
  }[]>`
    SELECT
      to_char(ws.ended_at AT TIME ZONE ${userTimezone}, 'YYYY-MM-DD') AS date,
      count(wset.id)::int AS working_set_count,
      coalesce(sum(EXTRACT(EPOCH FROM (ws.ended_at - ws.started_at))), 0)::int AS duration_seconds
    FROM workout_sessions ws
    LEFT JOIN workout_sets wset ON wset.session_id = ws.id AND wset.is_warmup = false
    WHERE ws.user_id = ${userId}
      AND ws.status = 'completed'
      AND ws.ended_at IS NOT NULL
      AND (ws.ended_at AT TIME ZONE ${userTimezone})::date >= ${startOfMonthStr}::date
      AND (ws.ended_at AT TIME ZONE ${userTimezone})::date <= ${endOfMonthStr}::date
    GROUP BY ws.id, to_char(ws.ended_at AT TIME ZONE ${userTimezone}, 'YYYY-MM-DD')
  `;

  // Fetch qualified days in this month
  const monthQualified = await sql<{ training_date: string }[]>`
    SELECT to_char(training_date, 'YYYY-MM-DD') AS training_date
    FROM qualified_training_days
    WHERE user_id = ${userId}
      AND training_date >= ${startOfMonthStr}::date
      AND training_date <= ${endOfMonthStr}::date
  `;
  const monthQualifiedSet = new Set(monthQualified.map((r) => r.training_date));

  const monthSessionAggregates = new Map<string, { count: number; sets: number; duration: number }>();
  for (const s of monthSessions) {
    const existing = monthSessionAggregates.get(s.date) ?? { count: 0, sets: 0, duration: 0 };
    existing.count++;
    existing.sets += s.working_set_count;
    existing.duration += s.duration_seconds;
    monthSessionAggregates.set(s.date, existing);
  }

  const days: CalendarDayStatus[] = [];
  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const agg = monthSessionAggregates.get(dateStr);
    const isQual = monthQualifiedSet.has(dateStr);
    const isFuture = dateStr > todayStr;

    let status: 'qualified' | 'completed' | 'rest' | 'future' = 'rest';
    if (isFuture) {
      status = 'future';
    } else if (isQual) {
      status = 'qualified';
    } else if (agg && agg.count > 0) {
      status = 'completed';
    } else {
      status = 'rest';
    }

    days.push({
      date: dateStr,
      status,
      workingSetCount: agg?.sets ?? 0,
      workoutCount: agg?.count ?? 0,
      totalDurationSeconds: agg?.duration ?? 0,
    });
  }

  return {
    currentStreak,
    bestStreak,
    lastQualifiedDate,
    weekDays,
    calendarMonth: {
      year,
      month,
      days,
    },
  };
}
