import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";

import { getThemePreference, readSession, updateThemePreference } from "../lib/api";
import { subscribeToSessionChanges } from "../lib/auth-session-events";
import { getStoredSession, setStoredSession } from "../lib/session-store";

export type ThemeMode = "light" | "dark";
export type ThemeName =
  | "transmute"
  | "flame-alchemist"
  | "hawkeye"
  | "automail-mechanic"
  | "avarice"
  | "scarred-man"
  | "armor-bound-soul";

export type TransmutePalette = {
  surface: string;
  raised: string;
  ink: string;
  body: string;
  charcoal: string;
  muted: string;
  mutedSoft: string;
  divider: string;
  oxide: string;
  oxideMuted: string;
  destructive: string;
  steel: string;
  steelMuted: string;
  gold: string;
  goldSoft: string;
};

type ThemeDefinition = {
  label: string;
  light: TransmutePalette;
  dark: TransmutePalette;
};

export const transmuteThemes: Record<ThemeName, ThemeDefinition> = {
  transmute: {
    label: "Transmute (Default)",
    light: {
      surface: "#F4EBD8", raised: "#FCF7EC", ink: "#171821", body: "#292B35", charcoal: "#343641", muted: "#605D63", mutedSoft: "#827D80", divider: "#D9CEB9",
      oxide: "#6D79A0", oxideMuted: "#8F97AE", destructive: "#A33B36", steel: "#6D79A0", steelMuted: "#9099B6", gold: "#D1A742", goldSoft: "#E9D291",
    },
    dark: {
      surface: "#14131A", raised: "#201E29", ink: "#F4F0E6", body: "#E5E0D7", charcoal: "#CBC5BE", muted: "#BDB7B2", mutedSoft: "#938C87", divider: "#413D50",
      oxide: "#8B95B8", oxideMuted: "#A3AAC4", destructive: "#E0756E", steel: "#8B95B8", steelMuted: "#B1B8D0", gold: "#D9B653", goldSoft: "#ECD887",
    },
  },
  "flame-alchemist": {
    label: "Flame Alchemist",
    light: {
      surface: "#F6EEE6", raised: "#FCF8F1", ink: "#121D2C", body: "#29394A", charcoal: "#344553", muted: "#566473", mutedSoft: "#7B8792", divider: "#D8D0C4",
      oxide: "#E4572E", oxideMuted: "#B97765", destructive: "#B74335", steel: "#315D91", steelMuted: "#6E8DB1", gold: "#E4572E", goldSoft: "#F1B094",
    },
    dark: {
      surface: "#0D1520", raised: "#162231", ink: "#F6F1E9", body: "#DDE5EB", charcoal: "#C8D3DD", muted: "#BBC6D0", mutedSoft: "#8797A7", divider: "#34465A",
      oxide: "#FF6A3D", oxideMuted: "#D7846B", destructive: "#EE7962", steel: "#6F98C7", steelMuted: "#A8C0DB", gold: "#FF6A3D", goldSoft: "#F1AD8E",
    },
  },
  hawkeye: {
    label: "Hawkeye",
    light: {
      surface: "#EFEBDD", raised: "#FAF8EE", ink: "#282D27", body: "#3F4640", charcoal: "#4A514A", muted: "#61695D", mutedSoft: "#858B7E", divider: "#D4D2C4",
      oxide: "#B38B52", oxideMuted: "#A78657", destructive: "#A54A3F", steel: "#73785C", steelMuted: "#8D9579", gold: "#B38B52", goldSoft: "#E2CB91",
    },
    dark: {
      surface: "#171A16", raised: "#20241D", ink: "#F1F2EA", body: "#DEE1D5", charcoal: "#C9CEC0", muted: "#B8BDAA", mutedSoft: "#899077", divider: "#3D4434",
      oxide: "#C8A25C", oxideMuted: "#C9A769", destructive: "#DB7463", steel: "#A7AD8A", steelMuted: "#C5CAA9", gold: "#C8A25C", goldSoft: "#E5C979",
    },
  },
  "automail-mechanic": {
    label: "Automail Mechanic",
    light: {
      surface: "#E9F3F7", raised: "#F8FCFD", ink: "#172736", body: "#2D4354", charcoal: "#395262", muted: "#557181", mutedSoft: "#79909C", divider: "#C9DCE3",
      oxide: "#C36E42", oxideMuted: "#A97861", destructive: "#AF4E43", steel: "#3984A8", steelMuted: "#71A3BE", gold: "#C36E42", goldSoft: "#E4AD8B",
    },
    dark: {
      surface: "#0F1B24", raised: "#182A35", ink: "#EDF6FA", body: "#D5E5EB", charcoal: "#BED3DC", muted: "#AFC4CD", mutedSoft: "#7E9AA7", divider: "#365263",
      oxide: "#D27A52", oxideMuted: "#D08A69", destructive: "#E16D5C", steel: "#69B2D4", steelMuted: "#A2CEE3", gold: "#D27A52", goldSoft: "#EDA881",
    },
  },
  avarice: {
    label: "Avarice",
    light: {
      surface: "#E5EFE9", raised: "#F7FBF8", ink: "#10231C", body: "#2B4238", charcoal: "#385247", muted: "#557064", mutedSoft: "#7B9186", divider: "#C9D9D0",
      oxide: "#D4A62C", oxideMuted: "#A88A54", destructive: "#A84E44", steel: "#16705A", steelMuted: "#63A18C", gold: "#D4A62C", goldSoft: "#E3C984",
    },
    dark: {
      surface: "#0C1713", raised: "#14241E", ink: "#ECF7F1", body: "#D4E7DE", charcoal: "#BED7CB", muted: "#AFC8BC", mutedSoft: "#79988A", divider: "#315246",
      oxide: "#D8AA3F", oxideMuted: "#C6A665", destructive: "#E17162", steel: "#56B090", steelMuted: "#98CFB7", gold: "#D8AA3F", goldSoft: "#E5C871",
    },
  },
  "scarred-man": {
    label: "Scarred Man",
    light: {
      surface: "#F3E5DF", raised: "#FCF7F4", ink: "#2A1816", body: "#442E2C", charcoal: "#533937", muted: "#6D5753", mutedSoft: "#927975", divider: "#DECBC2",
      oxide: "#BFA98A", oxideMuted: "#AA625E", destructive: "#A63731", steel: "#9E302C", steelMuted: "#B26E68", gold: "#BFA98A", goldSoft: "#E8D9C7",
    },
    dark: {
      surface: "#1C1010", raised: "#291817", ink: "#F7EBE7", body: "#E8D4CE", charcoal: "#D6BDB5", muted: "#C6AAA3", mutedSoft: "#956F68", divider: "#563533",
      oxide: "#CBB89F", oxideMuted: "#DA8279", destructive: "#EF756A", steel: "#D95D52", steelMuted: "#E49B92", gold: "#CBB89F", goldSoft: "#E6D2B6",
    },
  },
  "armor-bound-soul": {
    label: "Armor Bound Soul",
    light: {
      surface: "#EDF0F1", raised: "#FAFBFB", ink: "#252D31", body: "#39454B", charcoal: "#48555B", muted: "#617077", mutedSoft: "#849197", divider: "#D1D9DA",
      oxide: "#4DA9D1", oxideMuted: "#6E98AA", destructive: "#A94F4A", steel: "#778991", steelMuted: "#8A9AA1", gold: "#4DA9D1", goldSoft: "#A9D4E5",
    },
    dark: {
      surface: "#10181C", raised: "#1A252B", ink: "#EEF3F4", body: "#D7E1E4", charcoal: "#C4D0D4", muted: "#B1C0C5", mutedSoft: "#81959D", divider: "#36494F",
      oxide: "#55B4DD", oxideMuted: "#78B2CC", destructive: "#E1746D", steel: "#9EAFB5", steelMuted: "#C2CFD3", gold: "#55B4DD", goldSoft: "#8FCBE0",
    },
  },
};

