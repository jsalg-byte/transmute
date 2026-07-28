import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { Camera, ChevronDown, ChevronRight, ImagePlus, Pencil, Plus, Search, Trash2, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  Image,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  createFood,
  createMealLog,
  deleteMealLog,
  lookupBarcode,
  parseNutritionLabel,
  servingSizeUnits,
  updateMealLog,
  uploadMealPhoto,
  type ServingSizeUnit,
  type TransmuteRecord,
} from "../lib/api";
import { useTransmuteStyles, useTransmuteTheme } from "../theme/transmute-theme";

type Food = TransmuteRecord["nutrition"]["foods"][number];
type MealLog = TransmuteRecord["nutrition"]["meals"][number];
type MealType = "breakfast" | "lunch" | "dinner" | "snack";
type NutritionView = "today" | "foods" | "history";
type SelectedFood = { foodId: string; grams: string };
type ServingData = Pick<Food, "serving_size_g" | "serving_size_unit" | "serving_size_text">;

type MealGroup = {
  key: string;
  consumedAt: string;
  mealType: string;
  items: MealLog[];
};

const mealTypes: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

function dayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: number) {
  return Math.round(value * 10) / 10;
}

function servingUnit(food: ServingData) {
  const unit = food.serving_size_unit as ServingSizeUnit | null;
  return unit && servingSizeUnits.includes(unit) ? unit : "g";
}

function servingValue(food: ServingData) {
  return numeric(food.serving_size_g) || 100;
}

function servingLabel(food: ServingData) {
  return food.serving_size_text?.trim() || `${formatNumber(servingValue(food))} ${servingUnit(food)}`;
}

function foodTotals(food: Food, grams: number) {
  const servingAmount = servingValue(food);
  const multiplier = grams / servingAmount;
  return {
    calories: Math.round(numeric(food.calories_kcal) * multiplier),
    protein: formatNumber(numeric(food.protein_g) * multiplier),
    carbs: formatNumber(numeric(food.carbs_g) * multiplier),
    fat: formatNumber(numeric(food.fat_g) * multiplier),
  };
}

