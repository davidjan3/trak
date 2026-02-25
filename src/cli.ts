#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const Holidays = require("date-holidays");

type Action = "save" | "week" | "month" | "all";
type ExportFormat = "csv" | "tsv";

interface Settings {
  weeklyHours: number;
  localeRaw: string;
  workweekRaw: string;
  workweekStart: number;
  workweekEnd: number;
  workdaysPerWeek: number;
}

interface SettingsPatch {
  weeklyHours?: number;
  localeRaw?: string;
  workweekRaw?: string;
}

interface ParsedArgs {
  settingsPatch: SettingsPatch;
  action?: Action;
  saveValues?: number[];
  dateArg?: string;
  offset?: number;
  exportOptions?: ExportOptions;
  help: boolean;
  errors: string[];
}

interface ExportOptions {
  enabled: boolean;
  format: ExportFormat;
  zeroEmpty: boolean;
  skipEmpty: boolean;
  skipNonWorkdays: boolean;
  skipHolidays: boolean;
  zeroHolidays: boolean;
}

interface PeriodContext {
  start: Date;
  end: Date;
  rows: RowInfo[];
  baselineDaily: number;
  loggedTotal: number;
  periodTarget: number;
  daysLeft: number;
  dynamicExpected: number;
}

interface RowInfo {
  date: Date;
  iso: string;
  label: string;
  isWorkday: boolean;
  isHoliday: boolean;
  holidayName?: string;
  holidayType?: string;
  isOptionalHoliday: boolean;
  hasBlockingHoliday: boolean;
  loggedHours?: number;
}

