import * as fs from "node:fs";
import { ensureBaseDirs, SETTINGS_PATH } from "./paths";
import { describeLocale, validateLocale } from "./calendar";
import { formatHours } from "./output";

export interface Settings {
  weeklyHours: number;
  localeRaw: string;
  workweekRaw: string;
  workweekStart: number;
  workweekEnd: number;
  workdaysPerWeek: number;
}

export interface SettingsPatch {
  weeklyHours?: number;
  localeRaw?: string;
  workweekRaw?: string;
}

const WEEKDAY_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const WEEKDAY_TOKEN_TO_INDEX: Record<string, number> = {
  su: 0,
  mo: 1,
  tu: 2,
  we: 3,
  th: 4,
  fr: 5,
  sa: 6,
};

export function printSettingsChanges(
  patch: SettingsPatch,
  settings: Settings,
): void {
  if (patch.weeklyHours !== undefined) {
    console.log(
      `Set work hours per week to ${formatHours(settings.weeklyHours)}.`,
    );
  }
  if (patch.localeRaw !== undefined) {
    const label = describeLocale(settings.localeRaw);
    console.log(`Set locale to ${label}.`);
  }
  if (patch.workweekRaw !== undefined) {
    console.log(`Set workweek to ${describeWorkweek(settings)}.`);
  }
}

export function describeWorkweek(settings: Settings): string {
  const startName = WEEKDAY_FULL[settings.workweekStart];
  const endName = WEEKDAY_FULL[settings.workweekEnd];
  return `${startName} - ${endName}`;
}

export function upsertSettings(
  existing: Settings | null,
  patch: SettingsPatch,
): Settings {
  const weeklyHours = patch.weeklyHours ?? existing?.weeklyHours;
  const localeRaw = patch.localeRaw ?? existing?.localeRaw;
  const workweekRaw = patch.workweekRaw ?? existing?.workweekRaw;

  if (
    weeklyHours === undefined ||
    localeRaw === undefined ||
    workweekRaw === undefined
  ) {
    throw new Error(
      "Missing settings values. For first-time setup provide all: -h, -l, and -ww.",
    );
  }

  if (!Number.isFinite(weeklyHours) || weeklyHours <= 0) {
    throw new Error("Invalid weekly hours. Use a positive number.");
  }

  const workweek = parseWorkweekRange(workweekRaw);
  if (!workweek) {
    throw new Error(
      "Invalid workweek. Use a contiguous range like mo-fr or mo-su.",
    );
  }

  validateLocale(localeRaw);
  ensureBaseDirs();

  const settings: Settings = {
    weeklyHours,
    localeRaw,
    workweekRaw: workweek.normalized,
    workweekStart: workweek.start,
    workweekEnd: workweek.end,
    workdaysPerWeek: countWorkdays(workweek.start, workweek.end),
  };

  const lines = [
    `weekly_hours=${settings.weeklyHours}`,
    `locale=${settings.localeRaw}`,
    `workweek=${settings.workweekRaw}`,
  ];
  fs.writeFileSync(SETTINGS_PATH, `${lines.join("\n")}\n`, "utf8");
  return settings;
}

export function readSettings(): Settings | null {
  if (!fs.existsSync(SETTINGS_PATH)) {
    return null;
  }

  const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
  const map = new Map<string, string>();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim().toLowerCase();
    const value = trimmed.slice(idx + 1).trim();
    map.set(key, value);
  }

  const hoursRaw = map.get("weekly_hours") ?? map.get("hours");
  const localeRaw = map.get("locale") ?? map.get("holiday_locale");
  const workweekRaw = map.get("workweek");
  if (!hoursRaw || !localeRaw || !workweekRaw) {
    throw new Error(
      `Settings file at ${SETTINGS_PATH} is missing required keys.`,
    );
  }

  const weeklyHours = Number(hoursRaw);
  if (!Number.isFinite(weeklyHours) || weeklyHours <= 0) {
    throw new Error(`Invalid weekly_hours in ${SETTINGS_PATH}.`);
  }

  const workweek = parseWorkweekRange(workweekRaw);
  if (!workweek) {
    throw new Error(`Invalid workweek in ${SETTINGS_PATH}.`);
  }

  validateLocale(localeRaw);

  return {
    weeklyHours,
    localeRaw,
    workweekRaw: workweek.normalized,
    workweekStart: workweek.start,
    workweekEnd: workweek.end,
    workdaysPerWeek: countWorkdays(workweek.start, workweek.end),
  };
}

function parseWorkweekRange(
  raw: string,
): { start: number; end: number; normalized: string } | null {
  const match = raw
    .trim()
    .toLowerCase()
    .match(/^([a-z]{2})-([a-z]{2})$/);
  if (!match) {
    return null;
  }

  const start = WEEKDAY_TOKEN_TO_INDEX[match[1]];
  const end = WEEKDAY_TOKEN_TO_INDEX[match[2]];
  if (start === undefined || end === undefined) {
    return null;
  }

  return { start, end, normalized: `${match[1]}-${match[2]}` };
}

function countWorkdays(start: number, end: number): number {
  return ((end - start + 7) % 7) + 1;
}
