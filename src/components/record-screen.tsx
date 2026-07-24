import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AlchemySvg } from "./alchemy-svg";
import {
  acceptFriendRequest,
  addExerciseToWorkoutPlanDay,
  addWorkoutPlanDay,
  createAdminUser,
  createExercise,
  createFood,
  createMealLog,
  createWorkoutPlan,
  deleteAdminUser,
  deleteProgressPhoto,
  deleteWorkoutSession,
  getAdminUsers,
  getRecord,
  rejectFriendRequest,
  removeFriend,
  sendFriendRequest,
  setActiveWorkoutPlan,
  signOut,
  startWorkoutSession,
  updateFasting,
  updateWeightUnit,
  uploadProgressPhoto,
  updateAdminUser,
  type AdminUser,
  type TransmuteRecord,
} from "../lib/api";

const ouroboros = require("../../assets/transmute/ouroboros.svg");

const nav = [
  ["dashboard", "Dashboard"],
  ["workout-plans", "Workout plans"],
  ["exercises", "Exercise library"],
  ["sessions", "Sessions"],
  ["nutrition", "Nutrition"],
  ["fasting", "Fasting"],
  ["progress", "Progress"],
  ["friends", "Friend"],
  ["settings", "Settings"],
  ["admin", "Admin"],
] as const;

type Area = (typeof nav)[number][0];

function label(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ") : "Unassigned";
}
function date(value: string) {
  return new Date(value).toLocaleDateString();
}
function Card({ title, meta }: { title: string; meta?: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {meta ? <Text style={styles.cardMeta}>{meta}</Text> : null}
    </View>
  );
}