const BASE_DIR = path.join(os.homedir(), ".trak");
const SETTINGS_PATH = path.join(BASE_DIR, "settings.ini");
const DATA_DIR = path.join(BASE_DIR, "data");
const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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
const MONTH_NAME_TO_INDEX: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};
const GRAY = "\x1b[90m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const WHITE = "\x1b[37m";
const RESET = "\x1b[0m";

main();

function main(): void {
  try {
    const argv = process.argv.slice(2);
    if (argv.length === 0) {
      printUsage();
      return;
    }

    const parsed = parseArgs(argv);
    if (parsed.help) {
      printUsage();
      return;
    }

    if (parsed.errors.length > 0) {
      for (const message of parsed.errors) {
        console.error(errorText(`Error: ${message}`));
      }
      console.error("");
      printUsage();
      process.exitCode = 1;
      return;
    }

    const hasSettingsPatch = Object.keys(parsed.settingsPatch).length > 0;
    let settings = readSettings();
    const hadSettingsBefore = settings !== null;

    if (hasSettingsPatch) {
      settings = upsertSettings(settings, parsed.settingsPatch);
      printSettingsChanges(parsed.settingsPatch, settings);
      console.log(
        `${hadSettingsBefore ? "Updated" : "Created"} settings at ${SETTINGS_PATH}`,
      );
    }

    if (!parsed.action) {
      if (!hasSettingsPatch) {
        printUsage();
      }
      return;
    }

    if (!settings) {
      throw new Error(
        `Settings file not found at ${SETTINGS_PATH}. Set it first with -h/-l/-ww.`,
      );
    }

    switch (parsed.action) {
      case "save":
        runSave(parsed, settings);
        break;
      case "week":
        runReport("week", parsed, settings);
        break;
      case "month":
        runReport("month", parsed, settings);
        break;
      case "all":
        runAll(settings);
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(errorText(`Error: ${message}`));
    process.exitCode = 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const errors: string[] = [];
  const parsed: ParsedArgs = {
    settingsPatch: {},
    help: false,
    errors,
  };

  let saveRaw: string | undefined;
  const exportOptions: ExportOptions = {
    enabled: false,
    format: "tsv",
    zeroEmpty: false,
    skipEmpty: false,
    skipNonWorkdays: false,
    skipHolidays: false,
    zeroHolidays: false,
  };
  let usedExportModifier = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    switch (token) {
      case "-h":
      case "-hours": {
        const value = readFlagValue(argv, token, i, errors);
        if (value === undefined) {
          break;
        }
        i += 1;
        const hours = Number(value);
        if (!Number.isFinite(hours) || hours <= 0) {
          errors.push(`${token} expects a positive number.`);
          break;
        }
        parsed.settingsPatch.weeklyHours = hours;
        break;
      }

      case "-l":
      case "-locale": {
        const value = readFlagValue(argv, token, i, errors);
        if (value === undefined) {
          break;
        }
        i += 1;
        parsed.settingsPatch.localeRaw = value;
        break;
      }

      case "-ww":
      case "-workweek": {
        const value = readFlagValue(argv, token, i, errors);
        if (value === undefined) {
          break;
        }
        i += 1;
        parsed.settingsPatch.workweekRaw = value;
        break;
      }

      case "-s":
      case "-save": {
        if (parsed.action) {
          errors.push(
            `Only one action is allowed. Already set: ${parsed.action}.`,
          );
          break;
        }
        const value = readFlagValue(argv, token, i, errors);
        if (value === undefined) {
          break;
        }
        i += 1;
        parsed.action = "save";
        saveRaw = value;
        break;
      }

      case "-w":
      case "-week": {
        if (parsed.action) {
          errors.push(
            `Only one action is allowed. Already set: ${parsed.action}.`,
          );
          break;
        }
        parsed.action = "week";
        break;
      }

      case "-m":
      case "-month": {
        if (parsed.action) {
          errors.push(
            `Only one action is allowed. Already set: ${parsed.action}.`,
          );
          break;
        }
        parsed.action = "month";
        break;
      }

      case "-a":
      case "-all": {
        if (parsed.action) {
          errors.push(
            `Only one action is allowed. Already set: ${parsed.action}.`,
          );
          break;
        }
        parsed.action = "all";
        break;
      }

      case "-d":
      case "-date": {
        const value = readFlagValue(argv, token, i, errors);
        if (value === undefined) {
          break;
        }
        i += 1;
        parsed.dateArg = value;
        break;
      }

      case "-o":
      case "-offset": {
        const value = readFlagValue(argv, token, i, errors, true);
        if (value === undefined) {
          break;
        }
        i += 1;
        if (!/^-?\d+$/.test(value)) {
          errors.push(`${token} expects an integer.`);
          break;
        }
        parsed.offset = Number(value);
        break;
      }

      case "-x": {
        exportOptions.enabled = true;
        const maybeFormat = argv[i + 1];
        if (maybeFormat !== undefined && !maybeFormat.startsWith("-")) {
          const format = parseExportFormat(maybeFormat);
          if (!format) {
            errors.push(`${token} expects optional format "csv" or "tsv".`);
          } else {
            exportOptions.format = format;
          }
          i += 1;
        }
        break;
      }

      case "-zero-empty":
      case "-ze":
        usedExportModifier = true;
        exportOptions.zeroEmpty = true;
        break;

      case "-skip-empty":
      case "-se":
        usedExportModifier = true;
        exportOptions.skipEmpty = true;
        break;

      case "-skip-nonworkdays":
      case "-sn":
        usedExportModifier = true;
        exportOptions.skipNonWorkdays = true;
        break;

      case "-skip-holidays":
      case "-sh":
        usedExportModifier = true;
        exportOptions.skipHolidays = true;
        break;

      case "-zero-holidays":
      case "-zh":
        usedExportModifier = true;
        exportOptions.zeroHolidays = true;
        break;

      case "--help":
      case "-help":
      case "-?":
        parsed.help = true;
        break;

      default:
        errors.push(`Unknown flag or argument: ${token}`);
        break;
    }
  }

  if (parsed.action === "save") {
    if (!saveRaw) {
      errors.push("Missing value for -s/-save.");
    } else {
      const values = parseSaveValues(saveRaw);
      if (!values) {
        errors.push(
          "-s/-save expects a number or comma-separated non-negative numbers.",
        );
      } else {
        parsed.saveValues = values;
      }
    }
  }

  if (
    !parsed.action &&
    (parsed.dateArg !== undefined || parsed.offset !== undefined)
  ) {
    errors.push("-d/-date and -o/-offset can only be used with -s/-w/-m.");
  }
  if (
    parsed.action === "all" &&
    (parsed.dateArg !== undefined || parsed.offset !== undefined)
  ) {
    errors.push("-a/-all does not use -d/-date or -o/-offset.");
  }

  const usedExportFlags = exportOptions.enabled || usedExportModifier;
  if (usedExportModifier && !exportOptions.enabled) {
    errors.push("Export modifiers require -x.");
  }
  if (
    usedExportFlags &&
    parsed.action !== "week" &&
    parsed.action !== "month"
  ) {
    errors.push("Export flags can only be used with -w/-m.");
  }
  if (exportOptions.enabled) {
    parsed.exportOptions = exportOptions;
  }

  return parsed;
}

function readFlagValue(
  argv: string[],
  flag: string,
  currentIndex: number,
  errors: string[],
  allowDashValue = false,
): string | undefined {
  const next = argv[currentIndex + 1];
  if (next === undefined) {
    errors.push(`Missing value for ${flag}.`);
    return undefined;
  }
  if (!allowDashValue && next.startsWith("-")) {
    errors.push(`Missing value for ${flag}.`);
    return undefined;
  }
  return next;
}

function parseSaveValues(raw: string): number[] | null {
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return null;
  }
  const values: number[] = [];
  for (const part of parts) {
    const numberValue = Number(part);
    if (!Number.isFinite(numberValue) || numberValue < 0) {
      return null;
    }
    values.push(numberValue);
  }
  return values;
}

function parseExportFormat(raw: string): ExportFormat | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "csv" || normalized === "tsv") {
    return normalized;
  }
  return null;
}