function mealTotals(meal: MealGroup) {
  return meal.items.reduce(
    (totals, item) => {
      const grams = numeric(item.quantity);
      const servingAmount = servingValue(item);
      const multiplier = grams / servingAmount;
      return {
        calories: totals.calories + numeric(item.calories_kcal),
        protein: totals.protein + numeric(item.protein_g) * multiplier,
        carbs: totals.carbs + numeric(item.carbs_g) * multiplier,
        fat: totals.fat + numeric(item.fat_g) * multiplier,
      };
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function titleCase(value: string) {
  return value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` : "Meal";
}

function asMealType(value: string): MealType {
  return mealTypes.includes(value as MealType) ? value as MealType : "snack";
}

function formatDay(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function NutritionContent({
  record,
  refresh,
  focusMealId,
}: {
  record: TransmuteRecord;
  refresh: () => Promise<void>;
  focusMealId?: string;
}) {
  const styles = useTransmuteStyles(baseStyles);
  const { palette } = useTransmuteTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;
  const [view, setView] = useState<NutritionView>("today");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [newFoodOpen, setNewFoodOpen] = useState(false);
  const [newFoodForMeal, setNewFoodForMeal] = useState(false);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [foodQuery, setFoodQuery] = useState("");
  const [foodLimit, setFoodLimit] = useState(8);
  const [foodPickerOpen, setFoodPickerOpen] = useState(false);
  const [historyRange, setHistoryRange] = useState<"7" | "30" | "custom">("7");
  const [customHistoryStart, setCustomHistoryStart] = useState("");
  const [historyDayLimit, setHistoryDayLimit] = useState(7);
  const [selectedFoods, setSelectedFoods] = useState<SelectedFood[]>([]);
  const [mealType, setMealType] = useState<MealType>("snack");
  const [consumedAt, setConsumedAt] = useState("");
  const [mealPhoto, setMealPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [editingMeal, setEditingMeal] = useState<MealLog | null>(null);
  const [mealPendingDeletion, setMealPendingDeletion] = useState<MealLog | null>(null);
  const [editMealType, setEditMealType] = useState<MealType>("snack");
  const [editMealGrams, setEditMealGrams] = useState("");
  const [editConsumedAt, setEditConsumedAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [servingSizeG, setServingSizeG] = useState("");
  const [servingSizeUnit, setServingSizeUnit] = useState<ServingSizeUnit>("g");
  const [servingSizeText, setServingSizeText] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerReady, setScannerReady] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [focusedMealDismissed, setFocusedMealDismissed] = useState(false);

  const foodsById = useMemo(() => new Map(record.nutrition.foods.map((food) => [food.id, food])), [record.nutrition.foods]);
  const groups = useMemo(() => {
    const byKey = new Map<string, MealGroup>();
    for (const item of record.nutrition.meals) {
      // POST /v1/meals writes every selected ingredient with the same consumed_at value.
      const key = `${item.consumed_at}-${item.meal_type}`;
      const group = byKey.get(key) ?? { key, consumedAt: item.consumed_at, mealType: item.meal_type, items: [] };
      group.items.push(item);
      byKey.set(key, group);
    }
    return [...byKey.values()].sort((left, right) => new Date(right.consumedAt).getTime() - new Date(left.consumedAt).getTime());
  }, [record.nutrition.meals]);
  const focusedMealGroup = !focusedMealDismissed && focusMealId
    ? groups.find((candidate) => candidate.items.some((item) => item.id === focusMealId)) ?? null
    : null;
  const displayedView = focusedMealGroup ? "history" : view;
  const displayedHistoryRange = focusedMealGroup ? "custom" : historyRange;
  const displayedCustomHistoryStart = focusedMealGroup ? dayKey(focusedMealGroup.consumedAt) : customHistoryStart;
  const today = dayKey(new Date().toISOString());
  const todayMeals = useMemo(() => groups.filter((meal) => dayKey(meal.consumedAt) === today), [groups, today]);
  const todayTotals = useMemo(() => todayMeals.reduce((totals, meal) => {
    const mealTotal = mealTotals(meal);
    return {
      calories: totals.calories + mealTotal.calories,
      protein: totals.protein + mealTotal.protein,
      carbs: totals.carbs + mealTotal.carbs,
      fat: totals.fat + mealTotal.fat,
    };
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 }), [todayMeals]);
  const visibleFoods = useMemo(() => {
    const query = foodQuery.trim().toLowerCase();
    const matches = query ? record.nutrition.foods.filter((food) => food.name.toLowerCase().includes(query)) : record.nutrition.foods;
    return matches.slice(0, query ? 30 : foodLimit);
  }, [foodLimit, foodQuery, record.nutrition.foods]);
  const matchingSavedFoods = useMemo(() => {
    const query = foodQuery.trim().toLowerCase();
    return query ? record.nutrition.foods.filter((food) => food.name.toLowerCase().includes(query)) : record.nutrition.foods;
  }, [foodQuery, record.nutrition.foods]);
  const historyMeals = useMemo(() => {
    if (displayedHistoryRange === "custom") {
      return /^\d{4}-\d{2}-\d{2}$/.test(displayedCustomHistoryStart)
        ? groups.filter((meal) => dayKey(meal.consumedAt) >= displayedCustomHistoryStart)
        : groups;
    }
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (Number(displayedHistoryRange) - 1));
    return groups.filter((meal) => new Date(meal.consumedAt) >= start);
  }, [displayedCustomHistoryStart, displayedHistoryRange, groups]);
  const historyByDay = useMemo(() => {
    const grouped = new Map<string, MealGroup[]>();
    for (const meal of historyMeals) {
      const key = dayKey(meal.consumedAt);
      grouped.set(key, [...(grouped.get(key) ?? []), meal]);
    }
    return [...grouped.entries()];
  }, [historyMeals]);
  const selectedSummaries = useMemo(() => selectedFoods.map((item) => {
    const food = foodsById.get(item.foodId);
    const grams = numeric(item.grams);
    return { ...item, food, grams, totals: food && grams > 0 ? foodTotals(food, grams) : null };
  }), [foodsById, selectedFoods]);
  const selectedTotals = useMemo(() => selectedSummaries.reduce((totals, item) => ({
    calories: totals.calories + (item.totals?.calories ?? 0),
    protein: totals.protein + (item.totals?.protein ?? 0),
    carbs: totals.carbs + (item.totals?.carbs ?? 0),
    fat: totals.fat + (item.totals?.fat ?? 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 }), [selectedSummaries]);

  const resetFoodForm = () => {
    setName("");
    setBarcode("");
    setServingSizeG("");
    setServingSizeUnit("g");
    setServingSizeText("");
    setCalories("");
    setProtein("");
    setCarbs("");
    setFat("");
    setScannerOpen(false);
    setScannerReady(false);
  };
  const selectedMealConsumedAt = () => {
    if (!consumedAt.trim()) return undefined;
    const parsed = new Date(consumedAt);
    if (Number.isNaN(parsed.getTime())) throw new Error("Use a valid date and time for the meal.");
    return parsed.toISOString();
  };
  const closeNewFood = () => {
    setNewFoodOpen(false);
    setNewFoodForMeal(false);
  };
  const openBuilder = (foodId?: string) => {
    setNotice(null);
    setFoodQuery("");
    setFoodPickerOpen(false);
    if (foodId) addFood(foodId);
    setBuilderOpen(true);
  };
  const addFood = (foodId: string, grams?: number) => {
    if (selectedFoods.some((item) => item.foodId === foodId)) {
      setNotice("That food is already in this meal. Adjust its amount below.");
      return;
    }
    if (selectedFoods.length >= 20) {
      setNotice("A meal can contain up to 20 ingredients.");
      return;
    }
    const food = foodsById.get(foodId);
    setSelectedFoods((items) => [...items, { foodId, grams: grams !== undefined ? String(grams) : food ? String(servingValue(food)) : "" }]);
    setNotice(null);
  };
  const lookupFoodBarcode = async (candidate = barcode) => {
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
      if (food.id) {
        setNewFoodOpen(false);
        openBuilder(food.id);
        setNotice("Saved food added to the meal builder.");
        return;
      }
      setName(food.name);
      setBarcode(food.barcodeUpc ?? code);
      setServingSizeG(food.servingSizeValue ? String(food.servingSizeValue) : "");
      setServingSizeUnit(food.servingSizeUnit ?? "g");
      setServingSizeText(food.servingSizeText ?? "");
      setCalories(String(food.caloriesKcal));
      setProtein(String(food.proteinG));
      setCarbs(String(food.carbsG));
      setFat(String(food.fatG));
      setNotice("Barcode nutrition loaded. Review the values before saving.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to look up that barcode.");
    } finally {
      setSaving(false);
    }
  };
  const openBarcodeScanner = async () => {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        setNotice("Camera permission is needed to scan a barcode.");
        return;
      }
    }
    setScannerReady(false);
    setScannerOpen(true);
  };
  const readNutritionLabel = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const pickerResult = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.7, selectionLimit: 1 });
      if (pickerResult.canceled) return;
      const image = pickerResult.assets[0];
      if (!image?.base64) throw new Error("Choose a readable nutrition-label photo.");
      const labelResponse = await parseNutritionLabel(image.base64);
      const parsed = labelResponse.parsed;
      if (parsed.name) setName(parsed.name);
      if (parsed.servingSizeValue) setServingSizeG(String(parsed.servingSizeValue));
      if (parsed.servingSizeUnit) setServingSizeUnit(parsed.servingSizeUnit);
      if (parsed.servingSizeText) setServingSizeText(parsed.servingSizeText);
      if (parsed.caloriesKcal !== null) setCalories(String(parsed.caloriesKcal));
      if (parsed.proteinG !== null) setProtein(String(parsed.proteinG));
      if (parsed.carbsG !== null) setCarbs(String(parsed.carbsG));
      if (parsed.fatG !== null) setFat(String(parsed.fatG));
      setNotice(`${labelResponse.source === 'ai' ? 'AI' : 'OCR fallback'} read the label at ${Math.round(parsed.parseConfidence * 100)}% confidence. Review the values before saving.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to read that nutrition label.");
    } finally {
      setSaving(false);
    }
  };
  const saveFood = async () => {
    const caloriesKcal = Number(calories);
    const referenceGrams = Number(servingSizeG);
    if (name.trim().length < 2 || !Number.isInteger(caloriesKcal) || caloriesKcal < 0 || !Number.isFinite(referenceGrams) || referenceGrams <= 0) {
      setNotice("Enter a food name, whole calories, and a reference serving amount.");
      return;
    }
    let consumedAtIso: string | undefined;
    try {
      consumedAtIso = newFoodForMeal ? selectedMealConsumedAt() : undefined;
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Use a valid date and time for the meal.");
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const created = await createFood({
        name: name.trim(),
        caloriesKcal,
        proteinG: protein.trim() ? Number(protein) : undefined,
        carbsG: carbs.trim() ? Number(carbs) : undefined,
        fatG: fat.trim() ? Number(fat) : undefined,
        servingSizeValue: referenceGrams,
        servingSizeUnit,
        servingSizeText: servingSizeText.trim() || `${referenceGrams} ${servingSizeUnit}`,
        barcodeUpc: barcode.trim() || undefined,
      });
      if (newFoodForMeal) {
        const existingItems = selectedSummaries.map((item) => ({ foodId: item.foodId, grams: item.grams }));
        const items = [...existingItems, { foodId: created.food.id, grams: referenceGrams }];
        if (items.some((item) => !Number.isFinite(item.grams) || item.grams <= 0)) {
          setSelectedFoods((current) => [...current, { foodId: created.food.id, grams: String(referenceGrams) }]);
          setNewFoodOpen(false);
          setBuilderOpen(true);
          setNotice("Food saved and added to this meal. Enter valid amounts before logging it.");
          return;
        }
        const { meals } = await createMealLog({ mealType, consumedAt: consumedAtIso, items });
        const firstMeal = meals[0];
        if (!firstMeal) throw new Error("The meal could not be created.");
        if (mealPhoto) {
          await uploadMealPhoto(firstMeal.id, {
            uri: mealPhoto.uri,
            fileName: mealPhoto.fileName ?? `meal-${Date.now()}.jpg`,
            mimeType: mealPhoto.mimeType ?? "image/jpeg",
            sizeBytes: mealPhoto.fileSize,
          });
        }
        setSelectedFoods([]);
        setMealPhoto(null);
        setConsumedAt("");
        setBuilderOpen(false);
        setView("today");
        setNewFoodForMeal(false);
        resetFoodForm();
        setNewFoodOpen(false);
        await refresh();
        setNotice("Food added and meal logged.");
        return;
      }
      resetFoodForm();
      setNewFoodOpen(false);
      setNewFoodForMeal(false);
      setView("foods");
      await refresh();
      setNotice("Food added to your library.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to save food.");
    } finally {
      setSaving(false);
    }
  };
  const chooseMealPhoto = async () => {
    setNotice(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, selectionLimit: 1 });
      if (!result.canceled && result.assets[0]) setMealPhoto(result.assets[0]);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to choose a meal photo.");
    }
  };
  const saveMeal = async () => {
    const items = selectedSummaries.map((item) => ({ foodId: item.foodId, grams: item.grams }));
    if (!items.length || items.some((item) => !Number.isFinite(item.grams) || item.grams <= 0)) {
      setNotice("Add at least one food with a valid amount.");
      return;
    }
    let consumedAtIso: string | undefined;
    if (consumedAt.trim()) {
      const parsed = new Date(consumedAt);
      if (Number.isNaN(parsed.getTime())) {
        setNotice("Use a valid date and time for the meal.");
        return;
      }
      consumedAtIso = parsed.toISOString();
    }
    setSaving(true);
    setNotice(null);
    try {
      const { meals } = await createMealLog({ mealType, consumedAt: consumedAtIso, items });
      const firstMeal = meals[0];
      if (!firstMeal) throw new Error("The meal could not be created.");
      if (mealPhoto) {
        try {
          await uploadMealPhoto(firstMeal.id, {
            uri: mealPhoto.uri,
            fileName: mealPhoto.fileName ?? `meal-${Date.now()}.jpg`,
            mimeType: mealPhoto.mimeType ?? "image/jpeg",
            sizeBytes: mealPhoto.fileSize,
          });
        } catch (reason) {
          await refresh();
          throw new Error(`Meal logged, but photo failed: ${reason instanceof Error ? reason.message : "Unable to upload the meal photo."}`);
        }
      }
      setSelectedFoods([]);
      setMealPhoto(null);
      setConsumedAt("");
      setBuilderOpen(false);
      await refresh();
      setNotice(mealPhoto ? "Meal and photo logged." : "Meal logged.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to save meal.");
    } finally {
      setSaving(false);
    }
  };

  const openMealEditor = (meal: MealLog) => {
    const consumedAt = new Date(meal.consumed_at);
    setNotice(null);
    setEditingMeal(meal);
    setEditMealType(asMealType(meal.meal_type));
    setEditMealGrams(String(formatNumber(numeric(meal.quantity))));
    setEditConsumedAt(Number.isNaN(consumedAt.getTime()) ? new Date().toISOString() : consumedAt.toISOString());
  };

  const closeMealEditor = () => {
    if (saving) return;
    setEditingMeal(null);
  };

  const saveMealEdit = async () => {
    if (!editingMeal) return;
    const grams = Number(editMealGrams);
    const consumedAt = new Date(editConsumedAt);
    if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) {
      setNotice("Enter an amount between 0 and 5,000 reference units.");
      return;
    }
    if (Number.isNaN(consumedAt.getTime())) {
      setNotice("Use a valid date and time for the logged food.");
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      await updateMealLog(editingMeal.id, { mealType: editMealType, grams, consumedAt: consumedAt.toISOString() });
      setEditingMeal(null);
      await refresh();
      setNotice("Logged food updated.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to update the logged food.");
    } finally {
      setSaving(false);
    }
  };

  const requestMealDeletion = (meal: MealLog) => {
    if (!saving) setMealPendingDeletion(meal);
  };

  const confirmMealDeletion = async () => {
    const meal = mealPendingDeletion;
    if (!meal || saving) return;

    setSaving(true);
    setNotice(null);
    try {
      await deleteMealLog(meal.id);
      if (editingMeal?.id === meal.id) setEditingMeal(null);
      setMealPendingDeletion(null);
      await refresh();
      setNotice("Logged food deleted.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to delete the logged food.");
    } finally {
      setSaving(false);
    }
  };

  const renderMealRow = (meal: MealGroup) => {
    const totals = mealTotals(meal);
    const detailOpen = focusedMealGroup?.key === meal.key || detailKey === meal.key;
    const summary = meal.items.slice(0, 2).map((item) => item.name).join(" · ");
    const remaining = meal.items.length - 2;
    return <View key={meal.key} style={styles.mealRow}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailOpen }} onPress={() => { setFocusedMealDismissed(true); setDetailKey((key) => key === meal.key ? null : meal.key); }} style={styles.mealRowPressable}>
        <View style={styles.mealRowCopy}>
          <Text style={styles.mealType}>{titleCase(meal.mealType)}</Text>
          <Text numberOfLines={1} style={styles.mealSummary}>{summary}{remaining > 0 ? ` · +${remaining} more` : ""}</Text>
        </View>
        <View style={styles.mealRowValue}>
          <Text style={styles.mealCalories}>{totals.calories.toLocaleString()} kcal</Text>
          <Text style={styles.mealTime}>{formatTime(meal.consumedAt)}</Text>
        </View>
        <ChevronRight color={palette.oxide} size={18} strokeWidth={2.3} style={detailOpen ? styles.chevronOpen : undefined} />
      </Pressable>
      {detailOpen ? <View style={styles.mealDetail}>
        {meal.items.map((item) => {
          const servingAmount = servingValue(item);
          const multiplier = numeric(item.quantity) / servingAmount;
          return <View key={item.id} style={styles.detailItem}>
            <View style={styles.detailItemCopy}><Text style={styles.detailItemName}>{item.name}</Text><Text style={styles.detailItemMeta}>{formatNumber(numeric(item.quantity))} {servingUnit(item)} · {item.calories_kcal} kcal</Text><Text style={styles.detailItemMacro}>Protein (g) {formatNumber(numeric(item.protein_g) * multiplier)} · Carbs (g) {formatNumber(numeric(item.carbs_g) * multiplier)} · Fat (g) {formatNumber(numeric(item.fat_g) * multiplier)}</Text></View>
            <View style={styles.detailItemActions}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`} disabled={saving} onPress={() => openMealEditor(item)} hitSlop={9} style={styles.detailIconButton}><Pencil color={palette.oxide} size={17} strokeWidth={2.3} /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${item.name}`} disabled={saving} onPress={() => requestMealDeletion(item)} hitSlop={9} style={styles.detailIconButton}><Trash2 color={palette.destructive} size={17} strokeWidth={2.3} /></Pressable>
            </View>
          </View>;
        })}
        {meal.items.find((item) => item.imageUrl)?.imageUrl ? <Image accessibilityLabel={`${titleCase(meal.mealType)} meal photo`} source={{ uri: meal.items.find((item) => item.imageUrl)?.imageUrl ?? undefined }} style={styles.mealImage} /> : null}
      </View> : null}
    </View>;
  };

  return <>
    <Text style={styles.eyebrow}>THE FUEL</Text>
    <Text style={styles.title}>Nutrition</Text>
    <View accessibilityRole="tablist" style={styles.tabs}>
      {(["today", "foods", "history"] as NutritionView[]).map((item) => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: displayedView === item }} onPress={() => { setFocusedMealDismissed(true); setView(item); }} style={[styles.tab, displayedView === item && styles.tabActive]}><Text style={[styles.tabText, displayedView === item && styles.tabTextActive]}>{item}</Text></Pressable>)}
    </View>

    {displayedView === "today" ? <View style={styles.todayLayout}>
      <View style={[styles.todayTop, isDesktop && styles.todayTopDesktop]}>
      <View style={styles.todaySummary}>
        <Text style={styles.sectionLabel}>TODAY</Text>
        {todayMeals.length ? <><Text style={styles.dailyCalories}>{todayTotals.calories.toLocaleString()} kcal</Text>{todayTotals.protein || todayTotals.carbs || todayTotals.fat ? <Text style={styles.dailyMacros}>{formatNumber(todayTotals.protein)}g protein · {formatNumber(todayTotals.carbs)}g carbs · {formatNumber(todayTotals.fat)}g fat</Text> : null}</> : <Text style={styles.emptyHeadline}>No meals recorded yet.</Text>}
      </View>
      <View style={[styles.todayAside, isDesktop && styles.todayAsideDesktop]}><Text style={styles.sectionLabel}>TODAY’S RECORD</Text><Text style={styles.asideText}>Log while it is fresh. Each ingredient stays available for review.</Text></View>
      </View>
      <Pressable accessibilityRole="button" onPress={() => openBuilder()} style={[styles.primaryAction, styles.todayLogAction]}><Text style={styles.primaryActionText}>Log a meal</Text></Pressable>
      <View style={styles.mealList}><Text style={styles.sectionLabel}>MEALS</Text>{todayMeals.length ? <View style={styles.ledger}>{todayMeals.map(renderMealRow)}</View> : <View style={styles.emptyState}><Text style={styles.emptyText}>Start with one meal. Your daily totals will appear here when food data supports them.</Text></View>}</View>
    </View> : null}

    {displayedView === "foods" ? <View style={[styles.focusedView, isDesktop && styles.focusedViewDesktop]}>
      <Text style={styles.sectionLabel}>FOODS</Text>
      <View style={styles.searchField}><Search color={palette.muted} size={18} strokeWidth={2.2} /><TextInput value={foodQuery} onChangeText={(value) => { setFoodQuery(value); setFoodLimit(8); }} accessibilityLabel="Search saved foods" placeholder="Search your foods…" placeholderTextColor={palette.mutedSoft} style={styles.searchInput} /></View>
      <View style={styles.secondaryActions}><Pressable accessibilityRole="button" onPress={() => { resetFoodForm(); setNewFoodForMeal(false); setNewFoodOpen(true); }} style={styles.secondaryAction}><Plus color={palette.ink} size={17} strokeWidth={2.6} /><Text style={styles.secondaryActionText}>New food</Text></Pressable><Pressable accessibilityRole="button" onPress={() => { resetFoodForm(); setNewFoodForMeal(false); setNewFoodOpen(true); void openBarcodeScanner(); }} style={styles.secondaryAction}><Camera color={palette.ink} size={17} strokeWidth={2.3} /><Text style={styles.secondaryActionText}>Scan barcode</Text></Pressable><Pressable accessibilityRole="button" onPress={() => { resetFoodForm(); setNewFoodForMeal(false); setNewFoodOpen(true); void readNutritionLabel(); }} style={styles.secondaryAction}><ImagePlus color={palette.ink} size={17} strokeWidth={2.3} /><Text style={styles.secondaryActionText}>Scan label</Text></Pressable></View>
      <Text style={styles.listLabel}>{foodQuery ? "RESULTS" : "SAVED FOODS"}</Text>
      <View style={styles.ledger}>{visibleFoods.map((food) => <View key={food.id} style={styles.foodRow}><View style={styles.foodCopy}><Text style={styles.foodName}>{food.name}</Text><Text style={styles.foodMeta}>{servingLabel(food)} per serving · {food.calories_kcal} kcal</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Add ${food.name} to meal`} onPress={() => openBuilder(food.id)} hitSlop={8}><Text style={styles.addText}>Add</Text></Pressable></View>)}{visibleFoods.length === 0 ? <View style={styles.emptyState}><Text style={styles.emptyText}>{foodQuery ? "No saved foods match this search." : "Create your first food, or scan a barcode or label."}</Text></View> : null}</View>
      {!foodQuery && visibleFoods.length < record.nutrition.foods.length ? <Pressable accessibilityRole="button" onPress={() => setFoodLimit((limit) => limit + 8)} style={styles.showMore}><Text style={styles.showMoreText}>Show more foods</Text></Pressable> : null}
    </View> : null}

    {displayedView === "history" ? <View style={[styles.focusedView, isDesktop && styles.focusedViewDesktop]}>
      <View style={styles.historyHeader}><Text style={styles.sectionLabel}>HISTORY</Text><View style={styles.historyFilters}>{(["7", "30", "custom"] as const).map((item) => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: displayedHistoryRange === item }} onPress={() => { setFocusedMealDismissed(true); setHistoryRange(item); setHistoryDayLimit(7); }}><Text style={[styles.historyFilterText, displayedHistoryRange === item && styles.historyFilterTextActive]}>{item === "custom" ? "Custom" : `${item} days`}</Text></Pressable>)}</View></View>
      {displayedHistoryRange === "custom" ? <TextInput value={displayedCustomHistoryStart} onChangeText={(value) => { setFocusedMealDismissed(true); setCustomHistoryStart(value); }} placeholder="Start date (YYYY-MM-DD)" placeholderTextColor={palette.mutedSoft} keyboardType="numbers-and-punctuation" style={styles.dateInput} /> : null}
      <View style={styles.historyList}>{historyByDay.slice(0, historyDayLimit).map(([day, meals]) => { const totals = meals.reduce((sum, meal) => sum + mealTotals(meal).calories, 0); return <View key={day} style={styles.historyDay}><View style={styles.historyDayHeader}><Text style={styles.historyDayTitle}>{formatDay(day)}</Text><Text style={styles.historyDayMeta}>{totals.toLocaleString()} kcal · {meals.length} {meals.length === 1 ? "meal" : "meals"}</Text></View><View style={styles.ledger}>{meals.map(renderMealRow)}</View></View>; })}{historyByDay.length === 0 ? <View style={styles.emptyState}><Text style={styles.emptyText}>No meals in this period.</Text></View> : null}</View>
      {historyByDay.length > historyDayLimit ? <Pressable accessibilityRole="button" onPress={() => setHistoryDayLimit((limit) => limit + 7)} style={styles.showMore}><Text style={styles.showMoreText}>Show more days</Text></Pressable> : null}
    </View> : null}

    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}

    <Modal animationType="slide" visible={builderOpen} onRequestClose={() => !saving && setBuilderOpen(false)}><View style={styles.modalPage}><View style={[styles.modalHeader, { paddingTop: Math.max(insets.top, 18) }]}><View><Text style={styles.sectionLabel}>LOG A MEAL</Text><Text style={styles.modalTitle}>Build the meal.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close meal builder" disabled={saving} onPress={() => setBuilderOpen(false)} style={styles.closeButton}><X color={palette.oxide} size={21} strokeWidth={2.5} /></Pressable></View><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.modalScroll, { paddingBottom: 116 + insets.bottom }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Create a new food" onPress={() => { resetFoodForm(); setNewFoodForMeal(true); setBuilderOpen(false); setNewFoodOpen(true); }} style={[styles.secondaryAction, styles.builderFirstAction]}><Plus color={palette.ink} size={17} strokeWidth={2.6} /><Text style={styles.secondaryActionText}>New food</Text></Pressable>
      <Text style={styles.sectionLabel}>MEAL TYPE</Text><View style={styles.mealTypeRow}>{mealTypes.map((item) => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: mealType === item }} onPress={() => setMealType(item)} style={[styles.mealTypeButton, mealType === item && styles.mealTypeButtonActive]}><Text style={[styles.mealTypeText, mealType === item && styles.mealTypeTextActive]}>{item}</Text></Pressable>)}</View>
      <TextInput value={consumedAt} onChangeText={setConsumedAt} placeholder="Date/time (optional)" placeholderTextColor={palette.mutedSoft} style={styles.dateInput} />
      <Text style={styles.inputHint}>Use a date and time such as Jul 27, 2026 6:30 PM, or leave blank for now.</Text>
      <Text style={[styles.sectionLabel, styles.modalSection]}>SELECT A SAVED FOOD</Text><Pressable accessibilityRole="button" accessibilityState={{ expanded: foodPickerOpen }} accessibilityLabel="Select a saved food" onPress={() => setFoodPickerOpen((open) => !open)} style={styles.foodSelectTrigger}><Text style={styles.foodSelectPlaceholder}>Choose a saved food</Text><ChevronDown color={palette.oxide} size={20} strokeWidth={2.4} /></Pressable>
      {foodPickerOpen ? <View style={styles.foodSelectPanel}><View style={styles.searchField}><Search color={palette.muted} size={18} strokeWidth={2.2} /><TextInput value={foodQuery} onChangeText={setFoodQuery} accessibilityLabel="Search saved foods to add" placeholder="Search saved foods…" placeholderTextColor={palette.mutedSoft} style={styles.searchInput} /></View><ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.foodSelectList}>{matchingSavedFoods.map((food) => <View key={food.id} style={styles.foodRow}><View style={styles.foodCopy}><Text style={styles.foodName}>{food.name}</Text><Text style={styles.foodMeta}>{servingLabel(food)} per serving · {food.calories_kcal} kcal</Text></View><Pressable accessibilityRole="button" onPress={() => { addFood(food.id); setFoodPickerOpen(false); setFoodQuery(""); }} hitSlop={8}><Text style={styles.addText}>{selectedFoods.some((item) => item.foodId === food.id) ? "Added" : "Add"}</Text></Pressable></View>)}{matchingSavedFoods.length === 0 ? <View style={styles.foodSelectEmpty}><Text style={styles.emptyText}>No saved foods match this search.</Text></View> : null}</ScrollView></View> : null}
      <View style={styles.selectedHeader}><Text style={styles.sectionLabel}>SELECTED</Text></View>
      {selectedSummaries.length ? <View style={styles.ledger}>{selectedSummaries.map((item, index) => {
        const referenceAmount = item.food ? servingValue(item.food) : 1;
        const unit = item.food ? servingUnit(item.food) : "g";
        return <View key={item.foodId} style={styles.selectedRow}><View style={styles.selectedRowTop}><View style={styles.foodCopy}><Text style={styles.foodName}>{item.food?.name ?? "Unavailable food"}</Text><Text style={styles.foodMeta}>{item.food ? `Nutrition per ${servingLabel(item.food)}` : "Serving unavailable"}</Text><Text style={styles.foodMeta}>{item.totals ? `${item.totals.calories} kcal · Protein (g) ${item.totals.protein} · Carbs (g) ${item.totals.carbs} · Fat (g) ${item.totals.fat}` : "Enter a valid amount"}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.food?.name ?? "food"}`} disabled={saving} onPress={() => setSelectedFoods((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Text style={styles.removeText}>Remove</Text></Pressable></View><Text style={styles.amountPrompt}>HOW MUCH DID YOU HAVE?</Text><View style={styles.amountChoices}>{[["Full serving", 1], ["Half", 0.5], ["Quarter", 0.25]].map(([label, multiplier]) => <Pressable key={String(label)} accessibilityRole="button" onPress={() => setSelectedFoods((items) => items.map((row, rowIndex) => rowIndex === index ? { ...row, grams: String(formatNumber(referenceAmount * Number(multiplier))) } : row))} style={styles.amountChoice}><Text style={styles.amountChoiceText}>{label}</Text></Pressable>)}</View><View style={styles.amountRow}><TextInput value={String(item.grams)} onChangeText={(grams) => setSelectedFoods((items) => items.map((row, rowIndex) => rowIndex === index ? { ...row, grams } : row))} accessibilityLabel={`${item.food?.name ?? "Food"} amount in ${unit}`} keyboardType="decimal-pad" placeholder={`Amount in ${unit}`} placeholderTextColor={palette.mutedSoft} style={styles.amountInput} /><Text style={styles.amountUnit}>{unit}</Text></View></View>;
      })}</View> : <View style={styles.emptyState}><Text style={styles.emptyText}>Search and add foods to build this meal.</Text></View>}
      <View style={styles.photoAction}><Pressable accessibilityRole="button" onPress={() => void chooseMealPhoto()}><Text style={styles.addText}>{mealPhoto ? "Replace meal photo" : "Add meal photo"}</Text></Pressable>{mealPhoto ? <Pressable accessibilityRole="button" onPress={() => setMealPhoto(null)}><Text style={styles.removeText}>Remove</Text></Pressable> : null}</View>{mealPhoto ? <Image accessibilityLabel="Selected meal photo" source={{ uri: mealPhoto.uri }} style={styles.photoPreview} /> : null}
    </ScrollView><View style={[styles.stickyAction, { paddingBottom: Math.max(insets.bottom, 16) }]}><View style={styles.stickyCopy}><Text style={styles.stickyTotalLabel}>TOTAL</Text><Text style={styles.stickyTotal}>{selectedTotals.calories.toLocaleString()} kcal · Protein (g) {formatNumber(selectedTotals.protein)} · Carbs (g) {formatNumber(selectedTotals.carbs)} · Fat (g) {formatNumber(selectedTotals.fat)}</Text></View><Pressable accessibilityRole="button" disabled={saving || !selectedFoods.length} onPress={() => void saveMeal()} style={[styles.stickyButton, (saving || !selectedFoods.length) && styles.disabled]}><Text style={styles.stickyButtonText}>{saving ? "Logging…" : "Log meal"}</Text></Pressable></View></View></Modal>

    <Modal animationType="slide" visible={newFoodOpen} onRequestClose={() => !saving && closeNewFood()}><View style={styles.modalPage}><View style={[styles.modalHeader, { paddingTop: Math.max(insets.top, 18) }]}><View><Text style={styles.sectionLabel}>NEW FOOD</Text><Text style={styles.modalTitle}>Add to the library.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close new food" disabled={saving} onPress={closeNewFood} style={styles.closeButton}><X color={palette.oxide} size={21} strokeWidth={2.5} /></Pressable></View><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.modalScroll, { paddingBottom: 40 + insets.bottom }]}>
      {scannerOpen ? <View style={styles.scanner}><View style={styles.scannerViewport}><CameraView facing="back" barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128"] }} onCameraReady={() => setScannerReady(true)} onMountError={({ message }) => { setScannerReady(false); setScannerOpen(false); setNotice(message || "The camera preview could not start. Enter the barcode manually instead."); }} onBarcodeScanned={({ data }) => { if (!data || saving) return; setBarcode(data); setScannerReady(false); setScannerOpen(false); void lookupFoodBarcode(data); }} style={styles.scannerCamera} />{!scannerReady ? <View pointerEvents="none" style={styles.scannerLoading}><ActivityIndicator color={palette.surface} /><Text style={styles.scannerLoadingText}>Opening rear camera…</Text></View> : null}</View><Pressable accessibilityRole="button" onPress={() => { setScannerReady(false); setScannerOpen(false); }} style={styles.scannerClose}><Text style={styles.scannerCloseText}>Close scanner</Text></Pressable></View> : null}
      <View style={styles.barcodeField}><TextInput value={barcode} onChangeText={setBarcode} keyboardType="number-pad" placeholder="Barcode (optional)" placeholderTextColor={palette.mutedSoft} style={styles.barcodeInput} onSubmitEditing={() => void lookupFoodBarcode()} /><Pressable accessibilityRole="button" disabled={saving} onPress={() => void lookupFoodBarcode()}><Text style={styles.addText}>Look up</Text></Pressable></View><View style={styles.secondaryActions}><Pressable accessibilityRole="button" disabled={saving} onPress={() => void openBarcodeScanner()} style={styles.secondaryAction}><Camera color={palette.ink} size={17} strokeWidth={2.3} /><Text style={styles.secondaryActionText}>Scan barcode</Text></Pressable><Pressable accessibilityRole="button" disabled={saving} onPress={() => void readNutritionLabel()} style={styles.secondaryAction}><ImagePlus color={palette.ink} size={17} strokeWidth={2.3} /><Text style={styles.secondaryActionText}>Scan label</Text></Pressable></View>
      <Text style={[styles.inputLabel, styles.formFieldLabel]}>FOOD NAME</Text><TextInput value={name} onChangeText={setName} placeholder="Food name" placeholderTextColor={palette.mutedSoft} style={styles.formInput} returnKeyType="next" /><Text style={[styles.inputLabel, styles.formFieldLabel]}>REFERENCE SERVING</Text><View style={styles.referenceServingRow}><TextInput value={servingSizeG} onChangeText={setServingSizeG} keyboardType="decimal-pad" placeholder="Amount" placeholderTextColor={palette.mutedSoft} style={[styles.formInput, styles.referenceServingInput]} returnKeyType="next" /><Text style={styles.referenceServingUnit}>{servingSizeUnit}</Text></View><View style={styles.servingUnitChoices}>{servingSizeUnits.map((unit) => <Pressable key={unit} accessibilityRole="button" accessibilityState={{ selected: servingSizeUnit === unit }} onPress={() => { setServingSizeUnit(unit); setServingSizeText(""); }} style={[styles.servingUnitChoice, servingSizeUnit === unit && styles.servingUnitChoiceActive]}><Text style={[styles.servingUnitChoiceText, servingSizeUnit === unit && styles.servingUnitChoiceTextActive]}>{unit}</Text></Pressable>)}</View><TextInput value={servingSizeText} onChangeText={setServingSizeText} placeholder="Label wording (optional, e.g. 1 bottle)" placeholderTextColor={palette.mutedSoft} style={styles.formInput} /><Text style={[styles.inputLabel, styles.formFieldLabel]}>CALORIES (KCAL) PER REFERENCE SERVING</Text><TextInput value={calories} onChangeText={setCalories} keyboardType="number-pad" placeholder="Calories" placeholderTextColor={palette.mutedSoft} style={styles.formInput} returnKeyType="next" /><View style={[styles.macroFields, !isDesktop && styles.macroFieldsMobile]}><View style={styles.macroField}><Text style={[styles.inputLabel, styles.formFieldLabel]}>PROTEIN (G)</Text><TextInput value={protein} onChangeText={setProtein} keyboardType="decimal-pad" placeholder="Protein" placeholderTextColor={palette.mutedSoft} style={[styles.formInput, styles.macroInput, !isDesktop && styles.macroInputMobile]} /></View><View style={styles.macroField}><Text style={[styles.inputLabel, styles.formFieldLabel]}>CARBS (G)</Text><TextInput value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" placeholder="Carbs" placeholderTextColor={palette.mutedSoft} style={[styles.formInput, styles.macroInput, !isDesktop && styles.macroInputMobile]} /></View><View style={styles.macroField}><Text style={[styles.inputLabel, styles.formFieldLabel]}>FAT (G)</Text><TextInput value={fat} onChangeText={setFat} keyboardType="decimal-pad" placeholder="Fat" placeholderTextColor={palette.mutedSoft} style={[styles.formInput, styles.macroInput, !isDesktop && styles.macroInputMobile]} /></View></View>
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}<Pressable accessibilityRole="button" disabled={saving} onPress={() => void saveFood()} style={[styles.primaryAction, saving && styles.disabled]}><Text style={styles.primaryActionText}>{saving ? "Saving…" : "Save food"}</Text></Pressable>
    </ScrollView></View></Modal>

    <Modal animationType="slide" visible={Boolean(editingMeal)} onRequestClose={closeMealEditor}>
      <View style={styles.modalPage}>
        <View style={[styles.modalHeader, { paddingTop: Math.max(insets.top, 18) }]}>
          <View>
            <Text style={styles.sectionLabel}>EDIT LOGGED FOOD</Text>
            <Text style={styles.modalTitle} numberOfLines={2}>{editingMeal?.name ?? "Logged food"}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close logged food editor" disabled={saving} onPress={closeMealEditor} style={styles.closeButton}>
            <X color={palette.oxide} size={21} strokeWidth={2.5} />
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.modalScroll, { paddingBottom: 40 + insets.bottom }]}>
          <Text style={styles.inputLabel}>MEAL TYPE</Text>
          <View style={styles.mealTypeRow}>
            {mealTypes.map((item) => (
              <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: editMealType === item }} onPress={() => setEditMealType(item)} style={[styles.mealTypeButton, editMealType === item && styles.mealTypeButtonActive]}>
                <Text style={[styles.mealTypeText, editMealType === item && styles.mealTypeTextActive]}>{item}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.inputLabel, styles.editorFieldLabel]}>AMOUNT ({editingMeal ? servingUnit(editingMeal).toUpperCase() : "G"})</Text>
          <TextInput value={editMealGrams} onChangeText={setEditMealGrams} accessibilityLabel={`Logged food amount in ${editingMeal ? servingUnit(editingMeal) : "g"}`} keyboardType="decimal-pad" placeholder={`Amount in ${editingMeal ? servingUnit(editingMeal) : "g"}`} placeholderTextColor={palette.mutedSoft} style={styles.formInput} />
          <Text style={[styles.inputLabel, styles.editorFieldLabel]}>WHEN</Text>
          <TextInput value={editConsumedAt} onChangeText={setEditConsumedAt} accessibilityLabel="Logged food date and time" placeholder="Jul 27, 2026 6:30 PM" placeholderTextColor={palette.mutedSoft} style={styles.formInput} />
          <Text style={styles.inputHint}>Use a date and time such as Jul 27, 2026 6:30 PM.</Text>
          {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
          <Pressable accessibilityRole="button" disabled={saving} onPress={() => void saveMealEdit()} style={[styles.primaryAction, saving && styles.disabled]}>
            <Text style={styles.primaryActionText}>{saving ? "Saving…" : "Save changes"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={saving} onPress={() => editingMeal && requestMealDeletion(editingMeal)} style={[styles.destructiveAction, saving && styles.disabled]}>
            <Trash2 color={palette.destructive} size={18} strokeWidth={2.3} />
            <Text style={styles.destructiveActionText}>Delete logged food</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>

    <Modal transparent animationType="fade" visible={Boolean(mealPendingDeletion)} onRequestClose={() => !saving && setMealPendingDeletion(null)}>
      <View style={styles.confirmationScrim}>
        <View accessibilityRole="alert" style={styles.confirmationDialog}>
          <Text style={styles.sectionLabel}>REMOVE LOGGED FOOD</Text>
          <Text style={styles.confirmationTitle}>Delete {mealPendingDeletion?.name ?? "this food"}?</Text>
          <Text style={styles.confirmationCopy}>This removes it from your {mealPendingDeletion ? titleCase(mealPendingDeletion.meal_type) : "meal"} log. This cannot be undone.</Text>
          <View style={styles.confirmationActions}>
            <Pressable accessibilityRole="button" disabled={saving} onPress={() => setMealPendingDeletion(null)} style={[styles.confirmationCancel, saving && styles.disabled]}>
              <Text style={styles.confirmationCancelText}>Cancel</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={saving} onPress={() => void confirmMealDeletion()} style={[styles.confirmationDelete, saving && styles.disabled]}>
              <Text style={styles.confirmationDeleteText}>{saving ? "Deleting…" : "Delete"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  </>;
}

const baseStyles = StyleSheet.create({
  eyebrow: { color: "#642D2A", fontFamily: "Courier", fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  title: { color: "#101015", fontSize: 42, fontWeight: "900", letterSpacing: -1.8, marginTop: 7 },
  tabs: { borderBottomColor: "#D4C9B9", borderBottomWidth: 1, flexDirection: "row", marginTop: 26 },
  tab: { minHeight: 46, justifyContent: "center", paddingHorizontal: 14 },
  tabActive: { borderBottomColor: "#642D2A", borderBottomWidth: 2 },
  tabText: { color: "#655D57", fontSize: 12, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  tabTextActive: { color: "#101015" },
  todayLayout: { gap: 27, marginTop: 30 },
  todayTop: { gap: 18 },
  todayTopDesktop: { alignItems: "stretch", flexDirection: "row", gap: 27 },
  todaySummary: { flex: 1, minWidth: 280 },
  todayAside: { borderTopColor: "#D4C9B9", borderTopWidth: 1, gap: 9, minWidth: 220, paddingTop: 18 },
  todayAsideDesktop: { borderLeftColor: "#D4C9B9", borderLeftWidth: 1, borderTopWidth: 0, flex: 0.72, paddingLeft: 20, paddingTop: 0 },
  sectionLabel: { color: "#642D2A", fontFamily: "Courier", fontSize: 12, fontWeight: "800", letterSpacing: 1.35 },
  dailyCalories: { color: "#101015", fontSize: 32, fontWeight: "900", letterSpacing: -1.2, marginTop: 9 },
  dailyMacros: { color: "#655D57", fontSize: 14, lineHeight: 21, marginTop: 4 },
  emptyHeadline: { color: "#101015", fontSize: 19, fontWeight: "800", marginTop: 10 },
  primaryAction: { alignItems: "center", backgroundColor: "#101015", justifyContent: "center", marginTop: 22, minHeight: 54, paddingHorizontal: 21 },
  todayLogAction: { marginTop: 0 },
  primaryActionText: { color: "#F4EFE7", fontSize: 15, fontWeight: "900" },
  asideText: { color: "#655D57", fontSize: 14, lineHeight: 21 },
  mealList: { flexBasis: "100%" },
  ledger: { borderTopColor: "#D4C9B9", borderTopWidth: 1, marginTop: 11 },
  mealRow: { borderBottomColor: "#D4C9B9", borderBottomWidth: 1 },
  mealRowPressable: { alignItems: "center", flexDirection: "row", gap: 11, minHeight: 72, paddingVertical: 13 },
  mealRowCopy: { flex: 1, minWidth: 0 },
  mealType: { color: "#101015", fontSize: 14, fontWeight: "900" },
  mealSummary: { color: "#655D57", fontSize: 13, marginTop: 4 },
  mealRowValue: { alignItems: "flex-end" },
  mealCalories: { color: "#101015", fontSize: 13, fontWeight: "800" },
  mealTime: { color: "#655D57", fontSize: 11, marginTop: 4 },
  chevronOpen: { transform: [{ rotate: "90deg" }] },
  mealDetail: { borderLeftColor: "#D4C9B9", borderLeftWidth: 1, gap: 2, marginBottom: 15, marginLeft: 4, paddingLeft: 14 },
  detailItem: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
  detailItemCopy: { flex: 1, minWidth: 0 },
  detailItemActions: { flexDirection: "row", gap: 2, marginLeft: 10 },
  detailIconButton: { alignItems: "center", height: 36, justifyContent: "center", width: 36 },
  detailItemName: { color: "#101015", fontSize: 14, fontWeight: "800" },
  detailItemMeta: { color: "#655D57", fontSize: 12, marginTop: 3 },
  detailItemMacro: { color: "#655D57", fontSize: 11, marginTop: 2 },
  mealImage: { height: 180, marginTop: 8, width: "100%" },
  emptyState: { borderTopColor: "#D4C9B9", borderTopWidth: 1, paddingVertical: 25 },
  emptyText: { color: "#655D57", fontSize: 14, lineHeight: 21 },
  focusedView: { marginTop: 29 },
  focusedViewDesktop: { maxWidth: 760 },
  searchField: { alignItems: "center", borderBottomColor: "#6A7CA0", borderBottomWidth: 1, flexDirection: "row", gap: 9, marginTop: 17, minHeight: 49 },
  searchInput: { color: "#101015", flex: 1, fontSize: 17, paddingVertical: 10 },
  foodSelectTrigger: { alignItems: "center", borderColor: "#101015", borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 12, minHeight: 52, paddingHorizontal: 14 },
  foodSelectPlaceholder: { color: "#101015", fontSize: 15, fontWeight: "800" },
  foodSelectPanel: { borderBottomColor: "#D4C9B9", borderBottomWidth: 1, paddingBottom: 8 },
  foodSelectList: { maxHeight: 308 },
  foodSelectEmpty: { paddingVertical: 22 },
  secondaryActions: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 17 },
  secondaryAction: { alignItems: "center", borderColor: "#101015", borderWidth: 1, flexDirection: "row", gap: 7, minHeight: 44, paddingHorizontal: 12 },
  builderFirstAction: { alignSelf: "flex-start", marginBottom: 22 },
  secondaryActionText: { color: "#101015", fontSize: 13, fontWeight: "800" },
  listLabel: { color: "#642D2A", fontFamily: "Courier", fontSize: 12, fontWeight: "800", letterSpacing: 1.35, marginTop: 29 },
  foodRow: { alignItems: "center", borderBottomColor: "#D4C9B9", borderBottomWidth: 1, flexDirection: "row", gap: 14, minHeight: 66, paddingVertical: 11 },
  foodCopy: { flex: 1, minWidth: 0 },
  foodName: { color: "#101015", fontSize: 15, fontWeight: "800" },
  foodMeta: { color: "#655D57", fontSize: 12, marginTop: 4 },
  addText: { color: "#642D2A", fontSize: 13, fontWeight: "900", textDecorationColor: "#A95B5B", textDecorationLine: "underline" },
  showMore: { alignSelf: "flex-start", minHeight: 44, paddingTop: 16 },
  showMoreText: { color: "#642D2A", fontSize: 13, fontWeight: "900", textDecorationLine: "underline" },
  historyHeader: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between" },
  historyFilters: { flexDirection: "row", gap: 13 },
  historyFilterText: { color: "#655D57", fontSize: 13, fontWeight: "800" },
  historyFilterTextActive: { color: "#642D2A", textDecorationColor: "#A95B5B", textDecorationLine: "underline" },
  dateInput: { borderBottomColor: "#6A7CA0", borderBottomWidth: 1, color: "#101015", fontSize: 14, marginTop: 17, minHeight: 45, paddingVertical: 8 },
  inputLabel: { color: "#642D2A", fontFamily: "Courier", fontSize: 12, fontWeight: "800", letterSpacing: 1.35 },
  editorFieldLabel: { marginTop: 28 },
  historyList: { marginTop: 12 },
  historyDay: { borderBottomColor: "#D4C9B9", borderBottomWidth: 1, paddingVertical: 21 },
  historyDayHeader: { alignItems: "baseline", flexDirection: "row", gap: 13, justifyContent: "space-between" },
  historyDayTitle: { color: "#101015", flex: 1, fontSize: 20, fontWeight: "900", letterSpacing: -0.5 },
  historyDayMeta: { color: "#655D57", fontSize: 11, textAlign: "right" },
  notice: { color: "#642D2A", fontSize: 13, lineHeight: 19, marginTop: 18 },
  modalPage: { backgroundColor: "#F4EFE7", flex: 1 },
  modalHeader: { alignItems: "flex-start", borderBottomColor: "#D4C9B9", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingBottom: 17, paddingHorizontal: 20 },
  modalTitle: { color: "#101015", fontSize: 30, fontWeight: "900", letterSpacing: -1.1, marginTop: 6 },
  closeButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  destructiveAction: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 8, marginTop: 22, minHeight: 44, paddingHorizontal: 4 },
  destructiveActionText: { color: "#A33B36", fontSize: 14, fontWeight: "900", textDecorationLine: "underline" },
  confirmationScrim: { alignItems: "center", backgroundColor: "rgba(16, 16, 21, 0.52)", flex: 1, justifyContent: "center", padding: 22 },
  confirmationDialog: { backgroundColor: "#F4EFE7", borderColor: "#101015", borderWidth: 1, gap: 14, maxWidth: 430, padding: 22, width: "100%" },
  confirmationTitle: { color: "#101015", fontSize: 23, fontWeight: "900", letterSpacing: -0.7 },
  confirmationCopy: { color: "#655D57", fontSize: 14, lineHeight: 21 },
  confirmationActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end", marginTop: 4 },
  confirmationCancel: { alignItems: "center", borderColor: "#101015", borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: 16 },
  confirmationCancelText: { color: "#101015", fontSize: 13, fontWeight: "900" },
  confirmationDelete: { alignItems: "center", backgroundColor: "#A33B36", justifyContent: "center", minHeight: 44, paddingHorizontal: 16 },
  confirmationDeleteText: { color: "#F4EFE7", fontSize: 13, fontWeight: "900" },
  modalScroll: { paddingHorizontal: 20, paddingTop: 22 },
  mealTypeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  mealTypeButton: { borderColor: "#D4C9B9", borderWidth: 1, minHeight: 44, paddingHorizontal: 13, justifyContent: "center" },
  mealTypeButtonActive: { backgroundColor: "#101015", borderColor: "#101015" },
  mealTypeText: { color: "#101015", fontSize: 13, fontWeight: "800", textTransform: "capitalize" },
  mealTypeTextActive: { color: "#F4EFE7" },
  inputHint: { color: "#655D57", fontSize: 11, lineHeight: 16, marginTop: 7 },
  modalSection: { marginTop: 27 },
  selectedHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 27 },
  selectedRow: { borderBottomColor: "#D4C9B9", borderBottomWidth: 1, paddingVertical: 14 },
  selectedRowTop: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  removeText: { color: "#655D57", fontSize: 12, fontWeight: "800", textDecorationLine: "underline" },
  amountRow: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 12 },
  amountPrompt: { color: "#642D2A", fontFamily: "Courier", fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginTop: 15 },
  amountChoices: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 8 },
  amountChoice: { borderColor: "#D4C9B9", borderWidth: 1, minHeight: 34, justifyContent: "center", paddingHorizontal: 10 },
  amountChoiceText: { color: "#101015", fontSize: 12, fontWeight: "800" },
  amountInput: { borderBottomColor: "#6A7CA0", borderBottomWidth: 1, color: "#101015", fontSize: 16, minHeight: 40, paddingHorizontal: 2, width: 104 },
  amountUnit: { color: "#655D57", fontSize: 14, fontWeight: "800" },
  photoAction: { flexDirection: "row", gap: 18, marginTop: 23 },
  photoPreview: { height: 170, marginTop: 12, width: "100%" },
  stickyAction: { alignItems: "center", backgroundColor: "#F4EFE7", borderTopColor: "#D4C9B9", borderTopWidth: 1, bottom: 0, flexDirection: "row", gap: 14, justifyContent: "space-between", left: 0, paddingHorizontal: 20, paddingTop: 14, position: "absolute", right: 0 },
  stickyTotalLabel: { color: "#642D2A", fontFamily: "Courier", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  stickyCopy: { flex: 1, minWidth: 0 },
  stickyTotal: { color: "#101015", fontSize: 13, fontWeight: "900", marginTop: 3 },
  stickyButton: { alignItems: "center", backgroundColor: "#101015", justifyContent: "center", minHeight: 48, paddingHorizontal: 18 },
  stickyButtonText: { color: "#F4EFE7", fontSize: 14, fontWeight: "900" },
  disabled: { opacity: 0.48 },
  scanner: { backgroundColor: "#101015", marginBottom: 18 },
  scannerViewport: { height: 300, position: "relative", width: "100%" },
  scannerCamera: { height: "100%", width: "100%" },
  scannerLoading: { alignItems: "center", backgroundColor: "#101015", bottom: 0, gap: 10, justifyContent: "center", left: 0, position: "absolute", right: 0, top: 0 },
  scannerLoadingText: { color: "#F4EFE7", fontSize: 14, fontWeight: "800" },
  scannerClose: { alignItems: "center", minHeight: 48, justifyContent: "center" },
  scannerCloseText: { color: "#F4EFE7", fontSize: 14, fontWeight: "900" },
  barcodeField: { alignItems: "center", borderBottomColor: "#6A7CA0", borderBottomWidth: 1, flexDirection: "row", gap: 12, minHeight: 50 },
  barcodeInput: { color: "#101015", flex: 1, fontSize: 16, paddingVertical: 9 },
  formInput: { borderBottomColor: "#6A7CA0", borderBottomWidth: 1, color: "#101015", fontSize: 16, marginTop: 19, minHeight: 48, paddingVertical: 9 },
  formFieldLabel: { marginTop: 24 },
  referenceServingRow: { alignItems: "center", flexDirection: "row", gap: 9 },
  referenceServingInput: { flex: 1 },
  referenceServingUnit: { color: "#655D57", fontSize: 15, fontWeight: "800", minWidth: 42 },
  servingUnitChoices: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  servingUnitChoice: { borderColor: "#D4C9B9", borderWidth: 1, minHeight: 34, justifyContent: "center", paddingHorizontal: 9 },
  servingUnitChoiceActive: { backgroundColor: "#101015", borderColor: "#101015" },
  servingUnitChoiceText: { color: "#101015", fontSize: 12, fontWeight: "800" },
  servingUnitChoiceTextActive: { color: "#F4EFE7" },
  macroFields: { flexDirection: "row", gap: 10 },
  macroField: { flex: 1 },
  macroFieldsMobile: { flexDirection: "column", gap: 0 },
  macroInput: { flex: 1 },
  macroInputMobile: { flex: 0, width: "100%" },
});
