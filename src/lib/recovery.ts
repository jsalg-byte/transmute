export type RecoverySession = {
  endedAt: string;
  muscleGroup: string | null;
  workingSetCount: number;
};

export type RecoveryGroup = {
  name: string;
  endedAt: string | null;
  hoursSinceWorked: number | null;
  hoursRemaining: number;
};

export type RecoveryStage = "needs-rest" | "recovering" | "ready";

export type RecoveryReadiness = {
  name: string;
  stage: RecoveryStage;
};

export type RecoverySummary = {
  hasCompletedWork: boolean;
  needsRest: RecoveryGroup[];
  recovering: RecoveryGroup[];
  ready: string[];
  readiness: RecoveryReadiness[];
};

const RECOVERY_WINDOW_HOURS = 48;
export const BODY_GROUPS = ["Chest", "Shoulders", "Arms", "Back", "Core", "Legs"] as const;

export function bodyGroupsForMuscleGroup(muscleGroup: string | null) {
  const value = muscleGroup?.toLowerCase() ?? "";
  const groups = new Set<string>();

  if (/(chest|pectoral)/.test(value)) groups.add("Chest");
  // The library records lower-trapezius work for pressing movements. Treat it
  // as shoulder-girdle work here, rather than reporting a full back recovery
  // requirement after a push-only session.
  if (/(deltoid|shoulder|trapezius)/.test(value)) groups.add("Shoulders");
  if (/(biceps|triceps|brachialis|forearm|wrist)/.test(value)) groups.add("Arms");
  if (/(infraspinatus|teres|rhomboid|latissimus|\blat\b|back)/.test(value)) groups.add("Back");
  if (/(abdominal|rectus|oblique)/.test(value)) groups.add("Core");
  if (/(glute|quadriceps|\bquad\b|hamstring|calf|gastrocnemius|soleus|tibialis|adductor|legs|lower body)/.test(value)) groups.add("Legs");

  return [...groups];
}

export function deriveRecovery(
  sessions: RecoverySession[],
  now = new Date(),
): RecoverySummary {
  const nowMs = now.getTime();
  const latestWorkedAtByGroup = new Map<string, number>();
  let hasCompletedWork = false;

  sessions.forEach((session) => {
    if (session.workingSetCount < 1) return;
    const endedAt = new Date(session.endedAt).getTime();
    if (Number.isNaN(endedAt)) return;
    const groups = bodyGroupsForMuscleGroup(session.muscleGroup);
    if (!groups.length) return;

    hasCompletedWork = true;
    groups.forEach((group) => {
      latestWorkedAtByGroup.set(
        group,
        Math.max(latestWorkedAtByGroup.get(group) ?? 0, endedAt),
      );
    });
  });

  const groups: (RecoveryGroup & { stage: RecoveryStage })[] = BODY_GROUPS.map((name) => {
    const endedAt = latestWorkedAtByGroup.get(name);
    if (!endedAt) {
      return {
        name,
        endedAt: null,
        hoursSinceWorked: null,
        hoursRemaining: 0,
        stage: "ready",
      };
    }

    const hoursSinceWorked = Math.max(0, (nowMs - endedAt) / (60 * 60 * 1000));
    const group = {
      name,
      endedAt: new Date(endedAt).toISOString(),
      hoursSinceWorked,
      hoursRemaining: Math.max(0, Math.ceil(RECOVERY_WINDOW_HOURS - hoursSinceWorked)),
    };

    if (hoursSinceWorked < 24) return { ...group, stage: "needs-rest" };
    if (hoursSinceWorked < RECOVERY_WINDOW_HOURS) return { ...group, stage: "recovering" };
    return { ...group, stage: "ready" };
  });

  const needsRest = groups
    .filter((group) => group.stage === "needs-rest")
    .sort((left, right) => left.hoursRemaining - right.hoursRemaining);
  const recovering = groups
    .filter((group) => group.stage === "recovering")
    .sort((left, right) => left.hoursRemaining - right.hoursRemaining);
  const ready = groups.filter((group) => group.stage === "ready").map((group) => group.name);

  return {
    hasCompletedWork,
    needsRest,
    recovering,
    ready,
    readiness: groups.map(({ name, stage }) => ({ name, stage })),
  };
}
