export type RecoverySession = {
  endedAt: string;
  muscleGroup: string | null;
  workingSetCount: number;
};

export type RecoveryGroup = {
  name: string;
  endsAt: string;
  hoursRemaining: number;
};

export type RecoverySummary = {
  hasCompletedWork: boolean;
  heatmapMuscleGroups: string | null;
  recovering: RecoveryGroup[];
  ready: string[];
};

const RECOVERY_WINDOW_HOURS = 48;
const BODY_GROUPS = ["Chest", "Shoulders", "Arms", "Back", "Core", "Legs"];

function bodyGroupsFor(muscleGroup: string | null) {
  const value = muscleGroup?.toLowerCase() ?? "";
  const groups = new Set<string>();

  if (/(chest|pectoral)/.test(value)) groups.add("Chest");
  if (/(deltoid|shoulder)/.test(value)) groups.add("Shoulders");
  if (/(biceps|triceps|brachialis|forearm|wrist)/.test(value)) groups.add("Arms");
  if (/(infraspinatus|teres|rhomboid|latissimus|\blat\b|trapezius|back)/.test(value)) groups.add("Back");
  if (/(abdominal|rectus|oblique)/.test(value)) groups.add("Core");
  if (/(glute|quadriceps|\bquad\b|hamstring|calf|gastrocnemius|soleus|tibialis|adductor|legs|lower body)/.test(value)) groups.add("Legs");

  return [...groups];
}

export function deriveRecovery(
  sessions: RecoverySession[],
  now = new Date(),
): RecoverySummary {
  const nowMs = now.getTime();
  const latestRecoveryEndByGroup = new Map<string, number>();
  const heatmapGroups = new Set<string>();
  let hasCompletedWork = false;

  sessions.forEach((session) => {
    if (session.workingSetCount < 1) return;
    const endedAt = new Date(session.endedAt).getTime();
    if (Number.isNaN(endedAt)) return;
    const groups = bodyGroupsFor(session.muscleGroup);
    if (!groups.length) return;

    hasCompletedWork = true;
    const recoveryEnd = endedAt + RECOVERY_WINDOW_HOURS * 60 * 60 * 1000;
    groups.forEach((group) => {
      if (recoveryEnd > nowMs) heatmapGroups.add(group);
      latestRecoveryEndByGroup.set(
        group,
        Math.max(latestRecoveryEndByGroup.get(group) ?? 0, recoveryEnd),
      );
    });
  });

  const recovering = [...latestRecoveryEndByGroup.entries()]
    .filter(([, endsAt]) => endsAt > nowMs)
    .map(([name, endsAt]) => ({
      name,
      endsAt: new Date(endsAt).toISOString(),
      hoursRemaining: Math.max(1, Math.ceil((endsAt - nowMs) / (60 * 60 * 1000))),
    }))
    .sort((left, right) => left.hoursRemaining - right.hoursRemaining);
  const recoveringNames = new Set(recovering.map((group) => group.name));

  return {
    hasCompletedWork,
    heatmapMuscleGroups: heatmapGroups.size ? [...heatmapGroups].join(", ") : null,
    recovering,
    ready: BODY_GROUPS.filter((group) => !recoveringNames.has(group)),
  };
}