function printUsage(): void {
  console.log("Usage");
  console.log("  Configuration: trak -h <hours> -l <locale> -ww <workweek>");
  console.log(
    "  Logging:       trak -s <hours|h1,h2,...> [-d <date>] [-o <offset>]",
  );
  console.log("  Reporting:     trak -w [-d <week|date>] [-o <offset>]");
  console.log("                 trak -m [-d <month|date>] [-o <offset>]");
  console.log(
    "  Export:        trak -w|-m -x [csv|tsv] [flags] [-d <date>] [-o <offset>]",
  );
  console.log("                 format default: tsv");
  console.log(
    "                 flags: -zero-empty|-ze -skip-empty|-se -skip-nonworkdays|-sn -skip-holidays|-sh -zero-holidays|-zh",
  );
  console.log("                 trak -a");
  console.log("");
  console.log("Date formats");
  console.log("  Save: YYYY-MM-DD | DD.MM.YYYY | DD.MM. | MM/DD/YYYY | MM/DD");
  console.log(
    "  Week: ISO week number (1..53) | YYYY-MM-DD | DD.MM.YYYY | DD.MM. | MM/DD/YYYY | MM/DD",
  );
  console.log(
    "  Month: month name (English) | 1..12 | MM.YYYY | YYYY-MM-DD | DD.MM.YYYY | DD.MM. | MM/DD/YYYY | MM/DD",
  );
  console.log("");
  console.log("Examples");
  console.log(
    "  trak -h 40 -l de-rp -ww mo-fr          # create or update settings",
  );
  console.log("  trak -s 7.5                            # log 7.5h for today");
  console.log(
    "  trak -s 8 -d 25.02.                    # log 8h on 25 Feb (current year)",
  );
  console.log(
    "  trak -s 8 -d 02/25                     # log 8h on Feb 25 (current year, US format)",
  );
  console.log(
    "  trak -s 8 -o -1                        # log 8h for yesterday",
  );
  console.log(
    "  trak -s 0 -d 25.02.                    # clear entry on 25 Feb (current year)",
  );
  console.log(
    "  trak -s 8,7.5,6 -d 2026-12-24          # log across next valid workdays",
  );
  console.log(
    "  trak -w                                # show current week report",
  );
  console.log(
    "  trak -w -o -1                          # show previous week report",
  );
  console.log(
    "  trak -w -d 8                           # show ISO week 8 (current year)",
  );
  console.log(
    "  trak -m                                # show current month report",
  );
  console.log(
    "  trak -m -d February                    # show February report (current year)",
  );
  console.log(
    "  trak -w -x                             # export current week as TSV and copy",
  );
  console.log(
    "  trak -m -x csv -ze                     # export month as CSV, zeros for empty days",
  );
  console.log(
    "  trak -m -x tsv -sh -zh                # skip blocking holidays (skip wins over zero)",
  );
  console.log(
    "  trak -a                                # show all logged entries",
  );
}