export const transmuteThemeOptions: readonly { id: ThemeName; label: string }[] = [
  { id: "transmute", label: "Transmute (Default)" },
  { id: "flame-alchemist", label: "Flame Alchemist" },
  { id: "hawkeye", label: "Hawkeye" },
  { id: "automail-mechanic", label: "Automail Mechanic" },
  { id: "avarice", label: "Avarice" },
  { id: "scarred-man", label: "Scarred Man" },
  { id: "armor-bound-soul", label: "Armor Bound Soul" },
];

type ThemeContextValue = {
  mode: ThemeMode;
  theme: ThemeName;
  palette: TransmutePalette;
  setMode: (mode: ThemeMode) => void;
  setTheme: (theme: ThemeName) => void;
  toggleMode: () => void;
};

const THEME_MODE_KEY = "transmute-theme-mode.v2";
const THEME_NAME_KEY = "transmute-color-theme.v2";
const DEFAULT_MODE: ThemeMode = "light";
const DEFAULT_THEME: ThemeName = "transmute";
const ThemeContext = createContext<ThemeContextValue | null>(null);
let activeMode: ThemeMode = DEFAULT_MODE;
let activeTheme: ThemeName = DEFAULT_THEME;

function activePalette() {
  return transmuteThemes[activeTheme][activeMode];
}

function isThemeName(value: string | null): value is ThemeName {
  return transmuteThemeOptions.some((option) => option.id === value);
}

function preferenceKey(key: string, userId: string) {
  return `${key}:${userId}`;
}

