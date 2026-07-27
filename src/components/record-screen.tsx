import { router, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { openBrowserAsync } from "expo-web-browser";
import { ArrowRight, ChevronLeft, ChevronRight, MoreHorizontal, X } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AlchemySvg } from "./alchemy-svg";
import { FastingHourglass } from "./fasting-hourglass";
import { MuscleHeatMap } from "./muscle-heat-map";
import { NutritionContent as NutritionWorkflow } from "./nutrition-content";
import { deriveRecovery } from "../lib/recovery";
import {
  acceptFriendRequest,
  addExerciseToWorkoutPlanDay,
  addWorkoutPlanDay,
  createAdminUser,
  createExercise,
  createFood,
  createMealLog,
  createWorkoutPlan,
  deleteFastingLog,
  deleteWorkoutPlan,
  deleteWorkoutPlanDay,
  deleteAdminUser,
  deleteProgressPhoto,
  deleteWorkoutSession,
  getAdminUsers,
  getRecord,
  generateAiWorkoutPlan,
  importAiWorkoutPlan,
  lookupBarcode,
  rejectFriendRequest,
  removeFriend,
  removeExerciseFromWorkoutPlanDay,
  reorderExerciseInWorkoutPlanDay,
  parseNutritionLabel,
  sendFriendRequest,
  setActiveWorkoutPlan,
  signOut,
  startWorkoutSession,
  updateFasting,
  updateExerciseDemo,
  updateProgressPhoto,
  updateWeightUnit,
  uploadMealPhoto,
  uploadProgressPhoto,
  updateAdminUser,
  updateWorkoutPlan,
  updateWorkoutPlanDay,
  type AdminUser,
  type AiWorkoutPlanDraft,
  type TransmuteRecord,
} from "../lib/api";

const ouroboros = require("../../assets/transmute/ouroboros.svg");
const DESKTOP_BREAKPOINT = 768;
const BOTTOM_NAV_HEIGHT = 64;

const nav = [
  ["dashboard", "Dashboard"],
  ["workout-plans", "Workout Plans"],
  ["exercises", "Exercise Library"],
  ["sessions", "Sessions"],
  ["nutrition", "Nutrition"],
  ["fasting", "Fasting"],
  ["progress", "Progress"],
  ["friends", "Friends"],
  ["settings", "Settings"],
  ["admin", "Admin"],
] as const;

const primaryNav = [
  ["dashboard", "Home"],
  ["sessions", "Train"],
  ["nutrition", "Nutrition"],
  ["progress", "Progress"],
] as const;

const moreNav = [
  ["workout-plans", "Workout Plans"],
  ["exercises", "Exercise Library"],
  ["fasting", "Fasting"],
  ["friends", "Friends"],
  ["settings", "Settings"],
  ["admin", "Admin"],
] as const;

type Area = (typeof nav)[number][0];

function routeFor(area: Area) {
  return `/${area}` as const;
}

function currentPageProps(active: boolean) {
  return Platform.OS === "web" && active
    ? ({ "aria-current": "page" } as Record<string, string>)
    : {};
}

function label(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ") : "Unassigned";
}
function date(value: string) {
  return new Date(value).toLocaleDateString();
}
const RECORD_TIME_ZONE = "America/New_York";
const CALENDAR_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function recordDayKey(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: RECORD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateFromRecordDayKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function calendarDayKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function calendarMonthKey(value: Date) {
  return calendarDayKey(value).slice(0, 7);
}

function startOfCalendarMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1, 12, 0, 0);
}

function addCalendarMonths(value: Date, offset: number) {
  return new Date(value.getFullYear(), value.getMonth() + offset, 1, 12, 0, 0);
}

function calendarGrid(month: Date) {
  const first = startOfCalendarMonth(month);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const value = new Date(start);
    value.setDate(start.getDate() + index);
    return value;
  });
}

function dayKey(value: string) {
  const source = new Date(value);
  return `${source.getFullYear()}-${String(source.getMonth() + 1).padStart(2, "0")}-${String(source.getDate()).padStart(2, "0")}`;
}
function durationFromMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = Math.max(0, minutes % 60);
  return `${hours}h ${remainder}m`;
}

function startOfCurrentWeek() {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - ((value.getDay() + 6) % 7));
  return value.getTime();
}

function isThisWeek(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp >= startOfCurrentWeek();
}

function elapsedSince(value: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"} in`;
}

function firstName(name: string | null | undefined) {
  const value = name?.trim();
  return value && !value.includes("@") ? value.split(/\s+/)[0] : null;
}
function Card({ title, meta, imageUrl }: { title: string; meta?: string; imageUrl?: string | null }) {
  return (
    <View style={styles.card}>
      {imageUrl ? <Image accessibilityLabel={`${title} photo`} source={{ uri: imageUrl }} style={styles.cardImage} /> : null}
      <Text style={styles.cardTitle}>{title}</Text>
      {meta ? <Text style={styles.cardMeta}>{meta}</Text> : null}
    </View>
  );
}