export function RecordScreen({ area }: { area: Area }) {
  const [record, setRecord] = useState<TransmuteRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const content = record ? (
    <AreaContent area={area} record={record} refresh={refresh} />
  ) : null;
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
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
          <Pressable accessibilityRole="button" onPress={leave}>
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </View>
        <View accessibilityRole="tablist" style={styles.nav}>
          {nav
            .filter(([key]) => key !== "admin" || record?.isAdmin)
            .map(([key, name]) => (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: key === area }}
                key={key}
                onPress={() => router.replace(`/${key}`)}
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
        <ScrollView contentContainerStyle={styles.content}>
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
            content
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function AreaContent({
  area,
  record: r,
  refresh,
}: {
  area: Area;
  record: TransmuteRecord;
  refresh: () => Promise<void>;
}) {
  if (area === "dashboard")
    return (
      <>
        <Text style={styles.eyebrow}>THE WORKBENCH</Text>
        <Text style={styles.title}>Welcome back, {r.user.name}.</Text>
        <Text style={styles.body}>
          {r.dashboard.activeSession
            ? `Active: ${r.dashboard.activeSession.routine_name ?? "workout"} — ${r.dashboard.activeSession.day_name ?? "today"}.`
            : "Your training record is ready for the next input."}
        </Text>
        <View style={styles.grid}>
          <Card title={`${r.workoutPlans.length} plans`} meta="Workout plans" />
          <Card
            title={`${r.sessions.length} sessions`}
            meta="Training record"
          />
          <Card
            title={`${r.nutrition.meals.length} meals`}
            meta="Nutrition log"
          />
          <Card
            title={`${r.progress.length} check-ins`}
            meta="Progress record"
          />
        </View>
      </>
    );
  if (area === "workout-plans")
    return <WorkoutPlansContent record={r} refresh={refresh} />;
  if (area === "exercises")
    return <ExercisesContent record={r} refresh={refresh} />;
  if (area === "sessions")
    return <SessionsContent record={r} refresh={refresh} />;
  if (area === "nutrition")
    return <NutritionContent record={r} refresh={refresh} />;
  if (area === "fasting")
    return <FastingContent record={r} refresh={refresh} />;
  if (area === "progress")
    return <ProgressContent record={r} refresh={refresh} />;
  if (area === "friends")
    return <FriendsContent record={r} refresh={refresh} />;
  if (area === "settings")
    return <SettingsContent record={r} refresh={refresh} />;
  return <AdminContent />;
}

function WorkoutPlansContent({
  record,
  refresh,
}: {
  record: TransmuteRecord;
  refresh: () => Promise<void>;
}) {
  const [planName, setPlanName] = useState("");
  const [description, setDescription] = useState("");
  const [dayNames, setDayNames] = useState<Record<string, string>>({});
  const [exerciseIds, setExerciseIds] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const activePlanId = record.settings.active_routine_id;

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

  return (
    <>
      <Text style={styles.eyebrow}>THE PROGRAM</Text>
      <Text style={styles.title}>Workout plans</Text>
      <Text style={styles.body}>Build the work before you perform it.</Text>
      <View style={styles.formCard}>
        <Text style={styles.cardTitle}>Create a plan</Text>
        <TextInput
          value={planName}
          onChangeText={setPlanName}
          placeholder="Plan name"
          placeholderTextColor="#655D57"
          style={styles.input}
          returnKeyType="next"
        />
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Description (optional)"
          placeholderTextColor="#655D57"
          style={styles.input}
          onSubmitEditing={() =>
            void run(async () => {
              const name = planName.trim();
              if (name.length < 2)
                throw new Error(
                  "Enter a plan name with at least 2 characters.",
                );
              await createWorkoutPlan({
                name,
                description: description.trim() || undefined,
              });
              setPlanName("");
              setDescription("");
            }, "Workout plan created.")
          }
          returnKeyType="done"
        />
        <Pressable
          disabled={saving}
          onPress={() =>
            void run(async () => {
              const name = planName.trim();
              if (name.length < 2)
                throw new Error(
                  "Enter a plan name with at least 2 characters.",
                );
              await createWorkoutPlan({
                name,
                description: description.trim() || undefined,
              });
              setPlanName("");
              setDescription("");
            }, "Workout plan created.")
          }
          style={({ pressed }) => [
            styles.actionButton,
            pressed && styles.buttonPressed,
            saving && styles.buttonDisabled,
          ]}
        >
          <Text style={styles.actionButtonText}>Create plan</Text>
        </Pressable>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {record.workoutPlans.length ? (
        record.workoutPlans.map((plan) => (
          <View
            key={plan.id}
            style={[
              styles.planCard,
              activePlanId === plan.id && styles.activePlanCard,
            ]}
          >
            <View style={styles.planHeading}>
              <View>
                <Text style={styles.cardTitle}>{plan.name}</Text>
                {plan.description ? (
                  <Text style={styles.cardMeta}>{plan.description}</Text>
                ) : null}
              </View>
              <Pressable
                disabled={saving || activePlanId === plan.id}
                onPress={() =>
                  void run(
                    () => setActiveWorkoutPlan(plan.id),
                    "Active workout plan updated.",
                  )
                }
              >
                <Text style={styles.inlineAction}>
                  {activePlanId === plan.id ? "Active" : "Set active"}
                </Text>
              </Pressable>
            </View>
            {plan.days.length ? (
              plan.days
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((day) => (
                  <View key={day.id} style={styles.dayBlock}>
                    <View style={styles.dayRow}>
                      <Text style={styles.dayName}>{day.name}</Text>
                      <Text style={styles.dayMeta}>
                        {day.exerciseCount} exercises
                      </Text>
                    </View>
                    {record.exercises.length ? (
                      <>
                        <View style={styles.exercisePicker}>
                          {record.exercises.map((exercise) => (
                            <Pressable
                              key={exercise.id}
                              onPress={() =>
                                setExerciseIds((current) => ({
                                  ...current,
                                  [day.id]: exercise.id,
                                }))
                              }
                              style={[
                                styles.exerciseOption,
                                exerciseIds[day.id] === exercise.id &&
                                  styles.exerciseOptionActive,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.exerciseOptionText,
                                  exerciseIds[day.id] === exercise.id &&
                                    styles.exerciseOptionTextActive,
                                ]}
                              >
                                {exercise.name}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                        <Pressable
                          disabled={saving || !exerciseIds[day.id]}
                          onPress={() =>
                            void run(async () => {
                              const exerciseId = exerciseIds[day.id];
                              if (!exerciseId)
                                throw new Error("Choose an exercise first.");
                              await addExerciseToWorkoutPlanDay(day.id, {
                                exerciseId,
                              });
                              setExerciseIds((current) => ({
                                ...current,
                                [day.id]: "",
                              }));
                            }, `${day.name} updated.`)
                          }
                        >
                          <Text
                            style={[
                              styles.inlineAction,
                              !exerciseIds[day.id] && styles.buttonDisabled,
                            ]}
                          >
                            Add selected exercise
                          </Text>
                        </Pressable>
                      </>
                    ) : (
                      <Text style={styles.cardMeta}>
                        Create an exercise in Exercise library before attaching
                        it.
                      </Text>
                    )}
                  </View>
                ))
            ) : (
              <Text style={styles.cardMeta}>No days in this plan yet.</Text>
            )}
            <View style={styles.addDayRow}>
              <TextInput
                value={dayNames[plan.id] ?? ""}
                onChangeText={(value) =>
                  setDayNames((current) => ({ ...current, [plan.id]: value }))
                }
                placeholder="New day name"
                placeholderTextColor="#655D57"
                style={[styles.input, styles.dayInput]}
                onSubmitEditing={() =>
                  void run(async () => {
                    const dayName = (dayNames[plan.id] ?? "").trim();
                    if (dayName.length < 2)
                      throw new Error(
                        "Enter a day name with at least 2 characters.",
                      );
                    await addWorkoutPlanDay(plan.id, { dayName });
                    setDayNames((current) => ({ ...current, [plan.id]: "" }));
                  }, "Workout day added.")
                }
                returnKeyType="done"
              />
              <Pressable
                disabled={saving}
                onPress={() =>
                  void run(async () => {
                    const dayName = (dayNames[plan.id] ?? "").trim();
                    if (dayName.length < 2)
                      throw new Error(
                        "Enter a day name with at least 2 characters.",
                      );
                    await addWorkoutPlanDay(plan.id, { dayName });
                    setDayNames((current) => ({ ...current, [plan.id]: "" }));
                  }, "Workout day added.")
                }
              >
                <Text style={styles.inlineAction}>Add day</Text>
              </Pressable>
            </View>
          </View>
        ))
      ) : (
        <Card
          title="No workout plans yet"
          meta="Your first plan will appear here."
        />
      )}
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
          <Card
            key={exercise.id}
            title={exercise.name}
            meta={`${label(exercise.category)}${exercise.muscle_group ? ` · ${exercise.muscle_group}` : ""}`}
          />
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
}: {
  record: TransmuteRecord;
  refresh: () => Promise<void>;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const activePlan =
    record.workoutPlans.find(
      (plan) => plan.id === record.settings.active_routine_id,
    ) ?? null;

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

  const remove = async (sessionId: string) => {
    setSaving(true);
    setNotice(null);
    try {
      await deleteWorkoutSession(sessionId);
      await refresh();
      setNotice("Session removed.");
    } catch (reason) {
      setNotice(
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
        Choose an active plan, open a session, and let each set become part of
        the record.
      </Text>
      <View style={styles.formCard}>
        <Text style={styles.cardTitle}>Start a session</Text>
        {!activePlan ? (
          <Text style={styles.cardMeta}>
            Choose an active workout plan in Workout plans first.
          </Text>
        ) : activePlan.days.length === 0 ? (
          <Text style={styles.cardMeta}>This plan has no days yet.</Text>
        ) : (
          activePlan.days
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((day) => (
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                key={day.id}
                onPress={() => void start(day.id)}
                style={({ pressed }) => [
                  styles.dayAction,
                  pressed && styles.buttonPressed,
                  saving && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.dayActionText}>{day.name}</Text>
                <Text style={styles.dayActionMeta}>
                  {day.exerciseCount} exercises · Start
                </Text>
              </Pressable>
            ))
        )}
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Text style={[styles.eyebrow, styles.section]}>RECENT SESSIONS</Text>
      {record.sessions.length ? (
        record.sessions.map((session) => (
          <View key={session.id} style={styles.card}>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push(`/sessions/${session.id}`)}
            >
              <Text style={styles.cardTitle}>
                {session.routine_name ?? "Workout plan"} ·{" "}
                {session.day_name ?? "Day"}
              </Text>
              <Text style={styles.cardMeta}>
                {label(session.status)} · {session.set_count} sets ·{" "}
                {date(session.started_at)}
              </Text>
            </Pressable>
            <Pressable
              disabled={saving}
              onPress={() => void remove(session.id)}
            >
              <Text style={styles.inlineAction}>Remove</Text>
            </Pressable>
          </View>
        ))
      ) : (
        <Card
          title="No sessions yet"
          meta="Start a day from your active workout plan."
        />
      )}
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
}: {
  record: TransmuteRecord;
  refresh: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const choosePhoto = async () => {
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
        capturedAt: new Date().toISOString(),
        note,
      });
      setNote("");
      await refresh();
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

  return (
    <>
      <Text style={styles.eyebrow}>THE EVIDENCE</Text>
      <Text style={styles.title}>Progress</Text>
      <Text style={styles.body}>
        Keep a visual record of the work and the changes it creates.
      </Text>
      <View style={styles.formCard}>
        <Text style={styles.cardTitle}>Add a check-in</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Note (optional)"
          placeholderTextColor="#655D57"
          style={styles.input}
          returnKeyType="done"
          onSubmitEditing={() => void choosePhoto()}
        />
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={() => void choosePhoto()}
          style={[styles.actionButton, saving && styles.buttonDisabled]}
        >
          <Text style={styles.actionButtonText}>
            {saving ? "Recording…" : "Choose progress photo"}
          </Text>
        </Pressable>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Text style={[styles.eyebrow, styles.section]}>YOUR CHECK-INS</Text>
      {record.progress.length ? (
        record.progress.map((photo) => (
          <View key={photo.id} style={styles.progressCard}>
            {photo.imageUrl ? (
              <Image
                accessibilityLabel={`Progress photo from ${date(photo.captured_at)}`}
                source={{ uri: photo.imageUrl }}
                style={styles.progressImage}
              />
            ) : (
              <View style={styles.progressImageUnavailable}>
                <Text style={styles.cardMeta}>Photo preview unavailable.</Text>
              </View>
            )}
            <View style={styles.progressDetails}>
              <View>
                <Text style={styles.cardTitle}>{date(photo.captured_at)}</Text>
                <Text style={styles.cardMeta}>
                  {photo.note ?? "Progress photo"}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => void remove(photo.id)}
              >
                <Text style={styles.inlineAction}>Remove</Text>
              </Pressable>
            </View>
          </View>
        ))
      ) : (
        <Card
          title="No progress photos yet"
          meta="Add your first check-in to begin a visual record."
        />
      )}
    </>
  );
}

function NutritionContent({
  record,
  refresh,
}: {
  record: TransmuteRecord;
  refresh: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [foodId, setFoodId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [mealType, setMealType] = useState<
    "breakfast" | "lunch" | "dinner" | "snack"
  >("snack");
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
        reason instanceof Error ? reason.message : "Unable to save nutrition.",
      );
    } finally {
      setSaving(false);
    }
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
              if (
                name.trim().length < 2 ||
                !Number.isInteger(caloriesKcal) ||
                caloriesKcal < 0
              )
                throw new Error("Enter a food name and whole calories.");
              await createFood({
                name: name.trim(),
                caloriesKcal,
                proteinG: protein.trim() ? Number(protein) : undefined,
                carbsG: carbs.trim() ? Number(carbs) : undefined,
                fatG: fat.trim() ? Number(fat) : undefined,
              });
              setName("");
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
          placeholder="Servings"
          placeholderTextColor="#655D57"
          style={styles.input}
        />
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
        <Pressable
          disabled={saving || !foodId}
          onPress={() =>
            void run(async () => {
              const parsedQuantity = Number(quantity);
              if (
                !foodId ||
                !Number.isFinite(parsedQuantity) ||
                parsedQuantity <= 0
              )
                throw new Error("Choose a food and enter a valid quantity.");
              await createMealLog({
                foodId,
                quantity: parsedQuantity,
                mealType,
              });
              setQuantity("1");
            }, "Meal logged.")
          }
          style={[
            styles.actionButton,
            (saving || !foodId) && styles.buttonDisabled,
          ]}
        >
          <Text style={styles.actionButtonText}>Log meal</Text>
        </Pressable>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Text style={[styles.eyebrow, styles.section]}>RECENT MEALS</Text>
      {record.nutrition.meals.length ? (
        record.nutrition.meals.map((meal) => (
          <Card
            key={meal.id}
            title={meal.name}
            meta={`${label(meal.meal_type)} · ${meal.calories_kcal} kcal · ${date(meal.consumed_at)}`}
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

function FastingContent({
  record,
  refresh,
}: {
  record: TransmuteRecord;
  refresh: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toggle = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await updateFasting({
        action: record.fasting.active ? "end" : "start",
        note: note.trim() || undefined,
      });
      setNote("");
      await refresh();
      setNotice(
        record.fasting.active ? "Fast ended and saved." : "Fast started.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Unable to update the fast.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Text style={styles.eyebrow}>THE INTERVAL</Text>
      <Text style={styles.title}>Fasting</Text>
      <Text style={styles.body}>
        {record.fasting.active
          ? `Active since ${date(record.fasting.active.started_at)}.`
          : "No active fast."}
      </Text>
      <View style={styles.formCard}>
        <Text style={styles.cardTitle}>
          {record.fasting.active ? "End active fast" : "Start a fast"}
        </Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Note (optional)"
          placeholderTextColor="#655D57"
          style={styles.input}
          onSubmitEditing={() => void toggle()}
          returnKeyType="done"
        />
        <Pressable
          disabled={saving}
          onPress={() => void toggle()}
          style={[styles.actionButton, saving && styles.buttonDisabled]}
        >
          <Text style={styles.actionButtonText}>
            {record.fasting.active ? "End fast" : "Start fast"}
          </Text>
        </Pressable>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Text style={[styles.eyebrow, styles.section]}>FAST HISTORY</Text>
      {record.fasting.logs.length ? (
        record.fasting.logs.map((fast) => (
          <Card
            key={fast.id}
            title={`${fast.duration_minutes} minutes`}
            meta={`${date(fast.ended_at)}${fast.note ? ` · ${fast.note}` : ""}`}
          />
        ))
      ) : (
        <Card
          title="No fasting history"
          meta="Completed fasts will appear here."
        />
      )}
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
  content: { paddingBottom: 56, maxWidth: 760 },
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
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 22 },
  card: {
    borderColor: "#D4C9B9",
    borderRadius: 12,
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
  planCard: {
    borderColor: "#101015",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 16,
    padding: 18,
    backgroundColor: "#FBF7F0",
  },
  activePlanCard: { borderColor: "#642D2A", borderWidth: 2 },
  planHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 14,
    justifyContent: "space-between",
  },
  dayBlock: {
    borderTopColor: "#D4C9B9",
    borderTopWidth: 1,
    marginTop: 14,
    paddingTop: 12,
  },
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
  actionButtonText: { color: "#F4EFE7", fontSize: 14, fontWeight: "800" },
  dayAction: { borderColor: "#D4C9B9", borderTopWidth: 1, paddingVertical: 12 },
  dayActionText: { color: "#101015", fontSize: 16, fontWeight: "800" },
  dayActionMeta: { color: "#655D57", fontSize: 13, marginTop: 3 },
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
  dayName: { color: "#101015", fontSize: 16, fontWeight: "700" },
  dayMeta: { color: "#655D57", fontSize: 14 },
  cardTitle: { color: "#101015", fontSize: 18, fontWeight: "800" },
  cardMeta: { color: "#655D57", fontSize: 14, lineHeight: 21, marginTop: 5 },
  section: { marginTop: 22 },
});