function printSettingsChanges(patch: SettingsPatch, settings: Settings): void {
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

function describeWorkweek(settings: Settings): string {
  const startName = WEEKDAY_FULL[settings.workweekStart];
  const endName = WEEKDAY_FULL[settings.workweekEnd];
  return `${startName} - ${endName}`;
}

function upsertSettings(
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

function readSettings(): Settings | null {
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

function validateLocale(localeRaw: string): void {
  const parts = parseLocaleParts(localeRaw);
  try {
    const hd = new Holidays(parts[0], parts[1], parts[2]);
    if (!hd || typeof hd.isHoliday !== "function") {
      throw new Error("Holiday engine unavailable for locale.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid locale "${localeRaw}": ${message}`);
  }
}

function describeLocale(localeRaw: string): string {
  const [country, region, subregion] = parseLocaleParts(localeRaw);
  const fallback = localeRaw.toLowerCase();

  try {
    const hd = new Holidays(country, region, subregion);
    const language = country === "DE" ? "de" : "en";
    const countryName =
      readCountryName(hd, country, language) ??
      readCountryName(hd, country, "en") ??
      country;
    const segments = [countryName];

    if (region) {
      const regionName =
        readStateName(hd, country, region, language) ??
        readStateName(hd, country, region, "en") ??
        region;
      segments.push(regionName);
    }

    if (subregion) {
      const subregionName =
        readRegionName(hd, country, region, subregion, language) ??
        readRegionName(hd, country, region, subregion, "en") ??
        subregion;
      segments.push(subregionName);
    }

    return `${segments.join(" / ")} (${fallback})`;
  } catch {
    return fallback;
  }
}

function readCountryName(
  engine: any,
  country: string,
  language: string,
): string | undefined {
  if (typeof engine.getCountries !== "function") {
    return undefined;
  }
  const countries = engine.getCountries(language);
  if (!countries || typeof countries !== "object") {
    return undefined;
  }
  return countries[country];
}

function readStateName(
  engine: any,
  country: string,
  state: string,
  language: string,
): string | undefined {
  if (typeof engine.getStates !== "function") {
    return undefined;
  }
  const states = engine.getStates(country, language);
  if (!states || typeof states !== "object") {
    return undefined;
  }
  return states[state];
}

function readRegionName(
  engine: any,
  country: string,
  state: string | undefined,
  region: string,
  language: string,
): string | undefined {
  if (!state || typeof engine.getRegions !== "function") {
    return undefined;
  }
  const regions = engine.getRegions(country, state, language);
  if (!regions || typeof regions !== "object") {
    return undefined;
  }
  return regions[region];
}

function parseLocaleParts(localeRaw: string): [string, string?, string?] {
  const parts = localeRaw
    .split("-")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => part.toUpperCase());

  if (parts.length < 1 || parts.length > 3) {
    throw new Error(
      `Locale "${localeRaw}" must be "country", "country-region", or "country-region-subregion".`,
    );
  }

  return [parts[0], parts[1], parts[2]];
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

function isWorkday(dayOfWeek: number, settings: Settings): boolean {
  if (settings.workweekStart <= settings.workweekEnd) {
    return (
      dayOfWeek >= settings.workweekStart && dayOfWeek <= settings.workweekEnd
    );
  }
  return (
    dayOfWeek >= settings.workweekStart || dayOfWeek <= settings.workweekEnd
  );
}

function createHolidayEngine(settings: Settings): any {
  const [country, region, subregion] = parseLocaleParts(settings.localeRaw);
  return new Holidays(country, region, subregion);
}

function getHolidayInfo(
  engine: any,
  date: Date,
): {
  isHoliday: boolean;
  name?: string;
  type?: string;
  isOptionalHoliday: boolean;
  hasBlockingHoliday: boolean;
} {
  const value = engine.isHoliday(date);
  if (!value) {
    return {
      isHoliday: false,
      isOptionalHoliday: false,
      hasBlockingHoliday: false,
    };
  }

  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0) {
    return {
      isHoliday: false,
      isOptionalHoliday: false,
      hasBlockingHoliday: false,
    };
  }

  const normalized = list
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const type = normalizeHolidayType(item.type);
      const optional = isOptionalHolidayType(type);
      return {
        name: item.name ?? item.localName ?? "Holiday",
        type,
        optional,
      };
    });

  if (normalized.length === 0) {
    return {
      isHoliday: true,
      name: "Holiday",
      type: "holiday",
      isOptionalHoliday: false,
      hasBlockingHoliday: true,
    };
  }

  const blocking = normalized.find((item) => !item.optional);
  const primary = blocking ?? normalized[0];
  const optionalOnly = normalized.every((item) => item.optional);

  return {
    isHoliday: true,
    name: primary.name,
    type: primary.type,
    isOptionalHoliday: optionalOnly,
    hasBlockingHoliday: !optionalOnly,
  };
}

function normalizeHolidayType(rawType: unknown): string {
  if (typeof rawType !== "string" || rawType.trim().length === 0) {
    return "holiday";
  }
  return rawType.trim().toLowerCase();
}

function isOptionalHolidayType(type: string): boolean {
  return type === "optional" || type === "observance";
}

function runSave(parsed: ParsedArgs, settings: Settings): void {
  if (!parsed.saveValues || parsed.saveValues.length === 0) {
    throw new Error("No values provided for -s/-save.");
  }

  const offset = parsed.offset ?? 0;
  const anchor = resolveSaveAnchor(parsed.dateArg, offset);
  const holidayEngine = createHolidayEngine(settings);

  if (parsed.saveValues.length === 1) {
    const target = anchor;
    const value = parsed.saveValues[0];
    const workday = isWorkday(target.getDay(), settings);
    const holiday = getHolidayInfo(holidayEngine, target);

    if (!workday && value > 0) {
      console.warn(
        warningText(
          `Warning: ${formatIsoDate(target)} is outside workweek ${describeWorkweek(settings)}.`,
        ),
      );
    }
    if (holiday.hasBlockingHoliday && value > 0) {
      const suffix = holiday.name ? ` (${holiday.name})` : "";
      const kind = holiday.type ?? "holiday";
      console.warn(
        warningText(
          `Warning: ${formatIsoDate(target)} is a ${kind} holiday${suffix}.`,
        ),
      );
    }

    applySaveValue(target, value);
    return;
  }

  let cursor = anchor;
  for (const hours of parsed.saveValues) {
    let guard = 0;
    while (true) {
      const workday = isWorkday(cursor.getDay(), settings);
      const holiday = getHolidayInfo(holidayEngine, cursor);
      if (workday && !holiday.hasBlockingHoliday) {
        break;
      }
      cursor = addDays(cursor, 1);
      guard += 1;
      if (guard > 3700) {
        throw new Error(
          "Unable to find eligible workday while processing -s values.",
        );
      }
    }

    applySaveValue(cursor, hours);
    cursor = addDays(cursor, 1);
  }
}

function applySaveValue(date: Date, value: number): void {
  if (value === 0) {
    const oldValue = clearEntry(date);
    printClearResult(date, oldValue);
    return;
  }
  const oldValue = writeEntry(date, value);
  printWriteResult(date, value, oldValue);
}

function printWriteResult(
  date: Date,
  newValue: number,
  oldValue: number | undefined,
): void {
  const iso = formatIsoDate(date);
  if (oldValue === undefined) {
    console.log(`Saved ${formatHours(newValue)}h on ${iso}.`);
    return;
  }
  console.log(
    `Updated ${iso}: ${formatHours(oldValue)}h -> ${formatHours(newValue)}h.`,
  );
}

function printClearResult(date: Date, oldValue: number | undefined): void {
  const iso = formatIsoDate(date);
  if (oldValue === undefined) {
    console.log(`No entry to clear on ${iso}.`);
    return;
  }
  console.log(`Cleared ${formatHours(oldValue)}h entry on ${iso}.`);
}

function runReport(
  action: "week" | "month",
  parsed: ParsedArgs,
  settings: Settings,
): void {
  const context = buildPeriodContext(action, parsed, settings);
  if (parsed.exportOptions?.enabled) {
    runExport(parsed.exportOptions, context.rows, context.baselineDaily);
    return;
  }

  const {
    start,
    end,
    rows,
    baselineDaily,
    loggedTotal,
    periodTarget,
    daysLeft,
    dynamicExpected,
  } = context;
  const hoursLeft = periodTarget - loggedTotal;

  const title =
    action === "week"
      ? `Week ${formatIsoDate(start)} to ${formatIsoDate(end)}`
      : `Month ${start.getFullYear()}-${pad(start.getMonth() + 1)}`;
  console.log(title);
  console.log("");

  const dayWidth = Math.max(
    "Day".length,
    ...rows.map((row) => row.label.length),
  );

  console.log(`${"Day".padEnd(dayWidth)}  Hours`);
  console.log(`${"-".repeat(dayWidth)}  -----`);

  for (const row of rows) {
    let value: number;
    let expected = false;

    if (row.loggedHours !== undefined) {
      value = row.loggedHours;
    } else {
      expected = true;
      if (!row.isWorkday) {
        value = 0;
      } else if (row.hasBlockingHoliday) {
        value = baselineDaily;
      } else {
        value = dynamicExpected;
      }
    }

    const valueText = formatHours(value);
    const paddedLabel = row.label.padEnd(dayWidth);

    const rowColor = getRowColor(row);
    const holidayNameColor = getHolidayNameColor(row);
    const renderedLabel = renderDayLabel(
      paddedLabel,
      row.holidayName,
      rowColor,
      holidayNameColor,
    );
    const renderedValue = rowColor
      ? colorText(valueText, rowColor)
      : expected
        ? grayText(valueText)
        : valueText;

    console.log(`${renderedLabel}  ${renderedValue}`);
  }

  console.log("");
  console.log(`Total logged: ${formatHours(loggedTotal)}`);
  console.log(`Hours left: ${formatHours(hoursLeft)}`);
  console.log(
    `Expected/day (remaining): ${daysLeft > 0 ? formatHours(dynamicExpected) : "n/a"}`,
  );
  if (action === "week") {
    console.log(
      warningText(
        "Warning: Estimates are based on weekly hours only. Use -m for monthly estimates.",
      ),
    );
  }
}

function buildPeriodContext(
  action: "week" | "month",
  parsed: ParsedArgs,
  settings: Settings,
): PeriodContext {
  const offset = parsed.offset ?? 0;
  const anchor =
    action === "week"
      ? resolveWeekAnchor(parsed.dateArg, offset)
      : resolveMonthAnchor(parsed.dateArg, offset);

  const start =
    action === "week" ? getIsoWeekStart(anchor) : firstDayOfMonth(anchor);
  const end = action === "week" ? addDays(start, 6) : lastDayOfMonth(anchor);
  const holidayEngine = createHolidayEngine(settings);
  const entries = readEntriesInRange(start, end);

  const baselineDaily = settings.weeklyHours / settings.workdaysPerWeek;
  const rows: RowInfo[] = [];

  let loggedTotal = 0;
  let periodTarget = 0;

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const date = stripTime(cursor);
    const iso = formatIsoDate(date);
    const holiday = getHolidayInfo(holidayEngine, date);
    const workday = isWorkday(date.getDay(), settings);
    const loggedHours = entries.get(iso);

    const holidayLabel = holiday.isHoliday
      ? ` (${holiday.name ?? "Holiday"})`
      : "";
    const label = `${WEEKDAY_SHORT[date.getDay()]} ${iso}${holidayLabel}`;

    rows.push({
      date,
      iso,
      label,
      isWorkday: workday,
      isHoliday: holiday.isHoliday,
      holidayName: holiday.name,
      holidayType: holiday.type,
      isOptionalHoliday: holiday.isOptionalHoliday,
      hasBlockingHoliday: holiday.hasBlockingHoliday,
      loggedHours,
    });

    if (loggedHours !== undefined) {
      loggedTotal += loggedHours;
    }
    if (workday) {
      periodTarget += baselineDaily;
    }
  }

  const hoursLeft = periodTarget - loggedTotal;
  const daysLeft = rows.filter(
    (row) => row.loggedHours === undefined && row.isWorkday,
  ).length;
  const dynamicExpected = daysLeft > 0 ? hoursLeft / daysLeft : 0;

  return {
    start,
    end,
    rows,
    baselineDaily,
    loggedTotal,
    periodTarget,
    daysLeft,
    dynamicExpected,
  };
}

function runExport(
  options: ExportOptions,
  rows: RowInfo[],
  baselineDaily: number,
): void {
  const valuesLine = renderExportValues(rows, options, baselineDaily);
  const copied = tryCopyToClipboard(valuesLine);
  if (copied.success) {
    const viaSuffix = copied.method ? ` via ${copied.method}` : "";
    console.log(
      `Copied ${options.format.toUpperCase()} export to clipboard${viaSuffix}.`,
    );
  } else {
    console.log(
      warningText("Could not copy to clipboard. Export values are printed below."),
    );
  }
  console.log(valuesLine);
}

function renderExportValues(
  rows: RowInfo[],
  options: ExportOptions,
  baselineDaily: number,
): string {
  const values: string[] = [];
  const delimiter = options.format === "csv" ? "," : "\t";

  for (const row of rows) {
    const value = renderExportValue(row, options, baselineDaily);
    if (value !== undefined) {
      values.push(value);
    }
  }

  return values.join(delimiter);
}

function renderExportValue(
  row: RowInfo,
  options: ExportOptions,
  baselineDaily: number,
): string | undefined {
  if (row.loggedHours !== undefined) {
    return formatHours(row.loggedHours);
  }

  if (!row.isWorkday) {
    if (options.skipNonWorkdays) {
      return undefined;
    }
    return renderEmptyExportValue(options);
  }

  if (row.hasBlockingHoliday) {
    if (options.skipHolidays) {
      return undefined;
    }
    if (options.zeroHolidays) {
      return "0";
    }
    return formatHours(baselineDaily);
  }

  return renderEmptyExportValue(options);
}

function renderEmptyExportValue(options: ExportOptions): string | undefined {
  if (options.skipEmpty) {
    return undefined;
  }
  if (options.zeroEmpty) {
    return "0";
  }
  return "";
}

function tryCopyToClipboard(
  value: string,
): { success: boolean; method?: string } {
  if (process.platform === "darwin") {
    return runClipboardCommand("pbcopy", [], value, "pbcopy");
  }
  if (process.platform === "win32") {
    return runClipboardCommand("cmd", ["/c", "clip"], value, "clip");
  }
  if (process.platform === "linux") {
    const attempts = [
      runClipboardCommand("wl-copy", [], value, "wl-copy"),
      runClipboardCommand(
        "xclip",
        ["-selection", "clipboard"],
        value,
        "xclip",
      ),
      runClipboardCommand("xsel", ["--clipboard", "--input"], value, "xsel"),
    ];
    return attempts.find((attempt) => attempt.success) ?? { success: false };
  }
  return { success: false };
}

function runClipboardCommand(
  command: string,
  args: string[],
  value: string,
  method: string,
): { success: boolean; method?: string } {
  const result = spawnSync(command, args, {
    input: value,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    return { success: false };
  }
  return { success: true, method };
}

function runAll(settings: Settings): void {
  const entries = readAllEntries();
  const holidayEngine = createHolidayEngine(settings);
  const rows: RowInfo[] = [];
  let totalHours = 0;

  for (const entry of entries) {
    const date = parseIsoDate(entry.iso);
    if (!date) {
      continue;
    }
    const holiday = getHolidayInfo(holidayEngine, date);
    const workday = isWorkday(date.getDay(), settings);
    const holidayLabel = holiday.isHoliday
      ? ` (${holiday.name ?? "Holiday"})`
      : "";
    const label = `${WEEKDAY_SHORT[date.getDay()]} ${entry.iso}${holidayLabel}`;

    rows.push({
      date,
      iso: entry.iso,
      label,
      isWorkday: workday,
      isHoliday: holiday.isHoliday,
      holidayName: holiday.name,
      holidayType: holiday.type,
      isOptionalHoliday: holiday.isOptionalHoliday,
      hasBlockingHoliday: holiday.hasBlockingHoliday,
      loggedHours: entry.hours,
    });
    totalHours += entry.hours;
  }

  console.log("All entries");
  console.log("");

  if (rows.length === 0) {
    console.log("No entries found.");
    return;
  }

  const dayWidth = Math.max(
    "Day".length,
    ...rows.map((row) => row.label.length),
  );
  console.log(`${"Day".padEnd(dayWidth)}  Hours`);
  console.log(`${"-".repeat(dayWidth)}  -----`);

  for (const row of rows) {
    const valueText = formatHours(row.loggedHours ?? 0);
    const paddedLabel = row.label.padEnd(dayWidth);
    const rowColor = getRowColor(row);
    const holidayNameColor = getHolidayNameColor(row);
    const renderedLabel = renderDayLabel(
      paddedLabel,
      row.holidayName,
      rowColor,
      holidayNameColor,
    );
    const renderedValue = rowColor ? colorText(valueText, rowColor) : valueText;
    console.log(`${renderedLabel}  ${renderedValue}`);
  }

  console.log("");
  console.log(`Total logged: ${formatHours(totalHours)}`);
}

function resolveSaveAnchor(dateArg: string | undefined, offset: number): Date {
  const base = dateArg ? parseSaveDateArg(dateArg) : today();
  if (!base) {
    throw new Error(
      `Invalid -d/-date for save: "${dateArg}". Use YYYY-MM-DD, DD.MM.YYYY, DD.MM., MM/DD/YYYY, or MM/DD.`,
    );
  }
  return addDays(base, offset);
}

function resolveWeekAnchor(dateArg: string | undefined, offset: number): Date {
  let base: Date;
  if (!dateArg) {
    base = today();
  } else if (/^\d{1,2}$/.test(dateArg.trim())) {
    const week = Number(dateArg.trim());
    const year = today().getFullYear();
    const maxWeeks = weeksInIsoYear(year);
    if (week < 1 || week > maxWeeks) {
      throw new Error(
        `Week number must be between 1 and ${maxWeeks} for ${year}.`,
      );
    }
    base = isoWeekStartFromYearWeek(year, week);
  } else {
    const parsedDate = parseWeekDateArg(dateArg);
    if (!parsedDate) {
      throw new Error(
        `Invalid -d/-date for week: "${dateArg}". Use week number, YYYY-MM-DD, DD.MM.YYYY, DD.MM., MM/DD/YYYY, or MM/DD.`,
      );
    }
    base = parsedDate;
  }
  return addDays(base, offset * 7);
}

function resolveMonthAnchor(dateArg: string | undefined, offset: number): Date {
  const base = dateArg ? parseMonthDateArg(dateArg) : today();
  if (!base) {
    throw new Error(
      `Invalid -d/-date for month: "${dateArg}". Use month name, 1..12, MM.YYYY, YYYY-MM-DD, DD.MM.YYYY, DD.MM., MM/DD/YYYY, or MM/DD.`,
    );
  }
  const monthStart = new Date(base.getFullYear(), base.getMonth(), 1);
  return new Date(monthStart.getFullYear(), monthStart.getMonth() + offset, 1);
}

function parseSaveDateArg(raw: string): Date | null {
  return (
    parseIsoDate(raw) ??
    parseDotDateFull(raw) ??
    parseDotDateNoYear(raw) ??
    parseSlashDateFull(raw) ??
    parseSlashDateNoYear(raw)
  );
}

function parseWeekDateArg(raw: string): Date | null {
  return (
    parseIsoDate(raw) ??
    parseDotDateFull(raw) ??
    parseDotDateNoYear(raw) ??
    parseSlashDateFull(raw) ??
    parseSlashDateNoYear(raw)
  );
}

function parseMonthDateArg(raw: string): Date | null {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  if (MONTH_NAME_TO_INDEX[lower] !== undefined) {
    return new Date(today().getFullYear(), MONTH_NAME_TO_INDEX[lower], 1);
  }

  if (/^\d{1,2}$/.test(trimmed)) {
    const month = Number(trimmed);
    if (month >= 1 && month <= 12) {
      return new Date(today().getFullYear(), month - 1, 1);
    }
  }

  const monthYear = parseMonthYear(trimmed);
  if (monthYear) {
    return new Date(monthYear.year, monthYear.month - 1, 1);
  }

  return (
    parseIsoDate(trimmed) ??
    parseDotDateFull(trimmed) ??
    parseDotDateNoYear(trimmed) ??
    parseSlashDateFull(trimmed) ??
    parseSlashDateNoYear(trimmed)
  );
}

function parseMonthYear(raw: string): { month: number; year: number } | null {
  const match = raw.match(/^(\d{1,2})\.(\d{4})$/);
  if (!match) {
    return null;
  }
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12) {
    return null;
  }
  return { month, year };
}

function parseIsoDate(raw: string): Date | null {
  const match = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return createDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function parseDotDateFull(raw: string): Date | null {
  const match = raw.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) {
    return null;
  }
  return createDate(Number(match[3]), Number(match[2]), Number(match[1]));
}

function parseDotDateNoYear(raw: string): Date | null {
  const match = raw.trim().match(/^(\d{1,2})\.(\d{1,2})\.?$/);
  if (!match) {
    return null;
  }
  const year = today().getFullYear();
  return createDate(year, Number(match[2]), Number(match[1]));
}

function parseSlashDateFull(raw: string): Date | null {
  const match = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return null;
  }
  return createDate(Number(match[3]), Number(match[1]), Number(match[2]));
}