export function TransmuteThemeProvider({ children }: PropsWithChildren) {
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_MODE);
  const [theme, setThemeState] = useState<ThemeName>(DEFAULT_THEME);
  const activeUserId = useRef<string | null>(null);
  const preferenceLoad = useRef(0);

  const setMode = useCallback((nextMode: ThemeMode) => {
    activeMode = nextMode;
    setModeState(nextMode);
    if (activeUserId.current) {
      void setStoredSession(preferenceKey(THEME_MODE_KEY, activeUserId.current), nextMode);
      void updateThemePreference({ mode: nextMode, theme: activeTheme });
    }
  }, []);
  const setTheme = useCallback((nextTheme: ThemeName) => {
    activeTheme = nextTheme;
    setThemeState(nextTheme);
    if (activeUserId.current) {
      void setStoredSession(preferenceKey(THEME_NAME_KEY, activeUserId.current), nextTheme);
      void updateThemePreference({ mode: activeMode, theme: nextTheme });
    }
  }, []);
  const toggleMode = useCallback(() => setMode(mode === "light" ? "dark" : "light"), [mode, setMode]);

  const loadPreferences = useCallback(async (userId: string | null) => {
    activeUserId.current = userId;
    const loadId = ++preferenceLoad.current;
    if (!userId) {
      activeMode = DEFAULT_MODE;
      activeTheme = DEFAULT_THEME;
      setModeState(DEFAULT_MODE);
      setThemeState(DEFAULT_THEME);
      return;
    }

    const [storedMode, storedTheme] = await Promise.all([
      getStoredSession(preferenceKey(THEME_MODE_KEY, userId)),
      getStoredSession(preferenceKey(THEME_NAME_KEY, userId)),
    ]);
    if (loadId !== preferenceLoad.current) return;

    let nextMode: ThemeMode = storedMode === "dark" ? "dark" : DEFAULT_MODE;
    let nextTheme = isThemeName(storedTheme) ? storedTheme : DEFAULT_THEME;
    try {
      const { preference } = await getThemePreference();
      if (preference) {
        nextMode = preference.mode;
        nextTheme = preference.theme;
        await Promise.all([
          setStoredSession(preferenceKey(THEME_MODE_KEY, userId), nextMode),
          setStoredSession(preferenceKey(THEME_NAME_KEY, userId), nextTheme),
        ]);
      }
    } catch {
      // The user-scoped cache keeps their choice available while the API is unreachable.
    }
    if (loadId !== preferenceLoad.current) return;
    activeMode = nextMode;
    activeTheme = nextTheme;
    setModeState(nextMode);
    setThemeState(nextTheme);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToSessionChanges((userId) => { void loadPreferences(userId); });
    void readSession().then((session) => loadPreferences(session?.user.id ?? null));
    return unsubscribe;
  }, [loadPreferences]);

  const value = useMemo<ThemeContextValue>(() => ({
    mode,
    theme,
    palette: transmuteThemes[theme][mode],
    setMode,
    setTheme,
    toggleMode,
  }), [mode, theme, setMode, setTheme, toggleMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTransmuteTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTransmuteTheme must be used inside TransmuteThemeProvider.");
  return value;
}

const lightColorTokens: Record<string, keyof TransmutePalette> = {
  "#F4EFE7": "surface", "#FBF7F0": "raised", "#101015": "ink", "#222328": "body", "#2C2C31": "charcoal", "#5F5752": "muted", "#655D57": "muted", "#81776D": "mutedSoft", "#8A817A": "mutedSoft", "#9A9189": "mutedSoft", "#D4C9B9": "divider", "#DED4C6": "divider", "#E8DED2": "raised", "#EEE8DF": "raised", "#642D2A": "oxide", "#742F2A": "oxide", "#A95B5B": "oxideMuted", "#A33B36": "destructive", "#667798": "steel", "#6A7CA0": "steelMuted", "#C8A850": "gold", "#B68A36": "gold", "#E8D194": "goldSoft",
};

function resolveStyleValue(value: unknown, palette: TransmutePalette): unknown {
  if (typeof value === "string") return lightColorTokens[value.toUpperCase()] ? palette[lightColorTokens[value.toUpperCase()]] : value;
  if (Array.isArray(value)) return value.map((item) => resolveStyleValue(item, palette));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, resolveStyleValue(item, palette)]));
  return value;
}

export function themedStyles<T extends Record<string, unknown>>(styles: T, palette: TransmutePalette): T {
  return resolveStyleValue(styles, palette) as T;
}

export function createThemedStyleProxy<T extends Record<string, unknown>>(lightStyles: T): T {
  let cachedSignature: string | null = null;
  let cachedStyles = lightStyles;
  return new Proxy(lightStyles, {
    get: (_target, property) => {
      const signature = `${activeTheme}-${activeMode}`;
      if (cachedSignature !== signature) {
        cachedSignature = signature;
        cachedStyles = themedStyles(lightStyles, activePalette());
      }
      return cachedStyles[property as keyof T];
    },
  });
}

export function createPaletteProxy(): TransmutePalette {
  return new Proxy(transmuteThemes.transmute.light, {
    get: (_target, property) => activePalette()[property as keyof TransmutePalette],
  }) as TransmutePalette;
}

export function useTransmuteStyles<T extends Record<string, unknown>>(styles: T) {
  const { palette } = useTransmuteTheme();
  return useMemo(() => themedStyles(styles, palette), [styles, palette]);
}