export function RecordScreen({ area }: { area: Area }) {
  const [record, setRecord] = useState<TransmuteRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  useEffect(() => {
    getRecord()
      .then(setRecord)
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to load your record.",
        ),
      );
  }, []);
  const leave = async () => {
    await signOut();
    router.replace("/");
  };
  const refresh = async () => {
    try {
      setError(null);
      setRecord(await getRecord());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load your record.",
      );
    }
  };
  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.wrap}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Go to dashboard"
            accessibilityRole="link"
            onPress={() => router.replace("/dashboard")}
            style={styles.wordmark}
          >
            <AlchemySvg source={ouroboros} width={38} height={38} />
            <Text style={styles.wordmarkText}>TRANSMUTE</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: !isDesktop && moreOpen }}
            onPress={() => {
              if (isDesktop) {
                void leave();
                return;
              }
              setMoreOpen((open) => !open);
            }}
            style={styles.headerAccount}
          >
            <Text style={styles.signOut}>{isDesktop ? "Sign out" : "Account"}</Text>
          </Pressable>
        </View>
        {isDesktop ? (
          <View accessibilityRole="tablist" style={styles.nav}>
            {nav
              .filter(([key]) => key !== "admin" || record?.isAdmin)
              .map(([key, name]) => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: key === area }}
                  key={key}
                  onPress={() => router.replace(routeFor(key))}
                  style={styles.navButton}
                >
                  <Text
                    style={[styles.navItem, key === area && styles.navActive]}
                  >
                    {name}
                  </Text>
                </Pressable>
              ))}
          </View>
        ) : null}
        <ScrollView
          contentContainerStyle={[
            styles.content,
            area === "workout-plans" && isDesktop && styles.planPageContent,
            !isDesktop && {
              paddingBottom: BOTTOM_NAV_HEIGHT + insets.bottom + 28,
            },
          ]}
        >
          {error ? (
            <>
              <Text style={styles.title}>The record is unavailable.</Text>
              <Text style={styles.body}>{error}</Text>
            </>
          ) : !record ? (
            <View style={styles.loading}>
              <ActivityIndicator color="#642D2A" />
              <Text style={styles.body}>Reading your record…</Text>
            </View>
          ) : (
            <AreaContent area={area} record={record} refresh={refresh} isDesktop={isDesktop} />
          )}
        </ScrollView>
      </View>
      {!isDesktop ? (
        <>
          {moreOpen ? (
            <Pressable
              accessibilityLabel="Close account menu"
              accessibilityRole="button"
              onPress={() => setMoreOpen(false)}
              style={styles.moreBackdrop}
            />
          ) : null}
          {moreOpen ? (
            <View
              accessibilityRole="menu"
              style={[styles.moreSheet, { bottom: BOTTOM_NAV_HEIGHT + insets.bottom }]}
            >
              <Text style={styles.moreHeading}>MORE</Text>
              {moreNav
                .filter(([key]) => key !== "admin" || record?.isAdmin)
                .map(([key, name]) => (
                  <Pressable
                    accessibilityRole="menuitem"
                    key={key}
                    onPress={() => {
                      setMoreOpen(false);
                      router.replace(routeFor(key));
                    }}
                    style={styles.moreItem}
                  >
                    <Text style={[styles.moreItemText, key === area && styles.moreItemTextActive]}>{name}</Text>
                  </Pressable>
                ))}
              <Pressable accessibilityRole="menuitem" onPress={() => void leave()} style={styles.moreItem}>
                <Text style={styles.moreSignOut}>Sign Out</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={[styles.bottomNav, { paddingBottom: insets.bottom }]}>
            {primaryNav.map(([key, name]) => {
              const active = key === area;
              return (
                <Pressable
                  {...currentPageProps(active)}
                  accessibilityLabel={name}
                  accessibilityRole="link"
                  accessibilityState={{ selected: active }}
                  key={key}
                  onPress={() => router.replace(routeFor(key))}
                  style={styles.bottomNavItem}
                >
                  {active ? <View style={styles.bottomNavIndicator} /> : null}
                  <Text style={[styles.bottomNavText, active && styles.bottomNavTextActive]}>{name}</Text>
                </Pressable>
              );
            })}
            <Pressable
              {...currentPageProps(moreNav.some(([key]) => key === area))}
              accessibilityLabel="More"
              accessibilityRole="button"
              accessibilityState={{ expanded: moreOpen, selected: moreNav.some(([key]) => key === area) }}
              onPress={() => setMoreOpen((open) => !open)}
              style={styles.bottomNavItem}
            >
              {moreNav.some(([key]) => key === area) ? <View style={styles.bottomNavIndicator} /> : null}
              <Text style={[styles.bottomNavText, moreNav.some(([key]) => key === area) && styles.bottomNavTextActive]}>More</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </SafeAreaView>
  );
}

type RecentRecordItem = {
  id: string;
  title: string;
  meta: string;
  timestamp: string;
};

function DashboardContent({
  record,
  isDesktop,
}: {
  record: TransmuteRecord;
  isDesktop: boolean;
}) {
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const activeSession = record.dashboard.activeSession;
  const nextSession = record.dashboard.nextSession;
  const nextDay = useMemo(
    () =>
      nextSession
        ? record.workoutPlans
            .flatMap((plan) => plan.days)
            .find((day) => day.id === nextSession.dayId) ?? null
        : null,
    [nextSession, record.workoutPlans],
  );
  const weekly = useMemo(() => {
    const sessions = record.sessions.filter(
      (session) =>
        session.status === "completed" &&
        isThisWeek(session.ended_at ?? session.started_at),
    );
    const meals = record.nutrition.meals.filter((meal) =>
      isThisWeek(meal.consumed_at),
    );
    return {
      meals: meals.length,
      sessions: sessions.length,
    };
  }, [record.nutrition.meals, record.sessions]);
  const recovery = useMemo(
    () => deriveRecovery(record.dashboard.recoverySessions ?? []),
    [record.dashboard.recoverySessions],
  );
  const recent = useMemo<RecentRecordItem[]>(() => {
    const sessions = record.sessions.map((session) => ({
      id: `session-${session.id}`,
      title:
        session.status === "completed" ? "Session completed" : "Session recorded",
      meta: `${session.routine_name ?? "Workout plan"} · ${session.day_name ?? "Day"}`,
      timestamp: session.ended_at ?? session.started_at,
    }));
    const meals = record.nutrition.meals.map((meal) => ({
      id: `meal-${meal.id}`,
      title: "Meal recorded",
      meta: meal.name,
      timestamp: meal.consumed_at,
    }));
    const checkIns = record.progress.map((checkIn) => ({
      id: `progress-${checkIn.id}`,
      title: "Progress updated",
      meta: checkIn.note?.trim() || "Progress photo added",
      timestamp: checkIn.captured_at,
    }));
    return [...sessions, ...meals, ...checkIns]
      .sort(
        (left, right) =>
          new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
      )
      .slice(0, 4);
  }, [record.nutrition.meals, record.progress, record.sessions]);
  const welcome = firstName(record.user.name);
  const hasPlan = record.workoutPlans.length > 0;

  const beginNextSession = async () => {
    if (!nextSession) return;
    setStarting(true);
    setNotice(null);
    try {
      const { session } = await startWorkoutSession({
        routineDayId: nextSession.dayId,
      });
      router.push(`/sessions/${session.id}`);
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Unable to start the session.",
      );
    } finally {
      setStarting(false);
    }
  };

  const primary = activeSession
    ? {
        action: () => router.push(`/sessions/${activeSession.id}`),
        button: "Continue session",
        label: "ACTIVE WORK",
        meta: `${elapsedSince(activeSession.started_at)} the session`,
        title: `${activeSession.routine_name ?? "Workout plan"} — ${activeSession.day_name ?? "Session"}`,
      }
    : nextSession
      ? {
          action: () => void beginNextSession(),
          button: starting ? "Beginning session…" : "Begin session",
          label: "YOUR NEXT SESSION",
          meta: `${nextSession.exerciseCount} ${nextSession.exerciseCount === 1 ? "exercise" : "exercises"} ready to log`,
          title: `${nextSession.routineName ?? "Workout plan"} — ${nextSession.dayName}`,
        }
      : hasPlan
        ? {
            action: () => router.push("/workout-plans"),
            button: "Open workout plan",
            label: "YOUR NEXT SESSION",
            meta: "Add a day to make the next session available.",
            title: "Your plan needs its next day.",
          }
        : {
            action: () => router.push("/workout-plans"),
            button: "Build your first plan",
            label: "FIRST INPUT",
            meta: "A plan gives your next session a place to begin.",
            title: "Build the work before you perform it.",
          };

  return (
    <>
      <Text style={styles.eyebrow}>THE WORKBENCH</Text>
      <Text style={styles.dashboardTitle}>
        {welcome ? `Welcome back, ${welcome}.` : "Welcome back."}
      </Text>

      <View style={styles.dashboardPrimary}>
        <Text style={styles.dashboardPrimaryLabel}>{primary.label}</Text>
        <Text style={styles.dashboardPrimaryTitle}>{primary.title}</Text>
        <Text style={styles.dashboardPrimaryMeta}>{primary.meta}</Text>
        {nextDay && nextDay.exercises.length > 0 && !activeSession ? (
          <Text style={styles.dashboardMovementList}>
            {nextDay.exercises
              .sort((left, right) => left.sortOrder - right.sortOrder)
              .slice(0, 3)
              .map((exercise) => exercise.name)
              .join(" · ")}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={starting}
          onPress={primary.action}
          style={({ pressed }) => [
            styles.dashboardAction,
            pressed && styles.buttonPressed,
            starting && styles.buttonDisabled,
          ]}
        >
          <Text style={styles.actionButtonText}>{primary.button}</Text>
        </Pressable>
        {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
      </View>

      <View style={[styles.recoveryRecord, isDesktop && styles.recoveryRecordDesktop]}>
        <View style={styles.recoveryHeading}>
          <Text style={styles.sectionLabel}>RECOVERY</Text>
          <Text style={styles.recoveryIntro}>Based on completed working sets from the last 48 hours.</Text>
        </View>
        {recovery.hasCompletedWork ? (
          <>
            <View style={styles.recoveryMap}>
              <MuscleHeatMap
                muscleGroups={recovery.heatmapMuscleGroups}
                label="RECOVERING NOW"
                legend="Recovering now"
              />
            </View>
            <View style={styles.recoveryDetails}>
              <Text style={styles.recoverySubhead}>RECOVERING</Text>
              {recovery.recovering.length ? recovery.recovering.map((group) => (
                <View key={group.name} style={styles.recoveryRow}>
                  <Text style={styles.recoveryGroup}>{group.name}</Text>
                  <Text style={styles.recoveryEta}>Ready in ~{group.hoursRemaining}h</Text>
                </View>
              )) : <Text style={styles.recoveryEmpty}>Everything is ready for another session.</Text>}
              <Text style={[styles.recoverySubhead, styles.recoveryReadyLabel]}>READY NOW</Text>
              <Text style={styles.recoveryReady}>{recovery.ready.join(" · ")}</Text>
            </View>
          </>
        ) : (
          <Text style={styles.recoveryEmpty}>Complete a working set to start a simple recovery readout.</Text>
        )}
      </View>

      <View style={[styles.dashboardSecondary, isDesktop && styles.dashboardSecondaryDesktop]}>
        <View style={styles.weeklyRecord}>
          <Text style={styles.sectionLabel}>THIS WEEK</Text>
          <View style={styles.weeklyGrid}>
            {[
              [weekly.sessions, "SESSIONS"],
              [weekly.meals, "MEALS"],
              [recovery.recovering.length, "RECOVERING"],
              [recovery.hasCompletedWork ? recovery.ready.length : 0, "READY NOW"],
            ].map(([value, label], index) => (
              <View
                key={label}
                style={[
                  styles.weeklyMetric,
                  index % 2 === 0 && styles.weeklyMetricLeft,
                  index < 2 && styles.weeklyMetricTop,
                ]}
              >
                <Text style={styles.weeklyMetricValue}>{value}</Text>
                <Text style={styles.weeklyMetricLabel}>{label}</Text>
              </View>
            ))}
          </View>
        </View>

        {recent.length ? (
          <View style={styles.recentRecord}>
            <Text style={styles.sectionLabel}>RECENT RECORD</Text>
            {recent.map((item) => (
              <View key={item.id} style={styles.recentRow}>
                <View style={styles.recentCopy}>
                  <Text style={styles.recentTitle}>{item.title}</Text>
                  <Text style={styles.recentMeta}>{item.meta}</Text>
                </View>
                <Text style={styles.recentDate}>{date(item.timestamp)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </>
  );
}

function AreaContent({
  area,
  record: r,
  refresh,
  isDesktop,
}: {
  area: Area;
  record: TransmuteRecord;
  refresh: () => Promise<void>;
  isDesktop: boolean;
}) {
  if (area === "dashboard")
    return <DashboardContent record={r} isDesktop={isDesktop} />;
  if (area === "workout-plans")
    return <WorkoutPlansContent record={r} refresh={refresh} isDesktop={isDesktop} />;
  if (area === "exercises")
    return <ExercisesContent record={r} refresh={refresh} />;
  if (area === "sessions")
    return <SessionsContent record={r} refresh={refresh} isDesktop={isDesktop} />;
  if (area === "nutrition")
    return <NutritionWorkflow record={r} refresh={refresh} />;
  if (area === "fasting")
    return <FastingContent record={r} refresh={refresh} />;
  if (area === "progress")
    return <ProgressContent record={r} refresh={refresh} isDesktop={isDesktop} />;
  if (area === "friends")
    return <FriendsContent record={r} refresh={refresh} />;
  if (area === "settings")
    return <SettingsContent record={r} refresh={refresh} />;
  return <AdminContent />;
}

function WorkoutPlansContent({
  record,
  refresh,
  isDesktop,
}: {
  record: TransmuteRecord;
  refresh: () => Promise<void>;
  isDesktop: boolean;
}) {
  const [planName, setPlanName] = useState("");
  const [description, setDescription] = useState("");
  const [dayNames, setDayNames] = useState<Record<string, string>>({});
  const [renamedPlanNames, setRenamedPlanNames] = useState<Record<string, string>>({});
  const [renamedDayNames, setRenamedDayNames] = useState<Record<string, string>>({});
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(
    record.settings.active_routine_id ?? record.workoutPlans[0]?.id ?? null,
  );
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [exerciseBrowserOpen, setExerciseBrowserOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ kind: "day" | "plan"; id: string; name: string } | null>(null);
  const [createPlanOpen, setCreatePlanOpen] = useState(false);
  const [newPlanMode, setNewPlanMode] = useState<"manual" | "ai">("manual");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiDraft, setAiDraft] = useState<AiWorkoutPlanDraft | null>(null);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [exerciseQuery, setExerciseQuery] = useState("");
  const [pendingExerciseId, setPendingExerciseId] = useState<string | null>(null);
  const [pendingTargets, setPendingTargets] = useState({ sets: "3", reps: "", weight: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const activePlanId = record.settings.active_routine_id;

  const selectedPlan =
    record.workoutPlans.find((plan) => plan.id === selectedPlanId) ??
    record.workoutPlans[0] ??
    null;
  const orderedDays = selectedPlan
    ? [...selectedPlan.days].sort((left, right) => left.sortOrder - right.sortOrder)
    : [];
  const selectedDay =
    orderedDays.find((day) => day.id === selectedDayId) ?? orderedDays[0] ?? null;
  const selectedDayIndex = Math.max(0, orderedDays.findIndex((day) => day.id === selectedDay?.id));
  const previousDay = orderedDays.length
    ? orderedDays[(selectedDayIndex - 1 + orderedDays.length) % orderedDays.length]
    : null;
  const nextDay = orderedDays.length
    ? orderedDays[(selectedDayIndex + 1) % orderedDays.length]
    : null;
  const canCycleDays = orderedDays.length > 1;
  const orderedExercises = selectedDay
    ? [...selectedDay.exercises].sort((left, right) => left.sortOrder - right.sortOrder)
    : [];
  const selectedExercise =
    orderedExercises.find((entry) => entry.id === selectedExerciseId) ?? null;
  const pendingExercise =
    record.exercises.find((exercise) => exercise.id === pendingExerciseId) ?? null;
  const visibleExercises = record.exercises
    .filter((exercise) => exercise.name.toLowerCase().includes(exerciseQuery.trim().toLowerCase()))
    .slice(0, exerciseQuery.trim() ? 30 : 8);
  const plannedSetCount = orderedDays.reduce(
    (total, day) =>
      total + day.exercises.reduce((dayTotal, entry) => dayTotal + (entry.targetSets ?? 3), 0),
    0,
  );

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setSaving(true);
    setNotice(null);
    try {
      await operation();
      await refresh();
      setNotice(success);
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Unable to save your plan.",
      );
    } finally {
      setSaving(false);
    }
  };

  const createPlan = async () => {
    const name = planName.trim();
    if (name.length < 2) throw new Error("Enter a plan name with at least 2 characters.");
    const result = await createWorkoutPlan({
      name,
      description: description.trim() || undefined,
    });
    setSelectedPlanId(result.plan.id);
    setPlanName("");
    setDescription("");
    setNewPlanMode("manual");
    setCreatePlanOpen(false);
  };

  const generateAiPlan = async () => {
    const prompt = aiPrompt.trim();
    if (prompt.length < 12) throw new Error("Tell the plan assistant a little more about the workout you want.");
    setGeneratingPlan(true);
    setNotice(null);
    try {
      const result = await generateAiWorkoutPlan(prompt);
      setAiDraft(result.draft);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to generate a workout plan.");
    } finally {
      setGeneratingPlan(false);
    }
  };

  const importAiPlan = async () => {
    if (!aiDraft) return;
    setSaving(true);
    setNotice(null);
    try {
      const result = await importAiWorkoutPlan(aiDraft);
      await refresh();
      setSelectedPlanId(result.plan.id);
      setSelectedDayId(result.plan.days[0]?.id ?? null);
      setAiDraft(null);
      setAiPrompt("");
      setNewPlanMode("manual");
      setCreatePlanOpen(false);
      setNotice("AI workout plan added. Review it before your first session.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to add this workout plan.");
    } finally {
      setSaving(false);
    }
  };

  const addDay = async () => {
    if (!selectedPlan) return;
    const dayName = (dayNames[selectedPlan.id] ?? "").trim();
    if (dayName.length < 2) throw new Error("Enter a day name with at least 2 characters.");
    const result = await addWorkoutPlanDay(selectedPlan.id, { dayName });
    setDayNames((current) => ({ ...current, [selectedPlan.id]: "" }));
    setSelectedDayId(result.day.id);
  };

  const confirmRemoval = async () => {
    if (!removeTarget) return;
    setSaving(true);
    setNotice(null);
    try {
      if (removeTarget.kind === "day") {
        await deleteWorkoutPlanDay(removeTarget.id);
        setSelectedDayId(null);
        setNotice("Workout day removed.");
      } else {
        await deleteWorkoutPlan(removeTarget.id);
        setSelectedPlanId(null);
        setSelectedDayId(null);
        setDetailsOpen(false);
        setNotice("Workout plan removed.");
      }
      await refresh();
      setRemoveTarget(null);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to remove this workout plan.");
    } finally {
      setSaving(false);
    }
  };

  const addSelectedExercise = async () => {
    if (!selectedDay || !pendingExercise) throw new Error("Choose an exercise first.");
    const targetSets = Number(pendingTargets.sets);
    const targetReps = pendingTargets.reps.trim() ? Number(pendingTargets.reps) : undefined;
    const targetWeight = pendingTargets.weight.trim() ? Number(pendingTargets.weight) : undefined;
    if (!Number.isInteger(targetSets) || targetSets < 1) {
      throw new Error("Enter at least one target set.");
    }
    if (targetReps !== undefined && (!Number.isInteger(targetReps) || targetReps < 1)) {
      throw new Error("Target reps must be a whole number.");
    }
    if (targetWeight !== undefined && (!Number.isFinite(targetWeight) || targetWeight < 0)) {
      throw new Error("Target weight must be zero or greater.");
    }
    await addExerciseToWorkoutPlanDay(selectedDay.id, {
      exerciseId: pendingExercise.id,
      targetSets,
      targetReps,
      targetWeight,
    });
    setPendingExerciseId(null);
    setPendingTargets({ sets: "3", reps: "", weight: "" });
    setExerciseQuery("");
    setExerciseBrowserOpen(false);
  };

  const startSelectedDay = async () => {
    if (!selectedDay) return;
    setSaving(true);
    setNotice(null);
    try {
      const { session } = await startWorkoutSession({ routineDayId: selectedDay.id });
      router.push(`/sessions/${session.id}`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to start the workout.");
    } finally {
      setSaving(false);
    }
  };

  const prescriptionFor = (entry: NonNullable<typeof selectedExercise>) => {
    const base = entry.targetReps ? `${entry.targetSets ?? 3} × ${entry.targetReps}` : `${entry.targetSets ?? 3} sets`;
    return entry.targetWeight
      ? `${base} · ${entry.targetWeight} ${record.settings.weight_unit}`
      : base;
  };

  const selectedEditor = selectedExercise && selectedDay ? (
    <View style={styles.exerciseEditor}>
      <View style={styles.editorHeading}>
        <View style={styles.editorCopy}>
          <Text style={styles.editorLabel}>SELECTED EXERCISE</Text>
          <Text style={styles.editorTitle}>{selectedExercise.name}</Text>
          <Text style={styles.editorMeta}>
            {[selectedExercise.muscleGroup, selectedExercise.category].filter(Boolean).join(" · ") || "Exercise"}
          </Text>
        </View>
        {!isDesktop ? (
          <Pressable accessibilityLabel="Close exercise editor" onPress={() => setSelectedExerciseId(null)} style={styles.editorClose}>
            <Text style={styles.editorCloseText}>Close</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.editorRule} />
      <Text style={styles.editorFieldLabel}>PRESCRIPTION</Text>
      <Text style={styles.editorValue}>{prescriptionFor(selectedExercise)}</Text>
      <Text style={styles.editorHint}>
        Targets are set when the exercise is added. Existing plan entries retain their recorded prescription.
      </Text>
      <View style={styles.editorActions}>
        <Pressable
          accessibilityRole="button"
          disabled={saving || selectedExercise.sortOrder === 0}
          onPress={() =>
            void run(
              () => reorderExerciseInWorkoutPlanDay(selectedExercise.id, "up"),
              `${selectedExercise.name} moved up.`,
            )
          }
          style={[styles.editorAction, (saving || selectedExercise.sortOrder === 0) && styles.buttonDisabled]}
        >
          <Text style={styles.editorActionText}>Move up</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={saving || selectedExercise.sortOrder === orderedExercises.length - 1}
          onPress={() =>
            void run(
              () => reorderExerciseInWorkoutPlanDay(selectedExercise.id, "down"),
              `${selectedExercise.name} moved down.`,
            )
          }
          style={[styles.editorAction, (saving || selectedExercise.sortOrder === orderedExercises.length - 1) && styles.buttonDisabled]}
        >
          <Text style={styles.editorActionText}>Move down</Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={saving}
        onPress={() =>
          void run(async () => {
            await removeExerciseFromWorkoutPlanDay(selectedExercise.id);
            setSelectedExerciseId(null);
          }, `${selectedExercise.name} removed.`)
        }
        style={[styles.editorRemove, saving && styles.buttonDisabled]}
      >
        <Text style={styles.editorRemoveText}>Remove exercise</Text>
      </Pressable>
    </View>
  ) : (
    <View style={styles.editorEmpty}>
      <Text style={styles.editorLabel}>SELECTED EXERCISE</Text>
      <Text style={styles.ledgerEmptyTitle}>Choose a movement.</Text>
      <Text style={styles.editorHint}>Select an exercise from the ledger to inspect its prescription or change its order.</Text>
    </View>
  );

  return (
    <>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Text style={styles.eyebrow}>THE PLAN</Text>
      {record.workoutPlans.length ? (
        <>
          <View style={styles.planSwitcher}>
            <View style={styles.planSwitcherTabs}>
              {record.workoutPlans.map((plan) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedPlan?.id === plan.id }}
                  key={plan.id}
                  onPress={() => {
                    setSelectedPlanId(plan.id);
                    setSelectedExerciseId(null);
                  }}
                  style={[styles.planSwitchItem, selectedPlan?.id === plan.id && styles.planSwitchItemActive]}
                >
                  <Text style={[styles.planSwitchText, selectedPlan?.id === plan.id && styles.planSwitchTextActive]}>{plan.name}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable accessibilityRole="button" onPress={() => { setNewPlanMode("manual"); setCreatePlanOpen(true); }} style={styles.planSwitchAdd}>
              <Text style={styles.planSwitchAddText}>+ New Plan</Text>
            </Pressable>
          </View>
          {selectedPlan ? (
            <>
              <View style={styles.planHeader}>
                <View style={styles.planHeaderCopy}>
                  <Text style={styles.planHeaderTitle}>{selectedPlan.name}</Text>
                  <Text style={styles.planHeaderMeta}>
                    {orderedExercises.length} exercises · {plannedSetCount} working sets
                  </Text>
                  {selectedPlan.description ? <Text style={styles.planDescription}>{selectedPlan.description}</Text> : null}
                </View>
                <View style={styles.planHeaderActions}>
                  <Pressable disabled={saving || !selectedDay} onPress={() => void startSelectedDay()} style={[styles.planPrimaryAction, styles.planHeaderAction, (saving || !selectedDay) && styles.buttonDisabled]}>
                    <Text style={styles.planPrimaryActionText}>START WORKOUT</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setDetailsOpen(true)} style={[styles.planSecondaryAction, styles.planHeaderAction]}>
                    <Text style={styles.planSecondaryActionText}>EDIT DETAILS</Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.dayNavigator}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous workout day"
                  disabled={!canCycleDays}
                  onPress={() => {
                    setSelectedDayId(previousDay?.id ?? null);
                    setSelectedExerciseId(null);
                  }}
                  style={[styles.dayNavigatorButton, !canCycleDays && styles.buttonDisabled]}
                >
                  <ChevronLeft color="#642D2A" size={22} strokeWidth={2.5} />
                </Pressable>
                <View style={styles.dayNavigatorCopy}>
                  <Text style={styles.dayNavigatorLabel}>DAY {selectedDayIndex + 1} OF {orderedDays.length}</Text>
                  <Text style={styles.dayNavigatorTitle}>{selectedDay?.name ?? "Workout Day"}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next workout day"
                  disabled={!canCycleDays}
                  onPress={() => {
                    setSelectedDayId(nextDay?.id ?? null);
                    setSelectedExerciseId(null);
                  }}
                  style={[styles.dayNavigatorButton, !canCycleDays && styles.buttonDisabled]}
                >
                  <ChevronRight color="#642D2A" size={22} strokeWidth={2.5} />
                </Pressable>
              </View>
              {selectedDay ? (
                <View style={[styles.planWorkspace, isDesktop && styles.planWorkspaceDesktop]}>
                  <View style={styles.exerciseLedger}>
                    <View style={styles.ledgerHeader}>
                      <View>
                        <Text style={styles.editorLabel}>EXERCISES</Text>
                        <TextInput
                          value={renamedDayNames[selectedDay.id] ?? selectedDay.name}
                          onChangeText={(value) => setRenamedDayNames((current) => ({ ...current, [selectedDay.id]: value }))}
                          style={[styles.input, styles.ledgerDayName]}
                          returnKeyType="done"
                          onSubmitEditing={() =>
                            void run(() => {
                              const dayName = (renamedDayNames[selectedDay.id] ?? selectedDay.name).trim();
                              if (dayName.length < 2) throw new Error("Enter a day name with at least 2 characters.");
                              return updateWorkoutPlanDay(selectedDay.id, { dayName });
                            }, "Workout day renamed.")
                          }
                        />
                      </View>
                    </View>
                    <View style={styles.ledgerList}>
                      {orderedExercises.length ? orderedExercises.map((entry, index) => (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ selected: selectedExercise?.id === entry.id }}
                          key={entry.id}
                          onPress={() => setSelectedExerciseId(entry.id)}
                          style={[styles.ledgerRow, selectedExercise?.id === entry.id && styles.ledgerRowActive]}
                        >
                          <Text style={styles.dragHandle} accessibilityLabel={`Exercise ${index + 1}`}>≡</Text>
                          <Text style={styles.ledgerOrder}>{String(index + 1).padStart(2, "0")}</Text>
                          <View style={styles.ledgerRowCopy}>
                            <Text style={styles.ledgerExerciseName}>{entry.name}</Text>
                            <Text style={styles.ledgerExerciseMeta}>{prescriptionFor(entry)}</Text>
                          </View>
                          <Text style={styles.ledgerSelect}>›</Text>
                        </Pressable>
                      )) : (
                        <View style={styles.ledgerEmpty}>
                          <Text style={styles.ledgerEmptyTitle}>This day is blank.</Text>
                          <Text style={styles.editorHint}>Add a movement from your exercise library to begin building the session.</Text>
                        </View>
                      )}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      disabled={!record.exercises.length}
                      onPress={() => setExerciseBrowserOpen(true)}
                      style={[styles.addExerciseAction, !record.exercises.length && styles.buttonDisabled]}
                    >
                      <Text style={styles.addExerciseActionText}>+ Add exercise</Text>
                    </Pressable>
                    {!record.exercises.length ? <Text style={styles.editorHint}>Create an exercise in Exercise library before adding it to a plan.</Text> : null}
                  </View>
                  {isDesktop ? selectedEditor : null}
                </View>
              ) : (
                <View style={styles.ledgerEmpty}>
                  <Text style={styles.ledgerEmptyTitle}>No training days yet.</Text>
                  <Text style={styles.editorHint}>Use Edit details to add the first day to this plan.</Text>
                </View>
              )}
            </>
          ) : null}
        </>
      ) : (
        <View style={styles.planEmptyState}>
          <Text style={styles.title}>Build your first plan.</Text>
          <Text style={styles.body}>A plan keeps the training days, movements, and evidence in one working record.</Text>
          <Pressable onPress={() => { setNewPlanMode("manual"); setCreatePlanOpen(true); }} style={styles.planPrimaryAction}>
            <Text style={styles.planPrimaryActionText}>+ New Plan</Text>
          </Pressable>
        </View>
      )}

      <Modal animationType="fade" transparent visible={exerciseBrowserOpen} onRequestClose={() => setExerciseBrowserOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalPanel, isDesktop && styles.modalPanelDesktop]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.editorLabel}>ADD EXERCISE</Text>
                <Text style={styles.modalTitle}>{selectedDay?.name ?? "Workout day"}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close exercise browser" onPress={() => setExerciseBrowserOpen(false)} style={styles.modalClose}>
                <X color="#642D2A" size={19} strokeWidth={2.4} />
              </Pressable>
            </View>
            <TextInput value={exerciseQuery} onChangeText={setExerciseQuery} placeholder="Search exercises…" placeholderTextColor="#655D57" autoCapitalize="none" style={styles.searchInput} />
            <Text style={styles.editorLabel}>{exerciseQuery.trim() ? "SEARCH RESULTS" : "AVAILABLE EXERCISES"}</Text>
            <ScrollView style={styles.exerciseResults} keyboardShouldPersistTaps="handled">
              {visibleExercises.map((exercise) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: pendingExercise?.id === exercise.id }}
                  key={exercise.id}
                  onPress={() => setPendingExerciseId(exercise.id)}
                  style={[styles.exerciseResult, pendingExercise?.id === exercise.id && styles.exerciseResultActive]}
                >
                  <View>
                    <Text style={[styles.exerciseResultName, pendingExercise?.id === exercise.id && styles.exerciseResultNameActive]}>{exercise.name}</Text>
                    <Text style={[styles.exerciseResultMeta, pendingExercise?.id === exercise.id && styles.exerciseResultMetaActive]}>{[exercise.muscle_group, exercise.category].filter(Boolean).join(" · ") || "Exercise"}</Text>
                  </View>
                  <Text style={[styles.exerciseResultAdd, pendingExercise?.id === exercise.id && styles.exerciseResultNameActive]}>Select</Text>
                </Pressable>
              ))}
              {!visibleExercises.length ? <Text style={styles.editorHint}>No exercises match that search.</Text> : null}
            </ScrollView>
            {pendingExercise ? (
              <View style={styles.addExerciseDetails}>
                <Text style={styles.addExerciseSelected}>{pendingExercise.name}</Text>
                <View style={styles.macroRow}>
                  <TextInput value={pendingTargets.sets} onChangeText={(sets) => setPendingTargets((current) => ({ ...current, sets }))} keyboardType="number-pad" placeholder="Sets" placeholderTextColor="#655D57" style={[styles.input, styles.macroInput]} />
                  <TextInput value={pendingTargets.reps} onChangeText={(reps) => setPendingTargets((current) => ({ ...current, reps }))} keyboardType="number-pad" placeholder="Reps" placeholderTextColor="#655D57" style={[styles.input, styles.macroInput]} />
                  <TextInput value={pendingTargets.weight} onChangeText={(weight) => setPendingTargets((current) => ({ ...current, weight }))} keyboardType="decimal-pad" placeholder={`Weight (${record.settings.weight_unit})`} placeholderTextColor="#655D57" style={[styles.input, styles.macroInput]} />
                </View>
                <Pressable disabled={saving} onPress={() => void run(addSelectedExercise, `${pendingExercise.name} added.`)} style={[styles.planPrimaryAction, saving && styles.buttonDisabled]}>
                  <Text style={styles.planPrimaryActionText}>Add to {selectedDay?.name}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={detailsOpen} onRequestClose={() => setDetailsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalPanel, isDesktop && styles.modalPanelDesktop]}>
            <View style={styles.modalHeader}>
              <View><Text style={styles.editorLabel}>PLAN DETAILS</Text><Text style={styles.modalTitle}>{selectedPlan?.name}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close plan details" onPress={() => setDetailsOpen(false)} style={styles.modalClose}><X color="#642D2A" size={19} strokeWidth={2.4} /></Pressable>
            </View>
            {selectedPlan ? (
              <>
                <Text style={styles.editorFieldLabel}>PLAN NAME</Text>
                <TextInput
                  value={renamedPlanNames[selectedPlan.id] ?? selectedPlan.name}
                  onChangeText={(value) => setRenamedPlanNames((current) => ({ ...current, [selectedPlan.id]: value }))}
                  style={styles.input}
                  returnKeyType="done"
                  onSubmitEditing={() => void run(() => {
                    const name = (renamedPlanNames[selectedPlan.id] ?? selectedPlan.name).trim();
                    if (name.length < 2) throw new Error("Enter a workout plan name with at least 2 characters.");
                    return updateWorkoutPlan(selectedPlan.id, { name });
                  }, "Workout plan renamed.")}
                />
                <Pressable disabled={saving} onPress={() => void run(() => {
                  const name = (renamedPlanNames[selectedPlan.id] ?? selectedPlan.name).trim();
                  if (name.length < 2) throw new Error("Enter a workout plan name with at least 2 characters.");
                  return updateWorkoutPlan(selectedPlan.id, { name });
                }, "Workout plan renamed.")} style={[styles.planSecondaryAction, saving && styles.buttonDisabled]}><Text style={styles.planSecondaryActionText}>Save name</Text></Pressable>
                <View style={styles.editorRule} />
                <Text style={styles.editorFieldLabel}>ADD DAY</Text>
                <View style={styles.addDayRow}>
                  <TextInput value={dayNames[selectedPlan.id] ?? ""} onChangeText={(value) => setDayNames((current) => ({ ...current, [selectedPlan.id]: value }))} placeholder="Day name" placeholderTextColor="#655D57" style={[styles.input, styles.dayInput]} returnKeyType="done" onSubmitEditing={() => void run(addDay, "Workout day added.")} />
                  <Pressable disabled={saving} onPress={() => void run(addDay, "Workout day added.")} style={[styles.planSecondaryAction, saving && styles.buttonDisabled]}><Text style={styles.planSecondaryActionText}>Add day</Text></Pressable>
                </View>
                <View style={styles.editorRule} />
                <Pressable disabled={saving || activePlanId === selectedPlan.id} onPress={() => void run(() => setActiveWorkoutPlan(selectedPlan.id), "Active workout plan updated.")} style={[styles.editorAction, (saving || activePlanId === selectedPlan.id) && styles.buttonDisabled]}><Text style={styles.editorActionText}>{activePlanId === selectedPlan.id ? "Active plan" : "Set as active"}</Text></Pressable>
                {selectedDay ? <Pressable disabled={saving} onPress={() => setRemoveTarget({ kind: "day", id: selectedDay.id, name: selectedDay.name })} style={[styles.editorRemove, saving && styles.buttonDisabled]}><Text style={styles.editorRemoveText}>Remove selected day</Text></Pressable> : null}
                <Pressable disabled={saving} onPress={() => setRemoveTarget({ kind: "plan", id: selectedPlan.id, name: selectedPlan.name })} style={[styles.editorRemove, saving && styles.buttonDisabled]}><Text style={styles.editorRemoveText}>Remove plan</Text></Pressable>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={removeTarget !== null} onRequestClose={() => setRemoveTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalPanel, styles.confirmRemovalPanel, isDesktop && styles.modalPanelDesktop]}>
            <Text style={styles.editorLabel}>{removeTarget?.kind === "plan" ? "REMOVE PLAN" : "REMOVE DAY"}</Text>
            <Text style={styles.modalTitle}>Remove {removeTarget?.name}?</Text>
            <Text style={styles.editorHint}>
              {removeTarget?.kind === "plan"
                ? "This permanently removes the plan and every day and exercise inside it."
                : "This permanently removes the day and every exercise inside it."}
            </Text>
            <View style={styles.confirmRemovalActions}>
              <Pressable disabled={saving} onPress={() => setRemoveTarget(null)} style={[styles.planSecondaryAction, saving && styles.buttonDisabled]}><Text style={styles.planSecondaryActionText}>Cancel</Text></Pressable>
              <Pressable disabled={saving} onPress={() => void confirmRemoval()} style={[styles.confirmRemovalAction, saving && styles.buttonDisabled]}><Text style={styles.planPrimaryActionText}>{saving ? "Removing…" : "Remove"}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={createPlanOpen} onRequestClose={() => { setCreatePlanOpen(false); setNewPlanMode("manual"); }}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalPanel, isDesktop && styles.modalPanelDesktop]}>
            <View style={styles.modalHeader}>
              <View><Text style={styles.editorLabel}>{newPlanMode === "ai" ? "PLAN ASSISTANT" : "NEW PLAN"}</Text><Text style={styles.modalTitle}>{newPlanMode === "ai" ? "Describe the work." : "Build the program."}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close new plan" onPress={() => { setCreatePlanOpen(false); setNewPlanMode("manual"); }} style={styles.modalClose}><X color="#642D2A" size={19} strokeWidth={2.4} /></Pressable>
            </View>
            {newPlanMode === "manual" ? (
              <>
                <TextInput value={planName} onChangeText={setPlanName} placeholder="Plan name" placeholderTextColor="#655D57" style={styles.input} returnKeyType="next" />
                <TextInput value={description} onChangeText={setDescription} placeholder="Description (optional)" placeholderTextColor="#655D57" style={styles.input} onSubmitEditing={() => void run(createPlan, "Workout plan created.")} returnKeyType="done" />
                <Pressable disabled={saving} onPress={() => void run(createPlan, "Workout plan created.")} style={[styles.planPrimaryAction, saving && styles.buttonDisabled]}><Text style={styles.planPrimaryActionText}>Create plan</Text></Pressable>
                <View style={styles.editorRule} />
                <Text style={styles.editorLabel}>PLAN ASSISTANT</Text>
                <Text style={styles.editorHint}>Describe the training you want, and build it from your saved exercise library.</Text>
                <Pressable onPress={() => setNewPlanMode("ai")} style={styles.planSecondaryAction}><Text style={styles.planSecondaryActionText}>Plan with AI</Text></Pressable>
              </>
            ) : (
              <>
                <Text style={styles.editorHint}>Tell it your goal, days available, experience, equipment, and any limits. It will build from your saved exercise library.</Text>
                {!aiDraft ? (
                  <>
                    <TextInput value={aiPrompt} onChangeText={setAiPrompt} multiline placeholder="Example: I have three days, dumbbells and a bench. I want to build strength without aggravating my knee." placeholderTextColor="#655D57" style={[styles.input, styles.aiPromptInput]} textAlignVertical="top" />
                    <Pressable disabled={generatingPlan} onPress={() => void generateAiPlan()} style={[styles.planPrimaryAction, generatingPlan && styles.buttonDisabled]}><Text style={styles.planPrimaryActionText}>{generatingPlan ? "Building plan…" : "Generate plan"}</Text></Pressable>
                  </>
                ) : (
                  <ScrollView style={styles.aiDraftScroll} contentContainerStyle={styles.aiDraft}>
                    <Text style={styles.editorLabel}>DRAFT PLAN</Text>
                    <Text style={styles.aiDraftTitle}>{aiDraft.name}</Text>
                    {aiDraft.description ? <Text style={styles.editorHint}>{aiDraft.description}</Text> : null}
                    {aiDraft.days.map((day) => (
                      <View key={day.name} style={styles.aiDraftDay}>
                        <Text style={styles.aiDraftDayTitle}>{day.name}</Text>
                        {day.exercises.map((exercise, index) => {
                          const catalogExercise = record.exercises.find((candidate) => candidate.id === exercise.exerciseId);
                          const prescription = exercise.targetReps ? `${exercise.targetSets} × ${exercise.targetReps}` : `${exercise.targetSets} sets`;
                          return <Text key={`${day.name}-${exercise.exerciseId}-${index}`} style={styles.aiDraftExercise}>{catalogExercise?.name ?? "Saved exercise"} · {prescription}{exercise.targetWeight ? ` · ${exercise.targetWeight} ${record.settings.weight_unit}` : ""}</Text>;
                        })}
                      </View>
                    ))}
                    <Pressable disabled={saving} onPress={() => void importAiPlan()} style={[styles.planPrimaryAction, saving && styles.buttonDisabled]}><Text style={styles.planPrimaryActionText}>{saving ? "Adding plan…" : "Add this plan"}</Text></Pressable>
                    <Pressable disabled={saving || generatingPlan} onPress={() => setAiDraft(null)} style={styles.planSecondaryAction}><Text style={styles.planSecondaryActionText}>Start over</Text></Pressable>
                  </ScrollView>
                )}
                <Pressable disabled={saving || generatingPlan} onPress={() => setNewPlanMode("manual")} style={styles.planSecondaryAction}><Text style={styles.planSecondaryActionText}>Build manually</Text></Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>

      {!isDesktop && selectedExercise ? (
        <Modal animationType="slide" transparent visible onRequestClose={() => setSelectedExerciseId(null)}>
          <View style={styles.modalBackdrop}><View style={styles.mobileEditorSheet}>{selectedEditor}</View></View>
        </Modal>
      ) : null}
    </>
  );
}

function ExercisesContent({
  record,
  refresh,
}: {
  record: TransmuteRecord;
  refresh: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"strength" | "cardio" | "mobility">(
    "strength",
  );
  const [muscleGroup, setMuscleGroup] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingDemoExerciseId, setEditingDemoExerciseId] = useState<string | null>(null);
  const [demoUrl, setDemoUrl] = useState("");
  const [demoSourceName, setDemoSourceName] = useState("");
  const submit = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const value = name.trim();
      if (value.length < 2)
        throw new Error("Enter an exercise name with at least 2 characters.");
      await createExercise({
        name: value,
        category,
        muscleGroup: muscleGroup.trim() || undefined,
      });
      setName("");
      setMuscleGroup("");
      await refresh();
      setNotice("Exercise added to the library.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Unable to create the exercise.",
      );
    } finally {
      setSaving(false);
    }
  };

  const saveDemo = async (exerciseId: string) => {
    setSaving(true);
    setNotice(null);
    try {
      await updateExerciseDemo(exerciseId, {
        demoUrl: demoUrl.trim(),
        sourceName: demoSourceName.trim() || undefined,
      });
      await refresh();
      setEditingDemoExerciseId(null);
      setDemoUrl("");
      setDemoSourceName("");
      setNotice("Exercise demonstration source saved.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to save the demonstration source.");
    } finally {
      setSaving(false);
    }
  };

  const openDemo = async (url: string) => {
    try {
      await openBrowserAsync(url);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to open the exercise demonstration.");
    }
  };
  return (
    <>
      <Text style={styles.eyebrow}>THE MOVEMENTS</Text>
      <Text style={styles.title}>Exercise library</Text>
      <Text style={styles.body}>
        Create and organize the movements that make up your plans.
      </Text>
      <View style={styles.formCard}>
        <Text style={styles.cardTitle}>Create exercise</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Exercise name"
          placeholderTextColor="#655D57"
          style={styles.input}
          returnKeyType="next"
        />
        <TextInput
          value={muscleGroup}
          onChangeText={setMuscleGroup}
          placeholder="Muscle group (optional)"
          placeholderTextColor="#655D57"
          style={styles.input}
          returnKeyType="next"
        />
        <View style={styles.exercisePicker}>
          {(["strength", "cardio", "mobility"] as const).map((value) => (
            <Pressable
              key={value}
              onPress={() => setCategory(value)}
              style={[
                styles.exerciseOption,
                category === value && styles.exerciseOptionActive,
              ]}
            >
              <Text
                style={[
                  styles.exerciseOptionText,
                  category === value && styles.exerciseOptionTextActive,
                ]}
              >
                {value}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          disabled={saving}
          onPress={() => void submit()}
          style={[styles.actionButton, saving && styles.buttonDisabled]}
        >
          <Text style={styles.actionButtonText}>Create exercise</Text>
        </Pressable>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Text style={[styles.eyebrow, styles.section]}>LIBRARY</Text>
      {record.exercises.length ? (
        record.exercises.map((exercise) => (
          <View key={exercise.id} style={styles.exerciseCard}>
            <Text style={styles.cardTitle}>{exercise.name}</Text>
            <Text style={styles.cardMeta}>
              {label(exercise.category)}{exercise.muscle_group ? ` · ${exercise.muscle_group}` : ""}
            </Text>
            {editingDemoExerciseId === exercise.id ? (
              <View style={styles.demoForm}>
                <TextInput
                  value={demoUrl}
                  onChangeText={setDemoUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  placeholder="Public demo URL"
                  placeholderTextColor="#655D57"
                  style={styles.input}
                  returnKeyType="next"
                />
                <TextInput
                  value={demoSourceName}
                  onChangeText={setDemoSourceName}
                  placeholder="Source name (optional)"
                  placeholderTextColor="#655D57"
                  style={styles.input}
                  returnKeyType="done"
                  onSubmitEditing={() => void saveDemo(exercise.id)}
                />
                <View style={styles.demoActions}>
                  <Pressable disabled={saving} onPress={() => void saveDemo(exercise.id)}>
                    <Text style={styles.inlineAction}>Save source</Text>
                  </Pressable>
                  <Pressable
                    disabled={saving}
                    onPress={() => {
                      setEditingDemoExerciseId(null);
                      setDemoUrl("");
                      setDemoSourceName("");
                    }}
                  >
                    <Text style={styles.inlineAction}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.demoActions}>
                {exercise.demoUrl ? (
                  <Pressable accessibilityRole="link" onPress={() => void openDemo(exercise.demoUrl!)}>
                    <Text style={styles.inlineAction}>Watch demo</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setEditingDemoExerciseId(exercise.id);
                    setDemoUrl(exercise.demoUrl ?? "");
                    setDemoSourceName(exercise.demoSourceName ?? "");
                  }}
                >
                  <Text style={styles.inlineAction}>{exercise.demoUrl ? "Edit demo source" : "Add demo source"}</Text>
                </Pressable>
              </View>
            )}
          </View>
        ))
      ) : (
        <Card
          title="No exercises yet"
          meta="Create a movement to add it to a plan."
        />
      )}
    </>
  );
}

function SessionsContent({
  record,
  refresh,
  isDesktop,
}: {
  record: TransmuteRecord;
  refresh: () => Promise<void>;
  isDesktop: boolean;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [daySelectorOpen, setDaySelectorOpen] = useState(false);
  const [sessionAction, setSessionAction] = useState<{
    id: string;
    isActive: boolean;
    name: string;
    setCount: number;
    timestamp: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    isActive: boolean;
    name: string;
    setCount: number;
    timestamp: string;
  } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const activePlan =
    record.workoutPlans.find(
      (plan) => plan.id === record.settings.active_routine_id,
    ) ?? null;
  const availableDays = useMemo(
    () => activePlan ? [...activePlan.days].sort((a, b) => a.sortOrder - b.sortOrder) : [],
    [activePlan],
  );
  const activeSession = record.dashboard.activeSession;
  const activeSessionRecord = activeSession
    ? record.sessions.find((session) => session.id === activeSession.id) ?? null
    : null;
  const activeSetCount = activeSessionRecord?.set_count ?? 0;
  const historicalSessions = record.sessions.filter(
    (session) => session.id !== activeSession?.id && session.status !== "active",
  );
  const activeTarget = activeSession
    ? {
        id: activeSession.id,
        isActive: true,
        name: `${activeSession.routine_name ?? "Workout plan"} · ${activeSession.day_name ?? "Session"}`,
        setCount: activeSetCount,
        timestamp: activeSession.started_at,
      }
    : null;

  const start = async (routineDayId: string) => {
    setSaving(true);
    setNotice(null);
    try {
      const { session } = await startWorkoutSession({ routineDayId });
      router.push(`/sessions/${session.id}`);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Unable to start the session.",
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    setNotice(null);
    setDeleteError(null);
    try {
      await deleteWorkoutSession(deleteTarget.id);
      await refresh();
      setDeleteTarget(null);
      setNotice(deleteTarget.isActive ? "Active session discarded." : "Session removed.");
    } catch (reason) {
      setDeleteError(
        reason instanceof Error
          ? reason.message
          : "Unable to remove the session.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Text style={styles.eyebrow}>THE TRAINING LOG</Text>
      <Text style={styles.title}>Sessions</Text>
      <Text style={styles.body}>
        {activeSession
          ? "Continue your current work or choose the next session from your plan."
          : "Choose a day from your active plan and begin the work."}
      </Text>

      {activeSession ? (
        <View style={[styles.sessionActionPanel, styles.activeSessionPanel, isDesktop && styles.sessionActionPanelDesktop]}>
          <View style={styles.sessionActionHeader}>
            <View style={styles.sessionActionCopy}>
              <Text style={styles.editorLabel}>ACTIVE SESSION</Text>
              <Text style={styles.sessionActionTitle}>{activeTarget?.name}</Text>
              <Text style={styles.sessionActionMeta}>
                Started {dayKey(activeSession.started_at) === dayKey(new Date().toISOString()) ? "today" : date(activeSession.started_at)} · {activeSetCount} {activeSetCount === 1 ? "set" : "sets"} recorded
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Session actions"
              accessibilityRole="button"
              onPress={() => setSessionAction(activeTarget)}
              style={styles.sessionOverflowButton}
            >
              <MoreHorizontal color="#101015" size={21} strokeWidth={2.4} />
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" onPress={() => router.push(`/sessions/${activeSession.id}`)} style={styles.sessionContinueButton}>
            <Text style={styles.sessionContinueButtonText}>Continue session</Text>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => router.push(`/sessions/${activeSession.id}`)} style={styles.sessionDetailsAction}>
            <View style={styles.sessionLinkContent}><Text style={styles.sessionDetailsActionText}>View session details</Text><ArrowRight color="#642D2A" size={16} strokeWidth={2.4} /></View>
          </Pressable>
        </View>
      ) : (
        <View style={[styles.sessionActionPanel, isDesktop && styles.sessionActionPanelDesktop]}>
          <Text style={styles.editorLabel}>START A SESSION</Text>
          {!activePlan ? (
            <Text style={styles.cardMeta}>Choose an active workout plan in Workout plans first.</Text>
          ) : availableDays.length === 0 ? (
            <Text style={styles.cardMeta}>This plan has no days yet.</Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose a workout day to start"
              disabled={saving}
              onPress={() => setDaySelectorOpen(true)}
              style={({ pressed }) => [styles.sessionDayPicker, pressed && styles.buttonPressed, saving && styles.buttonDisabled]}
            >
              <View>
                <Text style={styles.sessionDayPickerTitle}>Choose a day</Text>
                <Text style={styles.sessionDayPickerMeta}>{activePlan.name} · {availableDays.length} {availableDays.length === 1 ? "day" : "days"} available</Text>
              </View>
              <ArrowRight color="#642D2A" size={19} strokeWidth={2.4} />
            </Pressable>
          )}
        </View>
      )}

      <Modal animationType="fade" transparent visible={daySelectorOpen} onRequestClose={() => setDaySelectorOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalPanel, isDesktop && styles.modalPanelDesktop]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.editorLabel}>START A SESSION</Text>
                <Text style={styles.modalTitle}>Choose your day.</Text>
                <Text style={styles.modalPlanName}>{activePlan?.name}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close day selection" onPress={() => setDaySelectorOpen(false)} style={styles.modalClose}>
                <X color="#642D2A" size={19} strokeWidth={2.4} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.sessionDaySelectorList} showsVerticalScrollIndicator={false}>
              {availableDays.map((day) => (
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  key={day.id}
                  onPress={() => {
                    setDaySelectorOpen(false);
                    void start(day.id);
                  }}
                  style={({ pressed }) => [styles.sessionDayOption, pressed && styles.buttonPressed, saving && styles.buttonDisabled]}
                >
                  <View>
                    <Text style={styles.sessionDayOptionTitle}>{day.name}</Text>
                    <Text style={styles.sessionDayOptionMeta}>{day.exerciseCount} {day.exerciseCount === 1 ? "exercise" : "exercises"}</Text>
                  </View>
                  <View style={styles.sessionLinkContent}><Text style={styles.sessionDayPickerText}>Start</Text><ArrowRight color="#642D2A" size={16} strokeWidth={2.4} /></View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Text style={[styles.eyebrow, styles.section]}>SESSION HISTORY</Text>
      {historicalSessions.length ? (
        <View style={styles.sessionHistory}>
          {historicalSessions.map((session) => {
            const target = {
              id: session.id,
              isActive: false,
              name: `${session.routine_name ?? "Workout plan"} · ${session.day_name ?? "Day"}`,
              setCount: session.set_count,
              timestamp: session.ended_at ?? session.started_at,
            };
            return (
              <View key={session.id} style={styles.sessionHistoryRow}>
                <Pressable accessibilityRole="link" onPress={() => router.push(`/sessions/${session.id}`)} style={styles.sessionHistoryCopy}>
                  <Text style={styles.sessionHistoryTitle}>{target.name}</Text>
                  <Text style={styles.sessionHistoryMeta}>{session.set_count} {session.set_count === 1 ? "set" : "sets"} · {label(session.status)} · {date(target.timestamp)}</Text>
                </Pressable>
                <View style={styles.sessionHistoryActions}>
                  <Pressable accessibilityRole="link" onPress={() => router.push(`/sessions/${session.id}`)} style={styles.sessionViewAction}>
                    <View style={styles.sessionLinkContent}><Text style={styles.sessionViewActionText}>View session</Text><ArrowRight color="#642D2A" size={16} strokeWidth={2.4} /></View>
                  </Pressable>
                  <Pressable accessibilityLabel={`Actions for ${target.name}`} accessibilityRole="button" onPress={() => setSessionAction(target)} style={styles.sessionOverflowButton}>
                    <MoreHorizontal color="#101015" size={21} strokeWidth={2.4} />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.sessionHistoryEmpty}>
          <Text style={styles.ledgerEmptyTitle}>No completed sessions yet.</Text>
          <Text style={styles.cardMeta}>{activeSession ? "Your active work will appear here once it is completed." : "Start a day from your active workout plan."}</Text>
        </View>
      )}

      <Modal animationType="fade" transparent visible={Boolean(sessionAction)} onRequestClose={() => setSessionAction(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalPanel, isDesktop && styles.modalPanelDesktop]}>
            <View style={styles.modalHeader}>
              <View><Text style={styles.editorLabel}>SESSION ACTIONS</Text><Text style={styles.modalTitle}>{sessionAction?.name}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close session actions" onPress={() => setSessionAction(null)} style={styles.modalClose}><X color="#642D2A" size={19} strokeWidth={2.4} /></Pressable>
            </View>
            <Pressable accessibilityRole="menuitem" onPress={() => { const target = sessionAction; setSessionAction(null); if (target) router.push(`/sessions/${target.id}`); }} style={styles.sessionMenuItem}>
              <Text style={styles.sessionMenuItemText}>View session</Text>
            </Pressable>
            <Pressable accessibilityRole="menuitem" disabled={saving} onPress={() => { if (!sessionAction) return; setDeleteError(null); setDeleteTarget(sessionAction); setSessionAction(null); }} style={styles.sessionMenuItem}>
              <Text style={styles.sessionMenuDangerText}>{sessionAction?.isActive ? "Discard session" : "Remove session"}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={Boolean(deleteTarget)} onRequestClose={() => !saving && setDeleteTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View accessibilityRole="alert" style={[styles.modalPanel, isDesktop && styles.modalPanelDesktop]}>
            <Text style={styles.editorLabel}>{deleteTarget?.isActive ? "DISCARD ACTIVE SESSION?" : "REMOVE SESSION?"}</Text>
            <Text style={styles.modalTitle}>{deleteTarget?.name}</Text>
            <Text style={styles.sessionConfirmCopy}>
              {deleteTarget?.isActive
                ? `${deleteTarget.name} is still in progress. Discarding it will permanently remove its recorded work.`
                : `${deleteTarget?.name} from ${deleteTarget ? date(deleteTarget.timestamp) : "this date"} will be permanently removed.`}
            </Text>
            <Text style={styles.sessionConfirmCopy}>{deleteTarget?.setCount ?? 0} {(deleteTarget?.setCount ?? 0) === 1 ? "recorded set" : "recorded sets"} will be removed. This cannot be undone.</Text>
            {deleteError ? <Text accessibilityRole="alert" style={styles.notice}>{deleteError}</Text> : null}
            <View style={styles.sessionConfirmActions}>
              <Pressable accessibilityRole="button" disabled={saving} onPress={() => setDeleteTarget(null)} style={styles.planSecondaryAction}><Text style={styles.planSecondaryActionText}>{deleteTarget?.isActive ? "Keep session" : "Cancel"}</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={saving} onPress={() => void remove()} style={[styles.sessionDangerButton, saving && styles.buttonDisabled]}><Text style={styles.sessionDangerButtonText}>{saving ? "Removing…" : deleteTarget?.isActive ? "Discard session" : "Remove session"}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function AdminContent() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    const result = await getAdminUsers();
    setUsers(result.users);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await getAdminUsers();
        if (active) setUsers(result.users);
      } catch (reason) {
        if (active) {
          setNotice(
            reason instanceof Error ? reason.message : "Unable to load users.",
          );
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setSaving(true);
    setNotice(null);
    try {
      await operation();
      await refresh();
      setNotice(success);
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Unable to save the user.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Text style={styles.eyebrow}>THE STEWARDSHIP</Text>
      <Text style={styles.title}>Admin</Text>
      <Text style={styles.body}>
        Manage accounts and review the access record from one protected place.
      </Text>
      <View style={styles.formCard}>
        <Text style={styles.cardTitle}>Create user</Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="Username"
          placeholderTextColor="#655D57"
          autoCapitalize="none"
          style={styles.input}
          returnKeyType="next"
        />
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Display name (optional)"
          placeholderTextColor="#655D57"
          style={styles.input}
          returnKeyType="next"
        />
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email (optional)"
          placeholderTextColor="#655D57"
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
          returnKeyType="next"
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password (8 characters minimum)"
          placeholderTextColor="#655D57"
          secureTextEntry
          style={styles.input}
          returnKeyType="done"
          onSubmitEditing={() =>
            void run(async () => {
              await createAdminUser({
                username: username.trim(),
                name: name.trim() || undefined,
                email: email.trim() || undefined,
                password,
              });
              setUsername("");
              setName("");
              setEmail("");
              setPassword("");
            }, "User created.")
          }
        />
        <Pressable
          disabled={saving}
          onPress={() =>
            void run(async () => {
              await createAdminUser({
                username: username.trim(),
                name: name.trim() || undefined,
                email: email.trim() || undefined,
                password,
              });
              setUsername("");
              setName("");
              setEmail("");
              setPassword("");
            }, "User created.")
          }
          style={[styles.actionButton, saving && styles.buttonDisabled]}
        >
          <Text style={styles.actionButtonText}>Create user</Text>
        </Pressable>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Text style={[styles.eyebrow, styles.section]}>ALL USERS · {users.length}</Text>
      {users.map((user) => (
        <AdminUserCard
          key={user.id}
          saving={saving}
          user={user}
          onDelete={() => void run(() => deleteAdminUser(user.id), "User removed.")}
          onSave={(payload) =>
            void run(() => updateAdminUser(user.id, payload), "User updated.")
          }
        />
      ))}
    </>
  );
}

function AdminUserCard({
  user,
  saving,
  onSave,
  onDelete,
}: {
  user: AdminUser;
  saving: boolean;
  onSave: (payload: {
    username: string;
    name?: string;
    email?: string;
    password?: string;
  }) => void;
  onDelete: () => void;
}) {
  const [username, setUsername] = useState(user.username);
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [password, setPassword] = useState("");
  return (
    <View style={styles.adminUserCard}>
      <Text style={styles.cardTitle}>{user.username}</Text>
      <Text style={styles.cardMeta}>
        Created {date(user.createdAt)} · Updated {date(user.updatedAt)}
      </Text>
      <TextInput
        value={username}
        onChangeText={setUsername}
        placeholder="Username"
        placeholderTextColor="#655D57"
        autoCapitalize="none"
        style={styles.input}
      />
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Display name"
        placeholderTextColor="#655D57"
        style={styles.input}
      />
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        placeholderTextColor="#655D57"
        autoCapitalize="none"
        keyboardType="email-address"
        style={styles.input}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="New password (leave blank to keep)"
        placeholderTextColor="#655D57"
        secureTextEntry
        style={styles.input}
      />
      <View style={styles.adminActions}>
        <Pressable
          disabled={saving}
          onPress={() =>
            onSave({
              username: username.trim(),
              name: name.trim() || undefined,
              email: email.trim() || undefined,
              password: password || undefined,
            })
          }
        >
          <Text style={styles.inlineAction}>Save user</Text>
        </Pressable>
        <Pressable disabled={saving} onPress={onDelete}>
          <Text style={styles.destructiveAction}>Remove user</Text>
        </Pressable>
      </View>
      <Text style={[styles.eyebrow, styles.accessLabel]}>ACCESS RECORD</Text>
      {user.ipAddresses.length ? (
        user.ipAddresses.map((address) => (
          <Text key={address.id} style={styles.cardMeta}>
            {address.ipAddress} · {address.hitCount} visits · last {date(address.lastSeenAt)}
          </Text>
        ))
      ) : (
        <Text style={styles.cardMeta}>No recorded access addresses.</Text>
      )}
    </View>
  );
}

function ProgressContent({
  record,
  refresh,
  isDesktop,
}: {
  record: TransmuteRecord;
  refresh: () => Promise<void>;
  isDesktop: boolean;
}) {
  const { view } = useLocalSearchParams<{ view?: string }>();
  const activeView = view === "timeline" ? "timeline" : "calendar";
  const initialDayKey = recordDayKey(
    record.progress[0]?.captured_at ?? record.sessions[0]?.started_at ?? new Date(),
  );
  const [note, setNote] = useState("");
  const [capturedAt, setCapturedAt] = useState(initialDayKey);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [month, setMonth] = useState(() => startOfCalendarMonth(dateFromRecordDayKey(initialDayKey)));
  const [selectedDayKey, setSelectedDayKey] = useState(initialDayKey);
  const [addOpen, setAddOpen] = useState(false);
  const [viewingPhotoId, setViewingPhotoId] = useState<string | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [editingPhotoId, setEditingPhotoId] = useState<string | null>(null);
  const [editingPhotoDate, setEditingPhotoDate] = useState("");
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);

  const photosByDay = useMemo(() => {
    const grouped = new Map<string, TransmuteRecord["progress"]>();
    for (const photo of record.progress) {
      const key = recordDayKey(photo.captured_at);
      grouped.set(key, [...(grouped.get(key) ?? []), photo]);
    }
    return grouped;
  }, [record.progress]);
  const sessionsByDay = useMemo(() => {
    const grouped = new Map<string, TransmuteRecord["sessions"]>();
    for (const session of record.sessions) {
      const key = recordDayKey(session.started_at);
      grouped.set(key, [...(grouped.get(key) ?? []), session]);
    }
    return grouped;
  }, [record.sessions]);
  const selectedPhotos = photosByDay.get(selectedDayKey) ?? [];
  const selectedSessions = sessionsByDay.get(selectedDayKey) ?? [];
  const selectedPhoto =
    selectedPhotos.find((photo) => photo.id === selectedPhotoId) ?? selectedPhotos[0] ?? null;
  const viewedPhoto = record.progress.find((photo) => photo.id === viewingPhotoId) ?? null;
  const visibleMonthKey = calendarMonthKey(month);
  const monthPhotoDays = [...photosByDay.keys()].filter((key) => key.slice(0, 7) === visibleMonthKey);
  const monthSessions = record.sessions.filter(
    (session) =>
      recordDayKey(session.started_at).slice(0, 7) === visibleMonthKey &&
      session.status === "completed",
  );
  const timelineDays = useMemo(() => {
    const keys = new Set([...photosByDay.keys(), ...sessionsByDay.keys()]);
    return [...keys].sort((left, right) => right.localeCompare(left));
  }, [photosByDay, sessionsByDay]);

  const chooseDay = (key: string) => {
    setSelectedDayKey(key);
    setSelectedPhotoId(null);
    setEditingPhotoId(null);
    setRemoveConfirmId(null);
  };

  const setProgressView = (next: "calendar" | "timeline") => {
    router.setParams({ view: next });
  };

  const choosePhoto = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(capturedAt)) {
      setNotice("Enter the photo date as YYYY-MM-DD.");
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
        selectionLimit: 1,
      });
      if (result.canceled) return;

      const photo = result.assets[0];
      if (!photo) throw new Error("Choose one progress photo to upload.");
      await uploadProgressPhoto({
        uri: photo.uri,
        fileName: photo.fileName ?? `progress-${Date.now()}.jpg`,
        mimeType: photo.mimeType ?? "image/jpeg",
        sizeBytes: photo.fileSize,
        capturedAt,
        note,
      });
      setNote("");
      await refresh();
      setAddOpen(false);
      setNotice("Progress photo recorded.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Unable to upload the progress photo.",
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setSaving(true);
    setNotice(null);
    try {
      await deleteProgressPhoto(id);
      await refresh();
      setRemoveConfirmId(null);
      setSelectedPhotoId(null);
      setNotice("Progress photo removed.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Unable to remove the progress photo.",
      );
    } finally {
      setSaving(false);
    }
  };

  const savePhotoDate = async (id: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editingPhotoDate)) {
      setNotice("Enter the photo date as YYYY-MM-DD.");
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await updateProgressPhoto(id, { capturedAt: editingPhotoDate });
      await refresh();
      setEditingPhotoId(null);
      setEditingPhotoDate("");
      setNotice("Progress photo date updated.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Unable to update the progress photo date.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Text style={styles.eyebrow}>THE RECORD</Text>
      <Text style={styles.title}>Progress</Text>
      <Text style={styles.body}>Index the work by date, then examine the evidence that belongs to it.</Text>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <View style={styles.progressViewTabs} accessibilityRole="tablist">
        {(["calendar", "timeline"] as const).map((next) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeView === next }}
            key={next}
            onPress={() => setProgressView(next)}
            style={[styles.progressViewTab, activeView === next && styles.progressViewTabActive]}
          >
            <Text style={[styles.progressViewTabText, activeView === next && styles.progressViewTabTextActive]}>{next === "calendar" ? "Calendar" : "Timeline"}</Text>
          </Pressable>
        ))}
      </View>
      {activeView === "calendar" ? (
        <>
          <View style={styles.monthSummary}>
            <Text style={styles.editorLabel}>THIS MONTH</Text>
            <View style={styles.monthSummaryValues}>
              <Text style={styles.monthSummaryValue}>{monthSessions.length} sessions</Text>
              <Text style={styles.monthSummaryValue}>{monthPhotoDays.length} photo sets</Text>
            </View>
          </View>
          <View style={[styles.progressWorkspace, isDesktop && styles.progressWorkspaceDesktop]}>
            <View style={styles.calendarPanel}>
              <View style={styles.calendarHeader}>
                <View>
                  <Text style={styles.calendarMonth}>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</Text>
                  <Text style={styles.calendarPeriodMeta}>{monthSessions.length} sessions · {monthPhotoDays.length} photo sets</Text>
                </View>
                <View style={styles.calendarControls}>
                  <Pressable accessibilityLabel="Previous month" accessibilityRole="button" onPress={() => setMonth((current) => addCalendarMonths(current, -1))} style={styles.calendarControl}><Text style={styles.calendarControlText}>‹</Text></Pressable>
                  <Pressable accessibilityRole="button" onPress={() => {
                    const today = recordDayKey(new Date());
                    setMonth(startOfCalendarMonth(dateFromRecordDayKey(today)));
                    chooseDay(today);
                  }} style={styles.calendarToday}><Text style={styles.calendarTodayText}>Today</Text></Pressable>
                  <Pressable accessibilityLabel="Next month" accessibilityRole="button" onPress={() => setMonth((current) => addCalendarMonths(current, 1))} style={styles.calendarControl}><Text style={styles.calendarControlText}>›</Text></Pressable>
                </View>
              </View>
              <View style={styles.calendarWeekdays}>{CALENDAR_WEEKDAYS.map((weekday) => <Text key={weekday} style={styles.calendarWeekday}>{weekday}</Text>)}</View>
              <View style={styles.calendarGrid}>
                {calendarGrid(month).map((calendarDate) => {
                  const key = calendarDayKey(calendarDate);
                  const photos = photosByDay.get(key) ?? [];
                  const sessions = sessionsByDay.get(key) ?? [];
                  const inMonth = calendarDate.getMonth() === month.getMonth();
                  const isToday = key === recordDayKey(new Date());
                  const selected = key === selectedDayKey;
                  const recordTypes = [sessions.length ? `${sessions.length} session${sessions.length === 1 ? "" : "s"}` : "", photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
                  return (
                    <Pressable
                      accessibilityLabel={`${calendarDate.toLocaleDateString(undefined, { dateStyle: "full" })}${recordTypes ? `, ${recordTypes}` : ", no records"}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      key={key}
                      onPress={() => chooseDay(key)}
                      style={[styles.calendarCell, !inMonth && styles.calendarCellMuted, isToday && styles.calendarCellToday, selected && styles.calendarCellSelected]}
                    >
                      <Text style={[styles.calendarDate, !inMonth && styles.calendarDateMuted, selected && styles.calendarDateSelected]}>{calendarDate.getDate()}</Text>
                      <View style={styles.calendarMarks}>
                        {sessions.length ? <View style={styles.calendarTrainingMark} /> : null}
                        {photos.length ? <View style={styles.calendarPhotoMark} /> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.calendarLegend}><View style={[styles.legendDot, styles.calendarTrainingMark]} /><Text style={styles.legendText}>Training</Text><View style={[styles.legendDot, styles.calendarPhotoMark]} /><Text style={styles.legendText}>Photo set</Text></View>
            </View>
            <View style={[styles.selectedDayPanel, isDesktop && styles.selectedDayPanelDesktop]}>
              <Text style={styles.editorLabel}>SELECTED DATE</Text>
              <Text style={styles.selectedDayTitle}>{dateFromRecordDayKey(selectedDayKey).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</Text>
              {selectedPhotos.length || selectedSessions.length ? (
                <>
                  {selectedPhotos.length ? (
                    <View style={styles.selectedRecordSection}>
                      <View style={styles.selectedRecordHeading}><Text style={styles.selectedRecordTitle}>Progress photos</Text><Text style={styles.selectedRecordCount}>{selectedPhotos.length} {selectedPhotos.length === 1 ? "photo" : "photos"}</Text></View>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
                        {selectedPhotos.map((photo) => (
                          <Pressable key={photo.id} accessibilityLabel="Open progress photo" onPress={() => { setSelectedPhotoId(photo.id); setViewingPhotoId(photo.id); }} style={[styles.photoThumb, selectedPhoto?.id === photo.id && styles.photoThumbActive]}>
                            {photo.imageUrl ? <Image source={{ uri: photo.imageUrl }} style={styles.photoThumbImage} /> : <View style={styles.photoThumbUnavailable}><Text style={styles.photoThumbUnavailableText}>Unavailable</Text></View>}
                          </Pressable>
                        ))}
                      </ScrollView>
                      {selectedPhoto ? (
                        <View style={styles.photoActionsPanel}>
                          <Text style={styles.photoNote}>{selectedPhoto.note ?? "Progress photo"}</Text>
                          {editingPhotoId === selectedPhoto.id ? (
                            <View style={styles.photoDateEdit}><TextInput value={editingPhotoDate} onChangeText={setEditingPhotoDate} placeholder="YYYY-MM-DD" placeholderTextColor="#655D57" style={[styles.input, styles.photoDateInput]} returnKeyType="done" onSubmitEditing={() => void savePhotoDate(selectedPhoto.id)} /><Pressable disabled={saving} onPress={() => void savePhotoDate(selectedPhoto.id)} style={styles.editorAction}><Text style={styles.editorActionText}>Save</Text></Pressable><Pressable disabled={saving} onPress={() => { setEditingPhotoId(null); setEditingPhotoDate(""); }} style={styles.editorAction}><Text style={styles.editorActionText}>Cancel</Text></Pressable></View>
                          ) : (
                            <View style={styles.photoActionRow}><Pressable disabled={saving} onPress={() => { setEditingPhotoId(selectedPhoto.id); setEditingPhotoDate(recordDayKey(selectedPhoto.captured_at)); }} style={styles.editorAction}><Text style={styles.editorActionText}>Edit date</Text></Pressable><Pressable disabled={saving} onPress={() => setRemoveConfirmId(selectedPhoto.id)} style={styles.editorRemove}><Text style={styles.editorRemoveText}>Remove</Text></Pressable></View>
                          )}
                          {removeConfirmId === selectedPhoto.id ? <View style={styles.removeConfirm}><Text style={styles.removeConfirmText}>Remove this progress photo?</Text><Pressable disabled={saving} onPress={() => void remove(selectedPhoto.id)} style={styles.editorAction}><Text style={styles.editorActionText}>Remove</Text></Pressable><Pressable disabled={saving} onPress={() => setRemoveConfirmId(null)} style={styles.editorAction}><Text style={styles.editorActionText}>Keep</Text></Pressable></View> : null}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  {selectedSessions.length ? <View style={styles.selectedRecordSection}><Text style={styles.selectedRecordTitle}>Training</Text>{selectedSessions.map((session) => <Pressable key={session.id} accessibilityRole="link" onPress={() => router.push(`/sessions/${session.id}`)} style={styles.selectedSessionRow}><View><Text style={styles.selectedSessionName}>{session.routine_name ?? "Workout plan"} · {session.day_name ?? "Day"}</Text><Text style={styles.selectedSessionMeta}>{label(session.status)} · {session.set_count} sets</Text></View><Text style={styles.ledgerSelect}>›</Text></Pressable>)}</View> : null}
                </>
              ) : (
                <View style={styles.selectedDayEmpty}><Text style={styles.ledgerEmptyTitle}>No work recorded on this date.</Text><Text style={styles.editorHint}>Add a progress photo to create a visual check-in.</Text></View>
              )}
              <Pressable accessibilityRole="button" onPress={() => { setCapturedAt(selectedDayKey); setAddOpen(true); }} style={styles.addProgressAction}><Text style={styles.addProgressActionText}>+ Add progress photo</Text></Pressable>
            </View>
          </View>
        </>
      ) : (
        <View style={styles.timelineList}>
          {timelineDays.length ? timelineDays.map((key) => {
            const photos = photosByDay.get(key) ?? [];
            const sessions = sessionsByDay.get(key) ?? [];
            return <Pressable accessibilityRole="button" key={key} onPress={() => { chooseDay(key); setProgressView("calendar"); setMonth(startOfCalendarMonth(dateFromRecordDayKey(key))); }} style={styles.timelineDay}><Text style={styles.timelineDate}>{dateFromRecordDayKey(key).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</Text>{photos.length ? <Text style={styles.timelineRow}>Progress photos · {photos.length} {photos.length === 1 ? "image" : "images"}</Text> : null}{sessions.map((session) => <Text key={session.id} style={styles.timelineRow}>{session.routine_name ?? "Workout plan"} — {session.day_name ?? "Day"} · {session.set_count} sets</Text>)}</Pressable>;
          }) : <View style={styles.selectedDayEmpty}><Text style={styles.ledgerEmptyTitle}>No progress records yet.</Text><Text style={styles.editorHint}>Add the first photo check-in to start the record.</Text><Pressable onPress={() => { setCapturedAt(recordDayKey(new Date())); setAddOpen(true); }} style={styles.addProgressAction}><Text style={styles.addProgressActionText}>+ Add progress photo</Text></Pressable></View>}
        </View>
      )}

      <Modal animationType="fade" transparent visible={addOpen} onRequestClose={() => setAddOpen(false)}><View style={styles.modalBackdrop}><View style={[styles.modalPanel, isDesktop && styles.modalPanelDesktop]}><View style={styles.modalHeader}><View><Text style={styles.editorLabel}>ADD CHECK-IN</Text><Text style={styles.modalTitle}>Record the evidence.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close add check-in" onPress={() => setAddOpen(false)} style={styles.modalClose}><X color="#642D2A" size={19} strokeWidth={2.4} /></Pressable></View><TextInput value={capturedAt} onChangeText={setCapturedAt} placeholder="Photo date (YYYY-MM-DD)" placeholderTextColor="#655D57" style={styles.input} /><TextInput value={note} onChangeText={setNote} placeholder="Note (optional)" placeholderTextColor="#655D57" style={styles.input} returnKeyType="done" onSubmitEditing={() => void choosePhoto()} /><Pressable accessibilityRole="button" disabled={saving} onPress={() => void choosePhoto()} style={[styles.planPrimaryAction, saving && styles.buttonDisabled]}><Text style={styles.planPrimaryActionText}>{saving ? "Recording…" : "Choose progress photo"}</Text></Pressable></View></View></Modal>
      <Modal animationType="fade" transparent visible={Boolean(viewedPhoto)} onRequestClose={() => setViewingPhotoId(null)}><View style={styles.photoViewerBackdrop}><View style={styles.photoViewer}><View style={styles.modalHeader}><Text style={styles.editorLabel}>PROGRESS PHOTO</Text><Pressable accessibilityRole="button" accessibilityLabel="Close progress photo" onPress={() => setViewingPhotoId(null)} style={styles.modalClose}><X color="#642D2A" size={19} strokeWidth={2.4} /></Pressable></View>{viewedPhoto?.imageUrl ? <Image accessibilityLabel={`Progress photo from ${recordDayKey(viewedPhoto.captured_at)}`} source={{ uri: viewedPhoto.imageUrl }} resizeMode="contain" style={styles.photoViewerImage} /> : <View style={styles.progressImageUnavailable}><Text style={styles.cardMeta}>Photo preview unavailable.</Text></View>}<Text style={styles.photoViewerNote}>{viewedPhoto?.note ?? "Progress photo"}</Text></View></View></Modal>
    </>
  );
}

export function LegacyNutritionContent({
  record,
  refresh,
}: {
  record: TransmuteRecord;
  refresh: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [servingSizeG, setServingSizeG] = useState("100");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [foodId, setFoodId] = useState("");
  const [quantity, setQuantity] = useState("100");
  const [mealItems, setMealItems] = useState<{ foodId: string; grams: number }[]>([]);
  const [mealPhoto, setMealPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [mealType, setMealType] = useState<
    "breakfast" | "lunch" | "dinner" | "snack"
  >("snack");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedMealDay, setSelectedMealDay] = useState<string | null>(null);
  const mealDays = Array.from(new Set(record.nutrition.meals.map((meal) => dayKey(meal.consumed_at))));
  const visibleMeals = selectedMealDay
    ? record.nutrition.meals.filter((meal) => dayKey(meal.consumed_at) === selectedMealDay)
    : record.nutrition.meals;
  const run = async (operation: () => Promise<unknown>, success: string) => {
    setSaving(true);
    setNotice(null);
    try {
      await operation();
      await refresh();
      setNotice(success);
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Unable to save nutrition.",
      );
    } finally {
      setSaving(false);
    }
  };
  const searchBarcode = async (candidate = barcode) => {
    const code = candidate.trim();
    if (!/^\d{8,14}$/.test(code)) {
      setNotice("Enter an 8–14 digit barcode.");
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const result = await lookupBarcode(code);
      if (!result.found || !result.food) {
        setNotice("No food was found for that barcode. You can still add it manually.");
        return;
      }
      const { food } = result;
      setName(food.name);
      setBarcode(food.barcodeUpc ?? code);
      setServingSizeG(String(food.servingSizeG));
      setCalories(String(food.caloriesKcal));
      setProtein(String(food.proteinG));
      setCarbs(String(food.carbsG));
      setFat(String(food.fatG));
      if (food.id) setFoodId(food.id);
      setNotice(
        result.source === "local"
          ? "Food found in your library and selected for logging."
          : "Barcode nutrition loaded. Review it, then save the food.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Unable to look up that barcode.",
      );
    } finally {
      setSaving(false);
    }
  };
  const scanBarcode = async () => {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        setNotice("Camera permission is needed to scan a barcode.");
        return;
      }
    }
    setScannerOpen(true);
  };
  const readNutritionLabel = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        base64: true,
        quality: 0.7,
        selectionLimit: 1,
      });
      if (result.canceled) return;
      const image = result.assets[0];
      if (!image?.base64) {
        throw new Error("Choose a readable nutrition-label photo.");
      }
      const parsed = (await parseNutritionLabel(image.base64)).parsed;
      if (parsed.name) setName(parsed.name);
      if (parsed.servingSizeG) setServingSizeG(String(parsed.servingSizeG));
      if (parsed.caloriesKcal !== null) setCalories(String(parsed.caloriesKcal));
      if (parsed.proteinG !== null) setProtein(String(parsed.proteinG));
      if (parsed.carbsG !== null) setCarbs(String(parsed.carbsG));
      if (parsed.fatG !== null) setFat(String(parsed.fatG));
      setNotice(`Label read at ${Math.round(parsed.parseConfidence * 100)}% confidence. Review the values before saving.`);
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Unable to read that nutrition label.",
      );
    } finally {
      setSaving(false);
    }
  };
  const chooseMealPhoto = async () => {
    setNotice(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
        selectionLimit: 1,
      });
      if (!result.canceled && result.assets[0]) setMealPhoto(result.assets[0]);
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Unable to choose a meal photo.",
      );
    }
  };
  const addMealIngredient = () => {
    const grams = Number(quantity);
    if (!foodId || !Number.isFinite(grams) || grams <= 0) {
      setNotice("Choose a food and enter valid grams before adding it.");
      return;
    }
    if (mealItems.length >= 20) {
      setNotice("A meal can contain up to 20 ingredients.");
      return;
    }
    setMealItems((current) => [...current, { foodId, grams }]);
    setQuantity("100");
    setNotice(null);
  };
  return (
    <>
      <Text style={styles.eyebrow}>THE FUEL</Text>
      <Text style={styles.title}>Nutrition</Text>
      <Text style={styles.body}>
        Build a food library, then log each meal as an input.
      </Text>
      <View style={styles.formCard}>
        <Text style={styles.cardTitle}>Create food</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Food name"
          placeholderTextColor="#655D57"
          style={styles.input}
          returnKeyType="next"
        />
        <View style={styles.barcodeRow}>
          <TextInput
            value={barcode}
            onChangeText={setBarcode}
            keyboardType="number-pad"
            placeholder="Barcode (optional)"
            placeholderTextColor="#655D57"
            style={[styles.input, styles.barcodeInput]}
            returnKeyType="done"
            onSubmitEditing={() => void searchBarcode()}
          />
          <Pressable disabled={saving} onPress={() => void searchBarcode()}>
            <Text style={styles.inlineAction}>Look up</Text>
          </Pressable>
          <Pressable disabled={saving} onPress={() => void scanBarcode()}>
            <Text style={styles.inlineAction}>Scan</Text>
          </Pressable>
        </View>
        {scannerOpen ? (
          <View style={styles.scanner}>
            <CameraView
              barcodeScannerSettings={{
                barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128"],
              }}
              onBarcodeScanned={({ data }) => {
                if (!data || saving) return;
                setBarcode(data);
                setScannerOpen(false);
                void searchBarcode(data);
              }}
              style={styles.scannerCamera}
            />
            <Pressable onPress={() => setScannerOpen(false)}>
              <Text style={styles.inlineAction}>Close scanner</Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable disabled={saving} onPress={() => void readNutritionLabel()}>
          <Text style={styles.inlineAction}>Read a nutrition-label photo</Text>
        </Pressable>
        <TextInput
          value={servingSizeG}
          onChangeText={setServingSizeG}
          keyboardType="decimal-pad"
          placeholder="Nutrition reference grams (usually 100)"
          placeholderTextColor="#655D57"
          style={styles.input}
          returnKeyType="next"
        />
        <TextInput
          value={calories}
          onChangeText={setCalories}
          keyboardType="number-pad"
          placeholder="Calories per serving"
          placeholderTextColor="#655D57"
          style={styles.input}
          returnKeyType="next"
        />
        <View style={styles.macroRow}>
          <TextInput
            value={protein}
            onChangeText={setProtein}
            keyboardType="decimal-pad"
            placeholder="Protein g"
            placeholderTextColor="#655D57"
            style={[styles.input, styles.macroInput]}
          />
          <TextInput
            value={carbs}
            onChangeText={setCarbs}
            keyboardType="decimal-pad"
            placeholder="Carbs g"
            placeholderTextColor="#655D57"
            style={[styles.input, styles.macroInput]}
          />
          <TextInput
            value={fat}
            onChangeText={setFat}
            keyboardType="decimal-pad"
            placeholder="Fat g"
            placeholderTextColor="#655D57"
            style={[styles.input, styles.macroInput]}
          />
        </View>
        <Pressable
          disabled={saving}
          onPress={() =>
            void run(async () => {
              const caloriesKcal = Number(calories);
              const parsedServingSizeG = Number(servingSizeG);
              if (
                name.trim().length < 2 ||
                !Number.isInteger(caloriesKcal) ||
                caloriesKcal < 0 ||
                !Number.isFinite(parsedServingSizeG) ||
                parsedServingSizeG <= 0
              )
                throw new Error("Enter a food name, whole calories, and reference grams.");
              await createFood({
                name: name.trim(),
                caloriesKcal,
                proteinG: protein.trim() ? Number(protein) : undefined,
                carbsG: carbs.trim() ? Number(carbs) : undefined,
                fatG: fat.trim() ? Number(fat) : undefined,
                servingSizeG: parsedServingSizeG,
                barcodeUpc: barcode.trim() || undefined,
              });
              setName("");
              setBarcode("");
              setServingSizeG("100");
              setCalories("");
              setProtein("");
              setCarbs("");
              setFat("");
            }, "Food added to your library.")
          }
          style={[styles.actionButton, saving && styles.buttonDisabled]}
        >
          <Text style={styles.actionButtonText}>Save food</Text>
        </Pressable>
      </View>
      <View style={styles.formCard}>
        <Text style={styles.cardTitle}>Log a meal</Text>
        <View style={styles.exercisePicker}>
          {record.nutrition.foods.map((food) => (
            <Pressable
              key={food.id}
              onPress={() => setFoodId(food.id)}
              style={[
                styles.exerciseOption,
                food.id === foodId && styles.exerciseOptionActive,
              ]}
            >
              <Text
                style={[
                  styles.exerciseOptionText,
                  food.id === foodId && styles.exerciseOptionTextActive,
                ]}
              >
                {food.name}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="decimal-pad"
          placeholder="Grams eaten"
          placeholderTextColor="#655D57"
          style={styles.input}
        />
        <Pressable disabled={saving || !foodId} onPress={addMealIngredient}>
          <Text style={styles.inlineAction}>Add ingredient</Text>
        </Pressable>
        {mealItems.length ? (
          <View style={styles.mealIngredients}>
            <Text style={styles.eyebrow}>THIS MEAL</Text>
            {mealItems.map((item, index) => {
              const food = record.nutrition.foods.find((candidate) => candidate.id === item.foodId);
              return (
                <View key={`${item.foodId}-${index}`} style={styles.mealIngredient}>
                  <Text style={styles.cardMeta}>{food?.name ?? "Food"} · {item.grams}g</Text>
                  <Pressable disabled={saving} onPress={() => setMealItems((current) => current.filter((_, currentIndex) => currentIndex !== index))}>
                    <Text style={styles.destructiveAction}>Remove</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : null}
        <View style={styles.exercisePicker}>
          {(["breakfast", "lunch", "dinner", "snack"] as const).map((type) => (
            <Pressable
              key={type}
              onPress={() => setMealType(type)}
              style={[
                styles.exerciseOption,
                type === mealType && styles.exerciseOptionActive,
              ]}
            >
              <Text
                style={[
                  styles.exerciseOptionText,
                  type === mealType && styles.exerciseOptionTextActive,
                ]}
              >
                {type}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.inlineActions}>
          <Pressable disabled={saving} onPress={() => void chooseMealPhoto()}>
            <Text style={styles.inlineAction}>
              {mealPhoto ? "Replace meal photo" : "Add meal photo"}
            </Text>
          </Pressable>
          {mealPhoto ? (
            <Pressable disabled={saving} onPress={() => setMealPhoto(null)}>
              <Text style={styles.inlineAction}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
        {mealPhoto ? (
          <Image
            accessibilityLabel="Selected meal photo"
            source={{ uri: mealPhoto.uri }}
            style={styles.mealPhotoPreview}
          />
        ) : null}
        <Pressable
          disabled={saving || !mealItems.length}
          onPress={() =>
            void run(async () => {
              if (!mealItems.length) throw new Error("Add at least one ingredient to the meal.");
              const { meals } = await createMealLog({
                mealType,
                items: mealItems,
              });
              const meal = meals[0];
              if (!meal) throw new Error("The meal could not be created.");
              if (mealPhoto) {
                try {
                  await uploadMealPhoto(meal.id, {
                    uri: mealPhoto.uri,
                    fileName: mealPhoto.fileName ?? `meal-${Date.now()}.jpg`,
                    mimeType: mealPhoto.mimeType ?? "image/jpeg",
                    sizeBytes: mealPhoto.fileSize,
                  });
                } catch (reason) {
                  await refresh();
                  throw new Error(
                    `Meal logged, but photo failed: ${reason instanceof Error ? reason.message : "Unable to upload the meal photo."}`,
                  );
                }
              }
              setMealItems([]);
              setQuantity("100");
              setMealPhoto(null);
            }, mealPhoto ? "Meal and photo logged." : "Meal logged.")
          }
          style={[
            styles.actionButton,
            (saving || !mealItems.length) && styles.buttonDisabled,
          ]}
        >
          <Text style={styles.actionButtonText}>Log meal</Text>
        </Pressable>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Text style={[styles.eyebrow, styles.section]}>MEAL HISTORY</Text>
      {mealDays.length ? (
        <View style={styles.mealDayFilters}>
          <Pressable
            onPress={() => setSelectedMealDay(null)}
            style={[styles.exerciseOption, selectedMealDay === null && styles.exerciseOptionActive]}
          >
            <Text style={[styles.exerciseOptionText, selectedMealDay === null && styles.exerciseOptionTextActive]}>All days</Text>
          </Pressable>
          {mealDays.map((day) => (
            <Pressable
              key={day}
              onPress={() => setSelectedMealDay(day)}
              style={[styles.exerciseOption, selectedMealDay === day && styles.exerciseOptionActive]}
            >
              <Text style={[styles.exerciseOptionText, selectedMealDay === day && styles.exerciseOptionTextActive]}>
                {new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {visibleMeals.length ? (
        visibleMeals.map((meal) => (
          <Card
            key={meal.id}
            title={meal.name}
            meta={`${label(meal.meal_type)} · ${meal.calories_kcal} kcal · ${date(meal.consumed_at)}`}
            imageUrl={meal.imageUrl}
          />
        ))
      ) : (
        <Card
          title="No meals logged yet"
          meta="Choose a food above to add your first meal."
        />
      )}
    </>
  );
}

function fastElapsed(minutes: number) {
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const remainder = Math.max(0, minutes % 60);
  return days ? `${days}d ${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function fastTime(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function fastStartLabel(value: string) {
  const started = new Date(value);
  const today = new Date();
  const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const difference = Math.round((midnight(today) - midnight(started)) / 86_400_000);
  if (difference === 0) return `Started today at ${fastTime(value)}`;
  if (difference === 1) return `Started yesterday at ${fastTime(value)}`;
  return `Started ${started.toLocaleDateString(undefined, { month: "short", day: "numeric" })} at ${fastTime(value)}`;
}

function FastingContent({
  record,
  refresh,
}: {
  record: TransmuteRecord;
  refresh: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [customTargetOpen, setCustomTargetOpen] = useState(false);
  const [customTargetHours, setCustomTargetHours] = useState("");
  const [targetMinutes, setTargetMinutes] = useState<number | null>(16 * 60);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [fastDeleteTarget, setFastDeleteTarget] = useState<TransmuteRecord["fasting"]["logs"][number] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { width } = useWindowDimensions();
  const active = record.fasting.active;
  const activeMinutes = active
    ? Math.max(0, Math.floor((now - new Date(active.started_at).getTime()) / 60_000))
    : 0;
  const activeTargetMinutes = active?.target_minutes ?? null;
  const progress = activeTargetMinutes ? Math.min(1, activeMinutes / activeTargetMinutes) : null;
  const endAt = active && activeTargetMinutes ? new Date(new Date(active.started_at).getTime() + activeTargetMinutes * 60_000) : null;
  const remainingMinutes = activeTargetMinutes ? Math.max(0, activeTargetMinutes - activeMinutes) : null;

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [active]);

  const revealNote = () => {
    setNote((current) => current || active?.note || "");
    setNoteOpen(true);
  };

  const startFast = async () => {
    const customHours = Number(customTargetHours);
    const resolvedTarget = customTargetOpen
      ? Number.isFinite(customHours) && customHours > 0 ? Math.round(customHours * 60) : null
      : targetMinutes;
    if (customTargetOpen && (!resolvedTarget || resolvedTarget > 60 * 24 * 7)) {
      setNotice("Enter a target between 1 minute and 7 days.");
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await updateFasting({ action: "start", note: note.trim() || undefined, targetMinutes: resolvedTarget ?? undefined });
      setNote("");
      setNoteOpen(false);
      await refresh();
      setNotice("Fast started.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to start the fast.");
    } finally {
      setSaving(false);
    }
  };

  const endFast = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const result = await updateFasting({ action: "end", note: note.trim() || undefined });
      setNote("");
      setNoteOpen(false);
      setEndConfirmOpen(false);
      await refresh();
      setNotice(result.discarded ? "Fast under 5 minutes discarded." : "Fast ended and saved.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to end the fast.");
    } finally {
      setSaving(false);
    }
  };

  const deleteFast = async () => {
    if (!fastDeleteTarget) return;
    setSaving(true);
    setNotice(null);
    try {
      await deleteFastingLog(fastDeleteTarget.id);
      await refresh();
      setFastDeleteTarget(null);
      setNotice("Fast removed.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to remove the fast.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Text style={styles.eyebrow}>THE INTERVAL</Text>
      <Text style={styles.title}>Fasting</Text>
      {active ? (
        <View style={styles.fastHero}>
          <FastingHourglass progress={progress} size={Math.min(166, Math.max(128, width - 190))} />
          <Text style={styles.fastElapsed}>{fastElapsed(activeMinutes)}</Text>
          <Text style={styles.fastElapsedLabel}>{activeTargetMinutes ? "ELAPSED" : "OPEN-ENDED FAST"}</Text>
          <Text style={styles.fastTimestamp}>{fastStartLabel(active.started_at)}</Text>
          {activeTargetMinutes && endAt && progress !== null ? <View style={styles.fastTarget}>
            <Text style={styles.fastTargetTitle}>Target {durationFromMinutes(activeTargetMinutes)}</Text>
            <Text style={styles.fastTargetMeta}>Ends {fastStartLabel(endAt.toISOString()).replace("Started ", "")}</Text>
            <View style={styles.fastProgressTrack}><View style={[styles.fastProgressFill, { width: `${Math.round(progress * 100)}%` }]} /></View>
            <Text style={styles.fastProgressLabel}>{Math.round(progress * 100)}% complete · {durationFromMinutes(remainingMinutes ?? 0)} remaining</Text>
          </View> : null}
          <Pressable disabled={saving} onPress={() => setEndConfirmOpen(true)} style={[styles.actionButton, styles.fastEndButton, saving && styles.buttonDisabled]}><Text style={styles.actionButtonText}>End Fast</Text></Pressable>
          {noteOpen ? <View style={styles.fastNoteEditor}><TextInput value={note} onChangeText={setNote} placeholder="Add a note" placeholderTextColor="#655D57" style={styles.input} returnKeyType="done" /><Pressable onPress={() => setNoteOpen(false)}><Text style={styles.editorRemoveText}>Hide note</Text></Pressable></View> : <Pressable onPress={revealNote} style={styles.fastNoteAction}><Text style={styles.editorRemoveText}>{active.note ? "Edit Note" : "+ Add a Note"}</Text></Pressable>}
        </View>
      ) : (
        <View style={styles.fastStart}>
          <Text style={styles.fastStartTitle}>Begin an interval.</Text>
          <Text style={styles.editorHint}>Choose a target or keep this fast open-ended.</Text>
          <View style={styles.fastTargets}>
            {[12, 14, 16, 18].map((hours) => <Pressable key={hours} onPress={() => { setTargetMinutes(hours * 60); setCustomTargetOpen(false); }} style={[styles.fastTargetOption, !customTargetOpen && targetMinutes === hours * 60 && styles.fastTargetOptionActive]}><Text style={[styles.fastTargetOptionText, !customTargetOpen && targetMinutes === hours * 60 && styles.fastTargetOptionTextActive]}>{hours}h</Text></Pressable>)}
            <Pressable onPress={() => { setTargetMinutes(null); setCustomTargetOpen(false); }} style={[styles.fastTargetOption, !customTargetOpen && targetMinutes === null && styles.fastTargetOptionActive]}><Text style={[styles.fastTargetOptionText, !customTargetOpen && targetMinutes === null && styles.fastTargetOptionTextActive]}>Open-ended</Text></Pressable>
            <Pressable onPress={() => setCustomTargetOpen(true)} style={[styles.fastTargetOption, customTargetOpen && styles.fastTargetOptionActive]}><Text style={[styles.fastTargetOptionText, customTargetOpen && styles.fastTargetOptionTextActive]}>Custom</Text></Pressable>
          </View>
          {customTargetOpen ? <TextInput value={customTargetHours} onChangeText={setCustomTargetHours} keyboardType="decimal-pad" placeholder="Target hours" placeholderTextColor="#655D57" style={styles.input} /> : null}
          {noteOpen ? <View style={styles.fastNoteEditor}><TextInput value={note} onChangeText={setNote} placeholder="Add a note" placeholderTextColor="#655D57" style={styles.input} /><Pressable onPress={() => setNoteOpen(false)}><Text style={styles.editorRemoveText}>Hide note</Text></Pressable></View> : <Pressable onPress={revealNote} style={styles.fastNoteAction}><Text style={styles.editorRemoveText}>+ Add a Note</Text></Pressable>}
          <Pressable disabled={saving} onPress={() => void startFast()} style={[styles.actionButton, styles.fastEndButton, saving && styles.buttonDisabled]}><Text style={styles.actionButtonText}>Start Fast</Text></Pressable>
        </View>
      )}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Text style={[styles.eyebrow, styles.section]}>FAST HISTORY</Text>
      {record.fasting.logs.length ? <View style={styles.fastHistory}>
        {record.fasting.logs.map((fast) => <View key={fast.id} style={styles.fastHistoryRow}><Text style={styles.fastHistoryDate}>{new Date(fast.ended_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase()}</Text><View style={styles.fastHistoryCopy}><Text style={styles.fastHistoryDuration}>{durationFromMinutes(fast.duration_minutes)}</Text><Text style={styles.fastHistoryMeta}>{fastTime(fast.started_at)} — {fastTime(fast.ended_at)}</Text>{fast.note ? <Text numberOfLines={1} style={styles.fastHistoryNote}>{fast.note}</Text> : null}</View><Pressable accessibilityRole="button" accessibilityLabel={`Remove fast from ${date(fast.ended_at)}`} disabled={saving} onPress={() => setFastDeleteTarget(fast)} style={styles.fastHistoryRemove}><Text style={styles.editorRemoveText}>Remove</Text></Pressable></View>)}
      </View> : <View style={styles.fastEmptyHistory}><Text style={styles.fastEmptyTitle}>No completed fasts yet.</Text><Text style={styles.editorHint}>Your finished intervals will appear here.</Text></View>}
      <Modal animationType="fade" transparent visible={endConfirmOpen} onRequestClose={() => setEndConfirmOpen(false)}><View style={styles.modalBackdrop}><View style={[styles.modalPanel, styles.confirmRemovalPanel]}><Text style={styles.editorLabel}>END THIS FAST?</Text><Text style={styles.modalTitle}>{fastElapsed(activeMinutes)} elapsed</Text><Text style={styles.editorHint}>Your interval will be saved to the fast history. Fasts under five minutes are discarded.</Text><View style={styles.confirmRemovalActions}><Pressable disabled={saving} onPress={() => setEndConfirmOpen(false)} style={[styles.planSecondaryAction, saving && styles.buttonDisabled]}><Text style={styles.planSecondaryActionText}>Keep Fasting</Text></Pressable><Pressable disabled={saving} onPress={() => void endFast()} style={[styles.confirmRemovalAction, saving && styles.buttonDisabled]}><Text style={styles.planPrimaryActionText}>{saving ? "Ending…" : "End Fast"}</Text></Pressable></View></View></View></Modal>
      <Modal animationType="fade" transparent visible={fastDeleteTarget !== null} onRequestClose={() => setFastDeleteTarget(null)}><View style={styles.modalBackdrop}><View style={[styles.modalPanel, styles.confirmRemovalPanel]}><Text style={styles.editorLabel}>REMOVE FAST</Text><Text style={styles.modalTitle}>Remove this record?</Text><Text style={styles.editorHint}>{fastDeleteTarget ? `${durationFromMinutes(fastDeleteTarget.duration_minutes)} completed on ${date(fastDeleteTarget.ended_at)} will be permanently removed.` : ""}</Text><View style={styles.confirmRemovalActions}><Pressable disabled={saving} onPress={() => setFastDeleteTarget(null)} style={[styles.planSecondaryAction, saving && styles.buttonDisabled]}><Text style={styles.planSecondaryActionText}>Cancel</Text></Pressable><Pressable disabled={saving} onPress={() => void deleteFast()} style={[styles.confirmRemovalAction, saving && styles.buttonDisabled]}><Text style={styles.planPrimaryActionText}>{saving ? "Removing…" : "Remove Fast"}</Text></Pressable></View></View></View></Modal>
    </>
  );
}

function FriendsContent({
  record,
  refresh,
}: {
  record: TransmuteRecord;
  refresh: () => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const run = async (operation: () => Promise<unknown>, success: string) => {
    setSaving(true);
    setNotice(null);
    try {
      await operation();
      await refresh();
      setNotice(success);
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Unable to update friends.",
      );
    } finally {
      setSaving(false);
    }
  };
  const incoming = record.friends.incoming.filter(
    (request) => request.status === "pending",
  );
  const outgoing = record.friends.outgoing.filter(
    (request) => request.status === "pending",
  );
  const friends = [
    ...record.friends.incoming,
    ...record.friends.outgoing,
  ].filter((request) => request.status === "accepted");
  return (
    <>
      <Text style={styles.eyebrow}>THE COMPANY</Text>
      <Text style={styles.title}>Friend</Text>
      <Text style={styles.body}>
        Send requests by username. Accepted friends can see workout sessions
        only.
      </Text>
      <View style={styles.formCard}>
        <Text style={styles.cardTitle}>Add friend</Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          placeholder="Friend username"
          placeholderTextColor="#655D57"
          style={styles.input}
          onSubmitEditing={() =>
            void run(async () => {
              const value = username.trim();
              if (value.length < 3)
                throw new Error("Enter a username with at least 3 characters.");
              await sendFriendRequest(value);
              setUsername("");
            }, "Friend request sent.")
          }
          returnKeyType="done"
        />
        <Pressable
          disabled={saving}
          onPress={() =>
            void run(async () => {
              const value = username.trim();
              if (value.length < 3)
                throw new Error("Enter a username with at least 3 characters.");
              await sendFriendRequest(value);
              setUsername("");
            }, "Friend request sent.")
          }
          style={[styles.actionButton, saving && styles.buttonDisabled]}
        >
          <Text style={styles.actionButtonText}>Send request</Text>
        </Pressable>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Text style={[styles.eyebrow, styles.section]}>INCOMING REQUESTS</Text>
      {incoming.length ? (
        incoming.map((request) => (
          <View key={request.id} style={styles.card}>
            <Text style={styles.cardTitle}>
              {request.name ?? request.username}
            </Text>
            <Text style={styles.cardMeta}>@{request.username}</Text>
            <View style={styles.inlineActions}>
              <Pressable
                disabled={saving}
                onPress={() =>
                  void run(
                    () => acceptFriendRequest(request.id),
                    "Friend request accepted.",
                  )
                }
              >
                <Text style={styles.inlineAction}>Accept</Text>
              </Pressable>
              <Pressable
                disabled={saving}
                onPress={() =>
                  void run(
                    () => rejectFriendRequest(request.id),
                    "Friend request declined.",
                  )
                }
              >
                <Text style={styles.inlineAction}>Decline</Text>
              </Pressable>
            </View>
          </View>
        ))
      ) : (
        <Card title="No incoming requests" />
      )}
      <Text style={[styles.eyebrow, styles.section]}>FRIENDS</Text>
      {friends.length ? (
        friends.map((friend) => (
          <View key={friend.id} style={styles.card}>
            <Text style={styles.cardTitle}>
              {friend.name ?? friend.username}
            </Text>
            <Text style={styles.cardMeta}>@{friend.username}</Text>
            <Pressable
              disabled={saving}
              onPress={() =>
                void run(() => removeFriend(friend.userId), "Friend removed.")
              }
            >
              <Text style={styles.inlineAction}>Remove</Text>
            </Pressable>
          </View>
        ))
      ) : (
        <Card title="No friends yet" />
      )}
      <Text style={[styles.eyebrow, styles.section]}>FRIENDS’ WORKOUT ACTIVITY</Text>
      {record.friends.activity.length ? (
        record.friends.activity.map((session) => (
          <Pressable
            key={session.id}
            accessibilityRole="link"
            onPress={() => router.push(`/shared-sessions/${session.id}`)}
            style={styles.card}
          >
            <Text style={styles.cardTitle}>{session.name ?? session.username}</Text>
            <Text style={styles.cardMeta}>
              @{session.username} · {session.routineName ?? "Workout plan"} / {session.dayName ?? "Day"} · {label(session.status)} · {session.setCount} sets · {date(session.startedAt)}
            </Text>
            <Text style={styles.inlineAction}>Open workout record</Text>
          </Pressable>
        ))
      ) : (
        <Card
          title="No friend activity yet"
          meta="Accepted friends share workout sessions only."
        />
      )}
      <Text style={[styles.eyebrow, styles.section]}>SENT REQUESTS</Text>
      {outgoing.length ? (
        outgoing.map((request) => (
          <Card
            key={request.id}
            title={request.name ?? request.username}
            meta="Pending"
          />
        ))
      ) : (
        <Card title="No pending sent requests" />
      )}
    </>
  );
}

function SettingsContent({
  record,
  refresh,
}: {
  record: TransmuteRecord;
  refresh: () => Promise<void>;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const chooseUnit = async (weightUnit: "kg" | "lbs") => {
    setSaving(true);
    setNotice(null);
    try {
      await updateWeightUnit(weightUnit);
      await refresh();
      setNotice("Weight unit saved.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Unable to save preferences.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Text style={styles.eyebrow}>THE INSTRUMENT</Text>
      <Text style={styles.title}>Your preferences</Text>
      <Text style={styles.body}>Set the terms of the record.</Text>
      <View style={styles.formCard}>
        <Text style={styles.cardTitle}>Weight unit</Text>
        <View style={styles.exercisePicker}>
          {(["lbs", "kg"] as const).map((unit) => (
            <Pressable
              key={unit}
              disabled={saving}
              onPress={() => void chooseUnit(unit)}
              style={[
                styles.exerciseOption,
                record.settings.weight_unit === unit &&
                  styles.exerciseOptionActive,
              ]}
            >
              <Text
                style={[
                  styles.exerciseOptionText,
                  record.settings.weight_unit === unit &&
                    styles.exerciseOptionTextActive,
                ]}
              >
                {unit}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.cardMeta}>
          {record.settings.active_routine_id
            ? "An active workout plan is selected."
            : "No active workout plan selected."}
        </Text>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#F4EFE7", flex: 1 },
  wrap: {
    flex: 1,
    maxWidth: 1120,
    width: "100%",
    alignSelf: "center",
    paddingHorizontal: 24,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 10,
  },
  wordmark: { alignItems: "center", flexDirection: "row", gap: 10 },
  headerAccount: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 44 },
  wordmarkText: {
    color: "#101015",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 2.1,
  },
  signOut: {
    color: "#101015",
    fontSize: 14,
    fontWeight: "800",
    textDecorationColor: "#A95B5B",
    textDecorationLine: "underline",
  },
  nav: {
    borderBottomColor: "#D4C9B9",
    borderBottomWidth: 1,
    borderTopColor: "#D4C9B9",
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 18,
    paddingVertical: 12,
  },
  navButton: { paddingHorizontal: 2, paddingVertical: 5 },
  navItem: { color: "#5F5752", fontSize: 14, fontWeight: "700" },
  navActive: {
    color: "#101015",
    textDecorationColor: "#A95B5B",
    textDecorationLine: "underline",
  },
  content: { paddingBottom: 56, maxWidth: 760, width: "100%" },
  planPageContent: { maxWidth: 1120 },
  eyebrow: {
    color: "#642D2A",
    fontFamily: "Courier",
    fontSize: 12,
    letterSpacing: 1.5,
    marginTop: 18,
  },
  title: {
    color: "#101015",
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: -2.2,
    lineHeight: 44,
    marginTop: 12,
  },
  body: { color: "#2C2C31", fontSize: 17, lineHeight: 27, marginTop: 14 },
  loading: { alignItems: "flex-start", gap: 8, marginTop: 100 },
  card: {
    borderColor: "#D4C9B9",
    borderWidth: 1,
    marginTop: 12,
    padding: 16,
    backgroundColor: "#FBF7F0",
    minWidth: 220,
  },
  progressCard: {
    backgroundColor: "#FBF7F0",
    borderColor: "#D4C9B9",
    borderWidth: 1,
    marginTop: 12,
    overflow: "hidden",
  },
  progressImage: { backgroundColor: "#DED4C6", height: 260, width: "100%" },
  cardImage: { backgroundColor: "#DED4C6", height: 140, marginBottom: 12, width: "100%" },
  progressImageUnavailable: {
    alignItems: "center",
    backgroundColor: "#DED4C6",
    height: 160,
    justifyContent: "center",
  },
  progressDetails: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 14,
    justifyContent: "space-between",
    padding: 16,
  },
  progressActions: { alignItems: "flex-end", gap: 8 },
  progressViewTabs: { borderBottomColor: "#D4C9B9", borderBottomWidth: 1, flexDirection: "row", gap: 16, marginTop: 20 },
  progressViewTab: { minHeight: 42, justifyContent: "center", paddingHorizontal: 3 },
  progressViewTabActive: { borderBottomColor: "#642D2A", borderBottomWidth: 3 },
  progressViewTabText: { color: "#655D57", fontSize: 14, fontWeight: "700" },
  progressViewTabTextActive: { color: "#101015", fontWeight: "900" },
  monthSummary: { borderBottomColor: "#D4C9B9", borderBottomWidth: 1, gap: 9, paddingVertical: 16 },
  monthSummaryValues: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  monthSummaryValue: { color: "#101015", fontSize: 15, fontWeight: "800" },
  progressWorkspace: { gap: 20, marginTop: 18 },
  progressWorkspaceDesktop: { alignItems: "stretch", flexDirection: "row" },
  calendarPanel: { flex: 1, minWidth: 0 },
  calendarHeader: { alignItems: "flex-start", flexDirection: "row", gap: 12, justifyContent: "space-between", marginBottom: 15 },
  calendarMonth: { color: "#101015", fontSize: 24, fontWeight: "900", letterSpacing: -1 },
  calendarPeriodMeta: { color: "#655D57", fontSize: 13, marginTop: 4 },
  calendarControls: { alignItems: "center", flexDirection: "row", gap: 4 },
  calendarControl: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 38 },
  calendarControlText: { color: "#101015", fontSize: 28, fontWeight: "400", lineHeight: 30 },
  calendarToday: { alignItems: "center", borderColor: "#D4C9B9", borderWidth: 1, justifyContent: "center", minHeight: 38, paddingHorizontal: 9 },
  calendarTodayText: { color: "#101015", fontSize: 12, fontWeight: "800" },
  calendarWeekdays: { flexDirection: "row" },
  calendarWeekday: { color: "#655D57", flex: 1, fontFamily: "Courier", fontSize: 9, fontWeight: "800", letterSpacing: 0.4, paddingBottom: 7, textAlign: "center" },
  calendarGrid: { borderLeftColor: "#D4C9B9", borderLeftWidth: 1, borderTopColor: "#D4C9B9", borderTopWidth: 1, flexDirection: "row", flexWrap: "wrap" },
  calendarCell: { alignItems: "center", borderBottomColor: "#D4C9B9", borderBottomWidth: 1, borderRightColor: "#D4C9B9", borderRightWidth: 1, minHeight: 52, paddingTop: 6, width: "14.285714%" },
  calendarCellMuted: { backgroundColor: "#EEE8DF" },
  calendarCellToday: { borderColor: "#101015", borderWidth: 1 },
  calendarCellSelected: { backgroundColor: "#E8DED2" },
  calendarDate: { color: "#101015", fontSize: 13, fontWeight: "800" },
  calendarDateMuted: { color: "#9A9189" },
  calendarDateSelected: { color: "#642D2A" },
  calendarMarks: { alignItems: "center", flexDirection: "row", gap: 3, height: 12, justifyContent: "center", marginTop: 4 },
  calendarTrainingMark: { backgroundColor: "#642D2A", height: 4, width: 12 },
  calendarPhotoMark: { backgroundColor: "#B68A36", height: 4, width: 12 },
  calendarLegend: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  legendDot: { height: 6, width: 12 },
  legendText: { color: "#655D57", fontSize: 12, marginRight: 8 },
  selectedDayPanel: { borderTopColor: "#101015", borderTopWidth: 1, gap: 15, paddingTop: 18 },
  selectedDayPanelDesktop: { backgroundColor: "#FBF7F0", borderLeftColor: "#D4C9B9", borderLeftWidth: 1, borderTopWidth: 0, flexBasis: 340, padding: 20 },
  selectedDayTitle: { color: "#101015", fontSize: 24, fontWeight: "900", letterSpacing: -1, marginTop: -7 },
  selectedDayEmpty: { borderBottomColor: "#D4C9B9", borderBottomWidth: 1, gap: 7, paddingVertical: 14 },
  selectedRecordSection: { borderBottomColor: "#D4C9B9", borderBottomWidth: 1, gap: 10, paddingBottom: 15 },
  selectedRecordHeading: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between" },
  selectedRecordTitle: { color: "#101015", fontSize: 16, fontWeight: "900" },
  selectedRecordCount: { color: "#655D57", fontSize: 12 },
  photoStrip: { gap: 8 },
  photoThumb: { borderColor: "#D4C9B9", borderWidth: 1, height: 76, overflow: "hidden", width: 76 },
  photoThumbActive: { borderColor: "#642D2A", borderWidth: 2 },
  photoThumbImage: { backgroundColor: "#DED4C6", height: "100%", width: "100%" },
  photoThumbUnavailable: { alignItems: "center", backgroundColor: "#DED4C6", height: "100%", justifyContent: "center", paddingHorizontal: 5, width: "100%" },
  photoThumbUnavailableText: { color: "#655D57", fontSize: 9, textAlign: "center" },
  photoActionsPanel: { gap: 9 },
  photoNote: { color: "#2C2C31", fontSize: 13, lineHeight: 19 },
  photoActionRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoDateEdit: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoDateInput: { flexGrow: 1, minWidth: 120 },
  removeConfirm: { alignItems: "center", borderLeftColor: "#A95B5B", borderLeftWidth: 2, flexDirection: "row", flexWrap: "wrap", gap: 8, paddingLeft: 9 },
  removeConfirmText: { color: "#642D2A", fontSize: 12, fontWeight: "800", width: "100%" },
  selectedSessionRow: { alignItems: "center", borderTopColor: "#D4C9B9", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 55, paddingVertical: 8 },
  selectedSessionName: { color: "#101015", fontSize: 14, fontWeight: "800" },
  selectedSessionMeta: { color: "#655D57", fontSize: 12, marginTop: 3 },
  addProgressAction: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 2 },
  addProgressActionText: { color: "#642D2A", fontSize: 14, fontWeight: "900", textDecorationColor: "#A95B5B", textDecorationLine: "underline" },
  timelineList: { marginTop: 16 },
  timelineDay: { borderTopColor: "#D4C9B9", borderTopWidth: 1, gap: 7, paddingVertical: 17 },
  timelineDate: { color: "#642D2A", fontFamily: "Courier", fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  timelineRow: { color: "#101015", fontSize: 15, fontWeight: "700", lineHeight: 21 },
  photoViewerBackdrop: { alignItems: "center", backgroundColor: "rgba(16, 16, 21, 0.9)", flex: 1, justifyContent: "center", padding: 20 },
  photoViewer: { backgroundColor: "#F4EFE7", gap: 13, maxHeight: "92%", maxWidth: 760, padding: 16, width: "100%" },
  photoViewerImage: { backgroundColor: "#101015", height: 460, width: "100%" },
  photoViewerNote: { color: "#2C2C31", fontSize: 13, lineHeight: 19 },
  progressEdit: { alignItems: "flex-end", gap: 8, width: 132 },
  progressDateInput: {
    borderBottomColor: "#6A7CA0",
    borderBottomWidth: 1,
    color: "#101015",
    fontSize: 13,
    paddingBottom: 5,
    textAlign: "right",
    width: "100%",
  },
  exerciseCard: {
    backgroundColor: "#FBF7F0",
    borderColor: "#D4C9B9",
    borderWidth: 1,
    gap: 7,
    marginTop: 12,
    padding: 16,
  },
  demoForm: { gap: 10, marginTop: 6 },
  demoActions: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 6 },
  mealDayFilters: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  adminUserCard: {
    backgroundColor: "#FBF7F0",
    borderColor: "#D4C9B9",
    borderWidth: 1,
    gap: 12,
    marginTop: 12,
    padding: 16,
  },
  adminActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 20,
    justifyContent: "space-between",
  },
  destructiveAction: {
    color: "#A95B5B",
    fontSize: 13,
    fontWeight: "800",
    textDecorationLine: "underline",
  },
  accessLabel: { marginTop: 4 },
  formCard: {
    backgroundColor: "#FBF7F0",
    borderColor: "#D4C9B9",
    borderWidth: 1,
    gap: 12,
    marginTop: 22,
    padding: 16,
  },
  fastHero: { alignItems: "center", gap: 9, marginTop: 18, maxWidth: 460, paddingBottom: 8 },
  fastElapsed: { color: "#101015", fontSize: 42, fontWeight: "900", letterSpacing: -1.9, lineHeight: 46, marginTop: 2 },
  fastElapsedLabel: { color: "#642D2A", fontFamily: "Courier", fontSize: 11, fontWeight: "800", letterSpacing: 1.8 },
  fastTimestamp: { color: "#655D57", fontSize: 14, marginTop: 2 },
  fastTarget: { alignSelf: "stretch", gap: 5, marginTop: 12 },
  fastTargetTitle: { color: "#101015", fontSize: 16, fontWeight: "800", textAlign: "center" },
  fastTargetMeta: { color: "#655D57", fontSize: 13, textAlign: "center" },
  fastProgressTrack: { backgroundColor: "#D4C9B9", height: 3, marginTop: 8, overflow: "hidden" },
  fastProgressFill: { backgroundColor: "#742F2A", height: "100%" },
  fastProgressLabel: { color: "#642D2A", fontFamily: "Courier", fontSize: 10, fontWeight: "800", letterSpacing: 0.7, textAlign: "center" },
  fastEndButton: { alignSelf: "stretch", marginTop: 14, maxWidth: 360 },
  fastNoteAction: { alignSelf: "center", minHeight: 32, justifyContent: "center" },
  fastNoteEditor: { alignSelf: "stretch", gap: 8, marginTop: 4, maxWidth: 360 },
  fastStart: { gap: 12, marginTop: 22, maxWidth: 520 },
  fastStartTitle: { color: "#101015", fontSize: 25, fontWeight: "900", letterSpacing: -1 },
  fastTargets: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fastTargetOption: { borderColor: "#101015", borderWidth: 1, minHeight: 42, justifyContent: "center", paddingHorizontal: 12 },
  fastTargetOptionActive: { backgroundColor: "#101015" },
  fastTargetOptionText: { color: "#101015", fontSize: 13, fontWeight: "800" },
  fastTargetOptionTextActive: { color: "#F4EFE7" },
  fastHistory: { borderTopColor: "#D4C9B9", borderTopWidth: 1, marginTop: 10 },
  fastHistoryRow: { borderBottomColor: "#D4C9B9", borderBottomWidth: 1, flexDirection: "row", gap: 14, paddingVertical: 14 },
  fastHistoryDate: { color: "#642D2A", fontFamily: "Courier", fontSize: 10, fontWeight: "800", letterSpacing: 1.1, paddingTop: 4, width: 58 },
  fastHistoryCopy: { flex: 1, gap: 3 },
  fastHistoryRemove: { alignSelf: "flex-start", minHeight: 34, justifyContent: "center", paddingLeft: 8 },
  fastHistoryDuration: { color: "#101015", fontSize: 19, fontWeight: "900" },
  fastHistoryMeta: { color: "#655D57", fontSize: 13 },
  fastHistoryNote: { color: "#655D57", fontSize: 13, fontStyle: "italic", marginTop: 2 },
  fastEmptyHistory: { gap: 6, marginTop: 12, paddingVertical: 12 },
  fastEmptyTitle: { color: "#101015", fontSize: 18, fontWeight: "900" },
  planCard: {
    borderColor: "#101015",
    borderWidth: 1,
    marginTop: 16,
    padding: 18,
    backgroundColor: "#FBF7F0",
  },
  activePlanCard: { borderColor: "#642D2A", borderWidth: 2 },
  planSwitcher: {
    alignItems: "flex-start",
    borderBottomColor: "#D4C9B9",
    borderBottomWidth: 1,
    gap: 12,
    marginTop: 18,
    paddingBottom: 12,
  },
  planSwitcherTabs: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  planSwitchItem: { minHeight: 40, justifyContent: "center", paddingHorizontal: 10 },
  planSwitchItemActive: { backgroundColor: "#101015" },
  planSwitchText: { color: "#655D57", fontSize: 13, fontWeight: "800" },
  planSwitchTextActive: { color: "#F4EFE7" },
  planSwitchAdd: { minHeight: 40, justifyContent: "center", paddingHorizontal: 8 },
  planSwitchAddText: { color: "#642D2A", fontSize: 13, fontWeight: "800", textDecorationColor: "#A95B5B", textDecorationLine: "underline" },
  planHeader: {
    borderBottomColor: "#101015",
    borderBottomWidth: 1,
    gap: 20,
    marginTop: 18,
    paddingBottom: 22,
  },
  planHeaderCopy: { flex: 1 },
  planHeaderTitle: { color: "#101015", fontSize: 36, fontWeight: "900", letterSpacing: -1.8, lineHeight: 39 },
  planHeaderMeta: { color: "#642D2A", fontFamily: "Courier", fontSize: 12, fontWeight: "800", letterSpacing: 1, marginTop: 8 },
  planDescription: { color: "#655D57", fontSize: 15, lineHeight: 22, marginTop: 9 },
  planHeaderActions: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 9 },
  planHeaderAction: { height: 46, minHeight: 46, width: 164 },
  planPrimaryAction: { alignItems: "center", backgroundColor: "#101015", justifyContent: "center", minHeight: 46, paddingHorizontal: 16 },
  planPrimaryActionText: { color: "#F4EFE7", fontSize: 14, fontWeight: "800" },
  planSecondaryAction: { alignItems: "center", borderColor: "#101015", borderWidth: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: 13 },
  planSecondaryActionText: { color: "#101015", fontSize: 13, fontWeight: "800" },
  dayNavigator: { alignItems: "center", borderBottomColor: "#D4C9B9", borderBottomWidth: 1, borderTopColor: "#101015", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 16, minHeight: 68 },
  dayNavigatorButton: { alignItems: "center", height: 48, justifyContent: "center", width: 48 },
  dayNavigatorCopy: { alignItems: "center", flex: 1, gap: 3, paddingHorizontal: 10 },
  dayNavigatorLabel: { color: "#642D2A", fontFamily: "Courier", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  dayNavigatorTitle: { color: "#101015", fontSize: 17, fontWeight: "900" },
  planWorkspace: { borderTopColor: "#101015", borderTopWidth: 1, marginTop: 12 },
  planWorkspaceDesktop: { flexDirection: "row" },
  exerciseLedger: { flex: 1, paddingTop: 18 },
  ledgerHeader: { alignItems: "flex-start", flexDirection: "row", gap: 12, justifyContent: "space-between", paddingBottom: 10 },
  ledgerDayName: { fontSize: 23, fontWeight: "900", letterSpacing: -1, minWidth: 180, paddingBottom: 5, paddingTop: 0 },
  ledgerList: { borderTopColor: "#D4C9B9", borderTopWidth: 1 },
  ledgerRow: { alignItems: "center", borderBottomColor: "#D4C9B9", borderBottomWidth: 1, flexDirection: "row", gap: 10, minHeight: 60, paddingHorizontal: 4, paddingVertical: 9 },
  ledgerRowActive: { backgroundColor: "#E8DED2" },
  dragHandle: { color: "#8A817A", fontSize: 18, fontWeight: "800", width: 17 },
  ledgerOrder: { color: "#642D2A", fontFamily: "Courier", fontSize: 11, fontWeight: "800", width: 24 },
  ledgerRowCopy: { flex: 1 },
  ledgerExerciseName: { color: "#101015", fontSize: 16, fontWeight: "800" },
  ledgerExerciseMeta: { color: "#655D57", fontSize: 13, marginTop: 3 },
  ledgerSelect: { color: "#642D2A", fontSize: 24, fontWeight: "400", lineHeight: 24 },
  ledgerEmpty: { borderBottomColor: "#D4C9B9", borderBottomWidth: 1, gap: 7, paddingVertical: 24 },
  ledgerEmptyTitle: { color: "#101015", fontSize: 19, fontWeight: "900" },
  addExerciseAction: { alignSelf: "flex-start", minHeight: 46, justifyContent: "center", marginTop: 12, paddingHorizontal: 2 },
  addExerciseActionText: { color: "#642D2A", fontSize: 15, fontWeight: "900", textDecorationColor: "#A95B5B", textDecorationLine: "underline" },
  exerciseEditor: { backgroundColor: "#FBF7F0", borderLeftColor: "#D4C9B9", borderLeftWidth: 1, flexBasis: 330, gap: 13, padding: 22 },
  editorEmpty: { backgroundColor: "#FBF7F0", borderLeftColor: "#D4C9B9", borderLeftWidth: 1, flexBasis: 330, gap: 8, justifyContent: "center", padding: 22 },
  editorHeading: { alignItems: "flex-start", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  editorCopy: { flex: 1 },
  editorLabel: { color: "#642D2A", fontFamily: "Courier", fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  editorTitle: { color: "#101015", fontSize: 25, fontWeight: "900", letterSpacing: -1, lineHeight: 29, marginTop: 8 },
  editorMeta: { color: "#655D57", fontSize: 13, marginTop: 5 },
  editorClose: { minHeight: 40, justifyContent: "center", paddingHorizontal: 6 },
  editorCloseText: { color: "#642D2A", fontSize: 13, fontWeight: "800", textDecorationColor: "#A95B5B", textDecorationLine: "underline" },
  editorRule: { backgroundColor: "#D4C9B9", height: 1, marginVertical: 3 },
  editorFieldLabel: { color: "#655D57", fontFamily: "Courier", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  editorValue: { color: "#101015", fontSize: 20, fontWeight: "900" },
  editorHint: { color: "#655D57", fontSize: 13, lineHeight: 19 },
  editorActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 5 },
  editorAction: { alignItems: "center", borderColor: "#D4C9B9", borderWidth: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
  editorActionText: { color: "#101015", fontSize: 13, fontWeight: "800" },
  editorRemove: { alignSelf: "flex-start", minHeight: 42, justifyContent: "center", marginTop: 3, paddingHorizontal: 2 },
  editorRemoveText: { color: "#A95B5B", fontSize: 13, fontWeight: "800", textDecorationLine: "underline" },
  planEmptyState: { gap: 12, marginTop: 80, maxWidth: 540 },
  modalBackdrop: { alignItems: "stretch", backgroundColor: "rgba(16, 16, 21, 0.45)", flex: 1, justifyContent: "flex-end" },
  modalPanel: { backgroundColor: "#F4EFE7", borderTopColor: "#101015", borderTopWidth: 1, gap: 14, maxHeight: "88%", padding: 22 },
  modalPanelDesktop: { alignSelf: "center", borderColor: "#101015", borderWidth: 1, maxWidth: 640, width: "92%" },
  mobileEditorSheet: { backgroundColor: "#FBF7F0", borderTopColor: "#101015", borderTopWidth: 1, maxHeight: "80%" },
  modalHeader: { alignItems: "flex-start", flexDirection: "row", gap: 16, justifyContent: "space-between" },
  modalTitle: { color: "#101015", fontSize: 25, fontWeight: "900", letterSpacing: -1, marginTop: 6 },
  modalPlanName: { color: "#655D57", fontSize: 14, marginTop: 5 },
  modalClose: { minHeight: 40, justifyContent: "center", paddingHorizontal: 4 },
  confirmRemovalPanel: { maxWidth: 500 },
  confirmRemovalActions: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "flex-end", marginTop: 4 },
  confirmRemovalAction: { alignItems: "center", backgroundColor: "#A95B5B", justifyContent: "center", minHeight: 42, paddingHorizontal: 16 },
  aiPromptInput: { minHeight: 128, paddingTop: 12 },
  aiDraftScroll: { maxHeight: 480 },
  aiDraft: { gap: 12, paddingBottom: 4 },
  aiDraftTitle: { color: "#101015", fontSize: 21, fontWeight: "900", letterSpacing: -0.7 },
  aiDraftDay: { borderTopColor: "#D4C9B9", borderTopWidth: 1, gap: 5, paddingTop: 12 },
  aiDraftDayTitle: { color: "#642D2A", fontFamily: "Courier", fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  aiDraftExercise: { color: "#2C2C31", fontSize: 14, lineHeight: 20 },
  searchInput: { backgroundColor: "#FBF7F0", borderColor: "#101015", borderWidth: 1, color: "#101015", fontSize: 16, minHeight: 48, paddingHorizontal: 12 },
  exerciseResults: { borderBottomColor: "#D4C9B9", borderBottomWidth: 1, borderTopColor: "#D4C9B9", borderTopWidth: 1, maxHeight: 280 },
  exerciseResult: { alignItems: "center", borderBottomColor: "#D4C9B9", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 58, paddingHorizontal: 4, paddingVertical: 8 },
  exerciseResultActive: { backgroundColor: "#101015", paddingHorizontal: 10 },
  exerciseResultName: { color: "#101015", fontSize: 15, fontWeight: "800" },
  exerciseResultNameActive: { color: "#F4EFE7" },
  exerciseResultMeta: { color: "#655D57", fontSize: 12, marginTop: 3 },
  exerciseResultMetaActive: { color: "#D4C9B9" },
  exerciseResultAdd: { color: "#642D2A", fontSize: 12, fontWeight: "800" },
  addExerciseDetails: { gap: 10 },
  addExerciseSelected: { color: "#101015", fontSize: 16, fontWeight: "900" },
  planHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 14,
    justifyContent: "space-between",
  },
  planTitleArea: { flex: 1 },
  planNameInput: { fontSize: 18, fontWeight: "800", paddingTop: 0 },
  planActions: { alignItems: "flex-end", gap: 8 },
  dayBlock: {
    borderTopColor: "#D4C9B9",
    borderTopWidth: 1,
    marginTop: 14,
    paddingTop: 12,
  },
  attachedExercises: { gap: 8, marginTop: 12 },
  attachedExercise: {
    alignItems: "center",
    backgroundColor: "#F4EFE7",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    padding: 10,
  },
  attachedExerciseText: { flex: 1 },
  attachedExerciseActions: { alignItems: "flex-end", gap: 6 },
  input: {
    borderBottomColor: "#667798",
    borderBottomWidth: 1,
    color: "#101015",
    fontSize: 16,
    paddingBottom: 9,
    paddingTop: 8,
  },
  macroRow: { flexDirection: "row", gap: 10 },
  macroInput: { flex: 1 },
  barcodeRow: { alignItems: "center", flexDirection: "row", gap: 14 },
  barcodeInput: { flex: 1 },
  scanner: { gap: 10 },
  scannerCamera: { height: 280, width: "100%" },
  mealPhotoPreview: { backgroundColor: "#DED4C6", height: 180, width: "100%" },
  mealIngredients: { gap: 8 },
  mealIngredient: {
    alignItems: "center",
    borderBottomColor: "#D4C9B9",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 8,
  },
  exercisePicker: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  exerciseOption: {
    borderColor: "#D4C9B9",
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  exerciseOptionActive: { backgroundColor: "#101015", borderColor: "#101015" },
  exerciseOptionText: { color: "#101015", fontSize: 13, fontWeight: "700" },
  exerciseOptionTextActive: { color: "#F4EFE7" },
  actionButton: {
    alignItems: "center",
    backgroundColor: "#101015",
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 16,
  },
  dashboardAction: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#101015",
    justifyContent: "center",
    marginTop: 24,
    minHeight: 52,
    paddingHorizontal: 18,
  },
  dashboardTitle: {
    color: "#101015",
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: -2.2,
    lineHeight: 44,
    marginTop: 12,
  },
  dashboardPrimary: {
    borderBottomColor: "#D4C9B9",
    borderBottomWidth: 1,
    borderTopColor: "#101015",
    borderTopWidth: 1,
    marginTop: 28,
    paddingVertical: 18,
  },
  dashboardPrimaryLabel: {
    color: "#642D2A",
    fontFamily: "Courier",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.7,
  },
  dashboardPrimaryTitle: {
    color: "#101015",
    fontSize: 27,
    fontWeight: "900",
    letterSpacing: -1.2,
    lineHeight: 31,
    marginTop: 8,
  },
  dashboardPrimaryMeta: { color: "#655D57", fontSize: 15, lineHeight: 22, marginTop: 8 },
  dashboardMovementList: { color: "#2C2C31", fontSize: 14, lineHeight: 21, marginTop: 7 },
  recoveryRecord: { borderBottomColor: "#D4C9B9", borderBottomWidth: 1, borderTopColor: "#101015", borderTopWidth: 1, gap: 18, marginTop: 30, paddingVertical: 18 },
  recoveryRecordDesktop: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 26 },
  recoveryHeading: { gap: 7, width: "100%" },
  recoveryIntro: { color: "#655D57", fontSize: 14, lineHeight: 20 },
  recoveryMap: { flex: 1, minWidth: 260 },
  recoveryDetails: { flex: 1, gap: 0, minWidth: 240 },
  recoverySubhead: { color: "#642D2A", fontFamily: "Courier", fontSize: 10, fontWeight: "800", letterSpacing: 1.25, marginBottom: 5 },
  recoveryRow: { alignItems: "center", borderBottomColor: "#D4C9B9", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
  recoveryGroup: { color: "#101015", fontSize: 16, fontWeight: "800" },
  recoveryEta: { color: "#642D2A", fontFamily: "Courier", fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },
  recoveryReadyLabel: { marginTop: 18 },
  recoveryReady: { color: "#2C2C31", fontSize: 14, fontWeight: "700", lineHeight: 21 },
  recoveryEmpty: { color: "#655D57", fontSize: 14, lineHeight: 21 },
  dashboardSecondary: { gap: 30, marginTop: 30 },
  dashboardSecondaryDesktop: { flexDirection: "row", gap: 36 },
  weeklyRecord: { flex: 1 },
  recentRecord: { flex: 1 },
  sectionLabel: {
    color: "#642D2A",
    fontFamily: "Courier",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.7,
  },
  weeklyGrid: {
    borderBottomColor: "#D4C9B9",
    borderBottomWidth: 1,
    borderTopColor: "#D4C9B9",
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 12,
  },
  weeklyMetric: { paddingBottom: 14, paddingTop: 14, width: "50%" },
  weeklyMetricLeft: { borderRightColor: "#D4C9B9", borderRightWidth: 1, paddingRight: 14 },
  weeklyMetricTop: { borderBottomColor: "#D4C9B9", borderBottomWidth: 1 },
  weeklyMetricValue: { color: "#101015", fontSize: 30, fontWeight: "900", letterSpacing: -1.4 },
  weeklyMetricLabel: { color: "#655D57", fontFamily: "Courier", fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginTop: 3 },
  recentRow: {
    alignItems: "flex-start",
    borderBottomColor: "#D4C9B9",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingVertical: 13,
  },
  recentCopy: { flex: 1 },
  recentTitle: { color: "#101015", fontSize: 15, fontWeight: "800" },
  recentMeta: { color: "#655D57", fontSize: 13, lineHeight: 19, marginTop: 3 },
  recentDate: { color: "#655D57", fontFamily: "Courier", fontSize: 10, fontWeight: "700", letterSpacing: 0.5, paddingTop: 3 },
  moreBackdrop: { backgroundColor: "rgba(16, 16, 21, 0.14)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0, zIndex: 1 },
  moreSheet: {
    backgroundColor: "#F4EFE7",
    borderColor: "#101015",
    borderTopWidth: 1,
    left: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
    position: "absolute",
    right: 0,
    zIndex: 2,
  },
  moreHeading: { color: "#642D2A", fontFamily: "Courier", fontSize: 11, fontWeight: "800", letterSpacing: 1.7, paddingBottom: 5 },
  moreItem: { borderTopColor: "#D4C9B9", borderTopWidth: 1, justifyContent: "center", minHeight: 44 },
  moreItemText: { color: "#101015", fontSize: 15, fontWeight: "700" },
  moreItemTextActive: { color: "#642D2A" },
  moreSignOut: { color: "#642D2A", fontSize: 15, fontWeight: "800", textDecorationLine: "underline", textDecorationColor: "#A95B5B" },
  bottomNav: {
    backgroundColor: "#F4EFE7",
    borderTopColor: "#D4C9B9",
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: "row",
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 3,
  },
  bottomNavItem: { alignItems: "center", flex: 1, justifyContent: "center", minHeight: BOTTOM_NAV_HEIGHT, position: "relative" },
  bottomNavIndicator: { backgroundColor: "#642D2A", height: 2, left: 13, position: "absolute", right: 13, top: 0 },
  bottomNavText: { color: "#655D57", fontSize: 12, fontWeight: "700" },
  bottomNavTextActive: { color: "#101015", fontWeight: "900" },
  actionButtonText: { color: "#F4EFE7", fontSize: 14, fontWeight: "800" },
  sessionDayPicker: { alignItems: "center", borderColor: "#101015", borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 16, minHeight: 70, paddingHorizontal: 14, paddingVertical: 12 },
  sessionDayPickerTitle: { color: "#101015", fontSize: 16, fontWeight: "800" },
  sessionDayPickerMeta: { color: "#655D57", fontSize: 13, marginTop: 3 },
  sessionDayPickerText: { color: "#642D2A", fontSize: 13, fontWeight: "800", textDecorationColor: "#A95B5B", textDecorationLine: "underline" },
  sessionDaySelectorList: { paddingBottom: 2 },
  sessionDayOption: { alignItems: "center", borderTopColor: "#D4C9B9", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 66, paddingVertical: 11 },
  sessionDayOptionTitle: { color: "#101015", fontSize: 16, fontWeight: "800" },
  sessionDayOptionMeta: { color: "#655D57", fontSize: 13, marginTop: 3 },
  sessionActionPanel: { borderColor: "#D4C9B9", borderWidth: 1, gap: 14, marginTop: 22, maxWidth: 680, padding: 16 },
  sessionActionPanelDesktop: { alignSelf: "flex-start", minWidth: 520 },
  activeSessionPanel: { borderColor: "#101015" },
  sessionActionHeader: { alignItems: "flex-start", flexDirection: "row", gap: 14, justifyContent: "space-between" },
  sessionActionCopy: { flex: 1 },
  sessionActionTitle: { color: "#101015", fontSize: 22, fontWeight: "900", letterSpacing: -0.9, lineHeight: 27, marginTop: 8 },
  sessionActionMeta: { color: "#655D57", fontSize: 14, lineHeight: 21, marginTop: 5 },
  sessionContinueButton: { alignItems: "center", backgroundColor: "#101015", justifyContent: "center", minHeight: 52, paddingHorizontal: 16 },
  sessionContinueButtonText: { color: "#F4EFE7", fontSize: 15, fontWeight: "800" },
  sessionDetailsAction: { alignSelf: "flex-start", minHeight: 36, justifyContent: "center" },
  sessionLinkContent: { alignItems: "center", flexDirection: "row", gap: 6 },
  sessionDetailsActionText: { color: "#642D2A", fontSize: 13, fontWeight: "800", textDecorationColor: "#A95B5B", textDecorationLine: "underline" },
  sessionHistory: { borderTopColor: "#D4C9B9", borderTopWidth: 1, marginTop: 12, maxWidth: 760 },
  sessionHistoryRow: { borderBottomColor: "#D4C9B9", borderBottomWidth: 1, gap: 11, paddingVertical: 15 },
  sessionHistoryCopy: { minHeight: 44 },
  sessionHistoryTitle: { color: "#101015", fontSize: 17, fontWeight: "900", letterSpacing: -0.5 },
  sessionHistoryMeta: { color: "#655D57", fontSize: 13, lineHeight: 19, marginTop: 4 },
  sessionHistoryActions: { alignItems: "center", flexDirection: "row", gap: 14, justifyContent: "space-between" },
  sessionViewAction: { minHeight: 44, justifyContent: "center" },
  sessionViewActionText: { color: "#642D2A", fontSize: 13, fontWeight: "800", textDecorationColor: "#A95B5B", textDecorationLine: "underline" },
  sessionOverflowButton: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 44 },
  sessionHistoryEmpty: { borderBottomColor: "#D4C9B9", borderBottomWidth: 1, borderTopColor: "#D4C9B9", borderTopWidth: 1, gap: 6, marginTop: 12, maxWidth: 760, paddingVertical: 20 },
  sessionMenuItem: { borderTopColor: "#D4C9B9", borderTopWidth: 1, justifyContent: "center", minHeight: 52 },
  sessionMenuItemText: { color: "#101015", fontSize: 15, fontWeight: "800" },
  sessionMenuDangerText: { color: "#A95B5B", fontSize: 15, fontWeight: "800" },
  sessionConfirmCopy: { color: "#2C2C31", fontSize: 15, lineHeight: 22 },
  sessionConfirmActions: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "flex-end", marginTop: 4 },
  sessionDangerButton: { alignItems: "center", backgroundColor: "#642D2A", justifyContent: "center", minHeight: 42, paddingHorizontal: 13 },
  sessionDangerButtonText: { color: "#F4EFE7", fontSize: 13, fontWeight: "800" },
  buttonPressed: { backgroundColor: "#642D2A" },
  buttonDisabled: { opacity: 0.55 },
  notice: {
    color: "#642D2A",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
    marginTop: 12,
  },
  inlineActions: { flexDirection: "row", gap: 16, marginTop: 12 },
  inlineAction: {
    color: "#642D2A",
    fontSize: 13,
    fontWeight: "800",
    textDecorationLine: "underline",
    textDecorationColor: "#A95B5B",
  },
  addDayRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    marginTop: 16,
  },
  dayInput: { flex: 1 },
  dayRow: {
    borderTopColor: "#D4C9B9",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
    paddingTop: 12,
  },
  dayNameInput: { flex: 1, fontSize: 16, fontWeight: "700", marginRight: 12, paddingTop: 0 },
  dayName: { color: "#101015", fontSize: 16, fontWeight: "700" },
  dayMeta: { color: "#655D57", fontSize: 14 },
  cardTitle: { color: "#101015", fontSize: 18, fontWeight: "800" },
  cardMeta: { color: "#655D57", fontSize: 14, lineHeight: 21, marginTop: 5 },
  section: { marginTop: 22 },
});