function parseSlashDateNoYear(raw: string): Date | null {
  const match = raw.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) {
    return null;
  }
  const year = today().getFullYear();
  return createDate(year, Number(match[1]), Number(match[2]));
}

function createDate(
  year: number,
  monthOneBased: number,
  day: number,
): Date | null {
  if (monthOneBased < 1 || monthOneBased > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(year, monthOneBased - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthOneBased - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return stripTime(date);
}

function weeksInIsoYear(year: number): number {
  return isoWeekNumber(new Date(year, 11, 28));
}

function isoWeekStartFromYearWeek(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4);
  const week1Start = getIsoWeekStart(jan4);
  return addDays(week1Start, (week - 1) * 7);
}

function isoWeekNumber(date: Date): number {
  const d = stripTime(date);
  const dayNum = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayNum + 3);
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / 604800000);
}

function getIsoWeekStart(date: Date): Date {
  const d = stripTime(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function firstDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function lastDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function readEntriesInRange(start: Date, end: Date): Map<string, number> {
  const out = new Map<string, number>();
  if (!fs.existsSync(DATA_DIR)) {
    return out;
  }

  const startIso = formatIsoDate(start);
  const endIso = formatIsoDate(end);
  const startMonth = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);

  for (
    let cursor = startMonth;
    cursor <= endMonth;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  ) {
    const filePath = monthFilePath(cursor);
    const entries = readMonthEntries(filePath);
    for (const [dateIso, hours] of entries.entries()) {
      if (dateIso >= startIso && dateIso <= endIso) {
        out.set(dateIso, hours);
      }
    }
  }

  return out;
}

function writeEntry(date: Date, hours: number): number | undefined {
  ensureBaseDirs();
  const filePath = monthFilePath(date);
  const entries = readMonthEntries(filePath);
  const dateIso = formatIsoDate(date);
  const oldValue = entries.get(dateIso);
  entries.set(dateIso, hours);
  writeMonthEntries(filePath, entries);
  return oldValue;
}

function clearEntry(date: Date): number | undefined {
  ensureBaseDirs();
  const filePath = monthFilePath(date);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const entries = readMonthEntries(filePath);
  const dateIso = formatIsoDate(date);
  const oldValue = entries.get(dateIso);
  if (oldValue === undefined) {
    return undefined;
  }
  entries.delete(dateIso);
  writeMonthEntries(filePath, entries);
  return oldValue;
}

function readAllEntries(): Array<{ iso: string; hours: number }> {
  const out = new Map<string, number>();
  if (!fs.existsSync(DATA_DIR)) {
    return [];
  }

  const files = fs
    .readdirSync(DATA_DIR)
    .filter((name) => name.toLowerCase().endsWith(".csv"))
    .sort();

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const entries = readMonthEntries(filePath);
    for (const [iso, hours] of entries.entries()) {
      out.set(iso, hours);
    }
  }

  return Array.from(out.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([iso, hours]) => ({ iso, hours }));
}

function monthFilePath(date: Date): string {
  const year = date.getFullYear();
  const month = MONTH_ABBR[date.getMonth()];
  return path.join(DATA_DIR, `${year}_${month}.csv`);
}

function readMonthEntries(filePath: string): Map<string, number> {
  const entries = new Map<string, number>();
  if (!fs.existsSync(filePath)) {
    return entries;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.toLowerCase() === "date,hours") {
      continue;
    }

    const [dateIso, hoursRaw] = trimmed.split(",");
    if (!dateIso || !hoursRaw) {
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
      continue;
    }

    const hours = Number(hoursRaw);
    if (!Number.isFinite(hours)) {
      continue;
    }

    entries.set(dateIso, hours);
  }

  return entries;
}

function writeMonthEntries(
  filePath: string,
  entries: Map<string, number>,
): void {
  const rows = Array.from(entries.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const lines = [
    "date,hours",
    ...rows.map(([date, hours]) => `${date},${formatHours(hours)}`),
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function ensureBaseDirs(): void {
  fs.mkdirSync(BASE_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function today(): Date {
  return stripTime(new Date());
}

function stripTime(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const out = stripTime(date);
  out.setDate(out.getDate() + days);
  return out;
}

function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatHours(hours: number): string {
  if (Number.isInteger(hours)) {
    return String(hours);
  }
  return hours.toFixed(2).replace(/\.?0+$/, "");
}

function grayText(value: string): string {
  return colorText(value, "gray");
}

function colorText(
  value: string,
  color: "gray" | "green" | "yellow" | "red" | "white",
): string {
  if (!supportsColor()) {
    return value;
  }
  const code =
    color === "gray"
      ? GRAY
      : color === "green"
        ? GREEN
        : color === "yellow"
          ? YELLOW
          : color === "red"
            ? RED
            : WHITE;
  return `${code}${value}${RESET}`;
}

function warningText(value: string): string {
  return colorText(value, "yellow");
}

function errorText(value: string): string {
  return colorText(value, "red");
}

function supportsColor(): boolean {
  return Boolean(process.stdout.isTTY || process.stderr.isTTY);
}

function getRowColor(row: RowInfo): "green" | "yellow" | "white" | undefined {
  if (!row.isWorkday) {
    return "green";
  }
  if (row.hasBlockingHoliday) {
    return "yellow";
  }
  return undefined;
}

function getHolidayNameColor(row: RowInfo): "gray" | "yellow" | undefined {
  if (!row.isHoliday) {
    return undefined;
  }
  if (row.isOptionalHoliday) {
    return "gray";
  }
  if (row.hasBlockingHoliday) {
    return "yellow";
  }
  return undefined;
}

function renderDayLabel(
  label: string,
  holidayName: string | undefined,
  baseColor: "green" | "yellow" | "white" | undefined,
  holidayColor: "gray" | "yellow" | undefined,
): string {
  if (!holidayName || !holidayColor) {
    return baseColor ? colorText(label, baseColor) : label;
  }

  const holidayPart = ` (${holidayName})`;
  const idx = label.indexOf(holidayPart);
  if (idx < 0) {
    return baseColor ? colorText(label, baseColor) : label;
  }

  const before = label.slice(0, idx);
  const after = label.slice(idx + holidayPart.length);
  const renderedBefore = baseColor ? colorText(before, baseColor) : before;
  const renderedHoliday = colorText(holidayPart, holidayColor);
  const renderedAfter = baseColor ? colorText(after, baseColor) : after;
  return `${renderedBefore}${renderedHoliday}${renderedAfter}`;
}
