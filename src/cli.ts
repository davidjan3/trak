#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const Holidays = require("date-holidays");

type Action = "save" | "week" | "month" | "all" | "exportAll";
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
  tagFilters?: string[];
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
  decimalComma: boolean;
}

interface PeriodContext {
  start: Date;
  end: Date;
  rows: RowInfo[];
  baselineDaily: number;
  loggedTotal: number;
  hoursLeft: number;
  daysLeft: number;
  dynamicExpected: number;
  tagTotals: Map<string, number>;
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
  tagSummary?: string;
  loggedHours?: number;
}

interface EntryItem {
  hours: number;
  tags: string[];
}

interface EntryRecord {
  items: EntryItem[];
}

interface AllEntryRecord extends EntryRecord {
  iso: string;
}

const BASE_DIR = process.env.TRAK_HOME ?? path.join(os.homedir(), ".trak");
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
        runAll(parsed, settings);
        break;
      case "exportAll":
        runExportAll(parsed, settings);
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
  let tagRaw: string | undefined;
  let usedTagFlag = false;
  const exportOptions: ExportOptions = {
    enabled: false,
    format: "tsv",
    zeroEmpty: false,
    skipEmpty: false,
    skipNonWorkdays: false,
    skipHolidays: false,
    zeroHolidays: false,
    decimalComma: false,
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
        const value = readSaveFlagValue(argv, token, i, errors);
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

      case "-tag":
      case "-t": {
        usedTagFlag = true;
        const maybeValue = argv[i + 1];
        if (maybeValue !== undefined && !maybeValue.startsWith("-")) {
          tagRaw = maybeValue;
          i += 1;
        }
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

      case "-decimal-comma":
      case "-dc":
        usedExportModifier = true;
        exportOptions.decimalComma = true;
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

  if (usedTagFlag && tagRaw === undefined) {
    parsed.tagFilters = [];
  } else if (tagRaw !== undefined) {
    const tags = parseTags(tagRaw);
    if (!tags) {
      errors.push("-t/-tag expects non-empty comma-separated tags.");
    } else {
      parsed.tagFilters = tags;
    }
  }

  if (exportOptions.enabled) {
    parsed.exportOptions = exportOptions;
    if (!parsed.action || parsed.action === "all") {
      parsed.action = "exportAll";
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
  if (
    parsed.action === "exportAll" &&
    (parsed.dateArg !== undefined || parsed.offset !== undefined)
  ) {
    errors.push("-x export-all does not use -d/-date or -o/-offset.");
  }

  const usedExportFlags = exportOptions.enabled || usedExportModifier;
  if (usedExportModifier && !exportOptions.enabled) {
    errors.push("Export modifiers require -x.");
  }
  if (
    usedExportFlags &&
    parsed.action !== "week" &&
    parsed.action !== "month" &&
    parsed.action !== "exportAll"
  ) {
    errors.push("Export flags can only be used with -w/-m/-x.");
  }
  if (
    parsed.tagFilters &&
    parsed.action !== "save" &&
    parsed.action !== "week" &&
    parsed.action !== "month" &&
    parsed.action !== "all" &&
    parsed.action !== "exportAll"
  ) {
    errors.push("-t/-tag can only be used with -s/-w/-m/-a/-x.");
  }

  return parsed;
}

function readSaveFlagValue(
  argv: string[],
  flag: string,
  currentIndex: number,
  errors: string[],
): string | undefined {
  const next = argv[currentIndex + 1];
  if (next !== undefined && /^-\d/.test(next)) {
    return next;
  }
  return readFlagValue(argv, flag, currentIndex, errors);
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

function parseTags(raw: string): string[] | null {
  const parts = raw.split(",");
  if (parts.length === 0) {
    return null;
  }

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const part of parts) {
    const normalized = part.trim().toLowerCase();
    if (normalized.length === 0 || normalized.includes("|")) {
      return null;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      tags.push(normalized);
    }
  }

  return tags.length > 0 ? tags : null;
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
    "  Logging:       trak -s <hours|h1,h2,...> [-t [tag|t1,t2,...]] [-d <date>] [-o <offset>]",
  );
  console.log(
    "  Reporting:     trak -w [-t [tag|t1,t2,...]] [-d <week|date>] [-o <offset>]",
  );
  console.log(
    "                 trak -m [-t [tag|t1,t2,...]] [-d <month|date>] [-o <offset>]",
  );
  console.log(
    "  Export:        trak -w|-m -x [csv|tsv] [flags] [-t [tag|t1,t2,...]] [-d <date>] [-o <offset>]",
  );
  console.log(
    "                 trak -x [csv|tsv] [flags] [-t [tag|t1,t2,...]]",
  );
  console.log("                 format default: tsv");
  console.log(
    "                 flags: -zero-empty|-ze -skip-empty|-se -skip-nonworkdays|-sn -skip-holidays|-sh -zero-holidays|-zh -decimal-comma|-dc",
  );
  console.log("  All:           trak -a [-t [tag|t1,t2,...]]");
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
    "  trak -s 8 -t client                    # log 8h for today tagged \"client\"",
  );
  console.log(
    "  trak -s 8 -t                           # log 8h untagged, replacing selected day(s)",
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
    "  trak -t ai -d 01.07. -s 3,2,6          # log tagged hours across workdays",
  );
  console.log(
    "  trak -s 8,7.5 -t client,meeting        # apply both tags to each saved entry",
  );
  console.log(
    "  trak -w                                # show current week report",
  );
  console.log(
    "  trak -w -t client,meeting              # filter week report by tags (OR)",
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
    "  trak -m -t client                      # show month report filtered by tag",
  );
  console.log(
    "  trak -w -x                             # export current week as TSV and copy",
  );
  console.log(
    "  trak -x                                # export all entries (first..last day)",
  );
  console.log(
    "  trak -x -t client                      # export all entries filtered by tag",
  );
  console.log(
    "  trak -m -x csv -ze                     # export month as CSV, zeros for empty days",
  );
  console.log(
    "  trak -m -x tsv -sh -zh                # skip blocking holidays (skip wins over zero)",
  );
  console.log(
    "  trak -w -x tsv -dc                     # export with decimal commas",
  );
  console.log(
    "  trak -a                                # show all logged entries",
  );
  console.log(
    "  trak -a -t client,meeting              # show all entries filtered by tags (OR)",
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
  const saveTags = parsed.tagFilters;
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

    applySaveValue(target, value, saveTags);
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

    applySaveValue(cursor, hours, saveTags);
    cursor = addDays(cursor, 1);
  }
}

function applySaveValue(
  date: Date,
  value: number,
  tags: string[] | undefined,
): void {
  if (value === 0) {
    const oldValue = clearEntry(date, tags);
    printClearResult(date, oldValue);
    return;
  }
  const result = writeEntry(date, value, tags);
  printWriteResult(date, result.newValue, result.oldValue);
}

function printWriteResult(
  date: Date,
  newValue: EntryRecord,
  oldValue: EntryRecord | undefined,
): void {
  const iso = formatIsoDate(date);
  const newHours = entryTotal(newValue);
  if (oldValue === undefined) {
    console.log(`Saved ${formatHours(newHours)}h on ${iso}.`);
    return;
  }
  console.log(
    `Updated ${iso}: ${formatHours(entryTotal(oldValue))}h -> ${formatHours(newHours)}h.`,
  );
}

function printClearResult(date: Date, oldValue: EntryRecord | undefined): void {
  const iso = formatIsoDate(date);
  if (oldValue === undefined) {
    console.log(`No entry to clear on ${iso}.`);
    return;
  }
  console.log(`Cleared ${formatHours(entryTotal(oldValue))}h entry on ${iso}.`);
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
    daysLeft,
    dynamicExpected,
    tagTotals,
    hoursLeft,
  } = context;

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
  const hoursByRow = rows.map((row) => {
    if (row.loggedHours !== undefined) {
      return formatHours(row.loggedHours);
    }
    if (!row.isWorkday) {
      return "0";
    }
    if (row.hasBlockingHoliday) {
      return formatHours(baselineDaily);
    }
    return formatHours(dynamicExpected);
  });
  const expectedByRow = rows.map((row) => row.loggedHours === undefined);
  const hoursWidth = Math.max(
    "Hours".length,
    ...hoursByRow.map((value) => value.length),
  );
  const tagsByRow = rows.map((row) => row.tagSummary ?? "");
  const tagsWidth = Math.max(
    "Tags".length,
    ...tagsByRow.map((value) => value.length),
  );

  console.log(
    `${"Day".padEnd(dayWidth)}  ${"Hours".padEnd(hoursWidth)}  ${"Tags".padEnd(tagsWidth)}`,
  );
  console.log(
    `${"-".repeat(dayWidth)}  ${"-".repeat(hoursWidth)}  ${"-".repeat(tagsWidth)}`,
  );

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const paddedLabel = row.label.padEnd(dayWidth);
    const valueText = hoursByRow[i].padEnd(hoursWidth);

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
      : expectedByRow[i]
        ? grayText(valueText)
        : valueText;
    const tagsText = tagsByRow[i].padEnd(tagsWidth);

    console.log(`${renderedLabel}  ${renderedValue}  ${tagsText}`);
  }

  console.log("");
  console.log(`Total logged: ${formatHours(loggedTotal)}`);
  printLoggedOnTagLines(tagTotals);
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

function runExportAll(parsed: ParsedArgs, settings: Settings): void {
  if (!parsed.exportOptions?.enabled) {
    throw new Error("Export options are required for -x export-all.");
  }

  const rows = buildExportAllRows(parsed, settings);
  const baselineDaily = settings.weeklyHours / settings.workdaysPerWeek;
  runExport(parsed.exportOptions, rows, baselineDaily);
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
  const tagTotals = new Map<string, number>();

  let loggedTotal = 0;
  let periodTarget = 0;

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const date = stripTime(cursor);
    const iso = formatIsoDate(date);
    const holiday = getHolidayInfo(holidayEngine, date);
    const workday = isWorkday(date.getDay(), settings);
    const entry = entries.get(iso);
    const filteredEntry = entry
      ? filterEntryByTags(entry, parsed.tagFilters)
      : undefined;
    const loggedHours = filteredEntry ? entryTotal(filteredEntry) : undefined;

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
      tagSummary: formatEntryTagSummary(filteredEntry),
      loggedHours,
    });

    if (filteredEntry && loggedHours !== undefined) {
      loggedTotal += loggedHours;
      addEntryTagsToTotals(tagTotals, filteredEntry);
    }
    if (workday) {
      periodTarget += baselineDaily;
    }
  }

  const creditedTotal = rows.reduce(
    (total, row) => total + getCreditedHours(row, baselineDaily),
    0,
  );
  const hoursLeft = periodTarget - creditedTotal;
  const daysLeft = rows.filter(
    (row) =>
      row.loggedHours === undefined &&
      row.isWorkday &&
      !row.hasBlockingHoliday,
  ).length;
  const dynamicExpected = daysLeft > 0 ? hoursLeft / daysLeft : 0;

  return {
    start,
    end,
    rows,
    baselineDaily,
    loggedTotal,
    hoursLeft,
    daysLeft,
    dynamicExpected,
    tagTotals,
  };
}

function getCreditedHours(row: RowInfo, baselineDaily: number): number {
  if (row.loggedHours !== undefined) {
    return row.loggedHours;
  }
  if (row.isWorkday && row.hasBlockingHoliday) {
    return baselineDaily;
  }
  return 0;
}

function buildExportAllRows(parsed: ParsedArgs, settings: Settings): RowInfo[] {
  const allEntries = readAllEntries()
    .map((entry) => {
      const filtered = filterEntryByTags(entry, parsed.tagFilters);
      return filtered ? { iso: entry.iso, items: filtered.items } : undefined;
    })
    .filter((entry): entry is AllEntryRecord => entry !== undefined);
  if (allEntries.length === 0) {
    return [];
  }

  const firstDate = parseIsoDate(allEntries[0].iso);
  const lastDate = parseIsoDate(allEntries[allEntries.length - 1].iso);
  if (!firstDate || !lastDate) {
    return [];
  }

  const holidayEngine = createHolidayEngine(settings);
  const byIso = new Map<string, AllEntryRecord>();
  for (const entry of allEntries) {
    byIso.set(entry.iso, entry);
  }

  const rows: RowInfo[] = [];
  for (let cursor = firstDate; cursor <= lastDate; cursor = addDays(cursor, 1)) {
    const date = stripTime(cursor);
    const iso = formatIsoDate(date);
    const holiday = getHolidayInfo(holidayEngine, date);
    const workday = isWorkday(date.getDay(), settings);
    const entry = byIso.get(iso);

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
      loggedHours: entry ? entryTotal(entry) : undefined,
    });
  }

  return rows;
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
      values.push(escapeExportValue(value, options));
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
    return formatExportHours(row.loggedHours, options);
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
    return formatExportHours(baselineDaily, options);
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

function formatExportHours(hours: number, options: ExportOptions): string {
  const formatted = formatHours(hours);
  if (!options.decimalComma) {
    return formatted;
  }
  return formatted.replace(".", ",");
}

function escapeExportValue(value: string, options: ExportOptions): string {
  if (options.format !== "csv" || !value.includes(",")) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function tryCopyToClipboard(
  value: string,
): { success: boolean; method?: string } {
  if (process.env.TRAK_NO_CLIPBOARD) {
    return { success: false };
  }
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

function runAll(parsed: ParsedArgs, settings: Settings): void {
  const entries = readAllEntries()
    .map((entry) => {
      const filtered = filterEntryByTags(entry, parsed.tagFilters);
      return filtered ? { iso: entry.iso, items: filtered.items } : undefined;
    })
    .filter((entry): entry is AllEntryRecord => entry !== undefined);
  const holidayEngine = createHolidayEngine(settings);
  const rows: RowInfo[] = [];
  const tagTotals = new Map<string, number>();
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
      tagSummary: formatEntryTagSummary(entry),
      loggedHours: entryTotal(entry),
    });
    totalHours += entryTotal(entry);
    addEntryTagsToTotals(tagTotals, entry);
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
  const hoursByRow = rows.map((row) => formatHours(row.loggedHours ?? 0));
  const hoursWidth = Math.max(
    "Hours".length,
    ...hoursByRow.map((value) => value.length),
  );
  const tagsByRow = rows.map((row) => row.tagSummary ?? "");
  const tagsWidth = Math.max(
    "Tags".length,
    ...tagsByRow.map((value) => value.length),
  );
  console.log(
    `${"Day".padEnd(dayWidth)}  ${"Hours".padEnd(hoursWidth)}  ${"Tags".padEnd(tagsWidth)}`,
  );
  console.log(
    `${"-".repeat(dayWidth)}  ${"-".repeat(hoursWidth)}  ${"-".repeat(tagsWidth)}`,
  );

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const valueText = hoursByRow[i].padEnd(hoursWidth);
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
    const tagsText = tagsByRow[i].padEnd(tagsWidth);
    console.log(`${renderedLabel}  ${renderedValue}  ${tagsText}`);
  }

  console.log("");
  console.log(`Total logged: ${formatHours(totalHours)}`);
  printLoggedOnTagLines(tagTotals);
}

function filterEntryByTags(
  entry: EntryRecord,
  tagFilters: string[] | undefined,
): EntryRecord | undefined {
  const items =
    !tagFilters || tagFilters.length === 0
      ? entry.items
      : entry.items.filter((item) => itemMatchesTagFilter(item, tagFilters));
  if (items.length === 0) {
    return undefined;
  }
  return { items: items.map(cloneEntryItem) };
}

function itemMatchesTagFilter(
  item: EntryItem,
  tagFilters: string[] | undefined,
): boolean {
  if (!tagFilters || tagFilters.length === 0) {
    return true;
  }
  if (item.tags.length === 0) {
    return false;
  }
  return tagFilters.some((tag) => item.tags.includes(tag));
}

function addEntryTagsToTotals(
  totals: Map<string, number>,
  entry: EntryRecord,
): void {
  for (const item of entry.items) {
    for (const tag of item.tags) {
      totals.set(tag, (totals.get(tag) ?? 0) + item.hours);
    }
  }
}

function sortedTagTotals(tagTotals: Map<string, number>): Array<[string, number]> {
  return Array.from(tagTotals.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
}

function formatEntryTagSummary(entry: EntryRecord | undefined): string {
  if (!entry) {
    return "";
  }
  const totals = new Map<string, number>();
  addEntryTagsToTotals(totals, entry);
  return sortedTagTotals(totals)
    .map(([tag, hours]) => `${tag} (${formatHours(hours)})`)
    .join(", ");
}

function printLoggedOnTagLines(tagTotals: Map<string, number>): void {
  for (const [tag, hours] of sortedTagTotals(tagTotals)) {
    console.log(`Logged on ${tag}: ${formatHours(hours)}`);
  }
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

function readEntriesInRange(start: Date, end: Date): Map<string, EntryRecord> {
  const out = new Map<string, EntryRecord>();
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
    for (const [dateIso, entry] of entries.entries()) {
      if (dateIso >= startIso && dateIso <= endIso) {
        out.set(dateIso, cloneEntry(entry));
      }
    }
  }

  return out;
}

function writeEntry(
  date: Date,
  hours: number,
  tags: string[] | undefined,
): { oldValue: EntryRecord | undefined; newValue: EntryRecord } {
  ensureBaseDirs();
  const filePath = monthFilePath(date);
  const entries = readMonthEntries(filePath);
  const dateIso = formatIsoDate(date);
  const oldValue = entries.get(dateIso);
  const nextItem = { hours, tags: tags ? [...tags] : [] };

  if (!tags || tags.length === 0) {
    entries.set(dateIso, { items: [nextItem] });
  } else {
    const items = oldValue ? oldValue.items.map(cloneEntryItem) : [];
    const existingIndex = items.findIndex((item) =>
      sameTags(item.tags, tags),
    );
    if (existingIndex >= 0) {
      items[existingIndex] = nextItem;
    } else {
      items.push(nextItem);
    }
    entries.set(dateIso, { items });
  }

  writeMonthEntries(filePath, entries);
  const newValue = entries.get(dateIso);
  if (!newValue) {
    throw new Error(`Failed to write entry for ${dateIso}.`);
  }
  return {
    oldValue: oldValue ? cloneEntry(oldValue) : undefined,
    newValue: cloneEntry(newValue),
  };
}

function clearEntry(
  date: Date,
  tags: string[] | undefined,
): EntryRecord | undefined {
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
  if (!tags || tags.length === 0) {
    entries.delete(dateIso);
    writeMonthEntries(filePath, entries);
    return cloneEntry(oldValue);
  }

  const removed = oldValue.items.filter((item) =>
    itemMatchesTagFilter(item, tags),
  );
  if (removed.length === 0) {
    return undefined;
  }

  const remaining = oldValue.items.filter(
    (item) => !itemMatchesTagFilter(item, tags),
  );
  if (remaining.length === 0) {
    entries.delete(dateIso);
  } else {
    entries.set(dateIso, { items: remaining.map(cloneEntryItem) });
  }
  writeMonthEntries(filePath, entries);
  return { items: removed.map(cloneEntryItem) };
}

function readAllEntries(): AllEntryRecord[] {
  const out = new Map<string, EntryRecord>();
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
    for (const [iso, entry] of entries.entries()) {
      out.set(iso, cloneEntry(entry));
    }
  }

  return Array.from(out.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([iso, entry]) => ({
      iso,
      items: entry.items.map(cloneEntryItem),
    }));
}

function monthFilePath(date: Date): string {
  const year = date.getFullYear();
  const month = MONTH_ABBR[date.getMonth()];
  return path.join(DATA_DIR, `${year}_${month}.csv`);
}

function readMonthEntries(filePath: string): Map<string, EntryRecord> {
  const entries = new Map<string, EntryRecord>();
  if (!fs.existsSync(filePath)) {
    return entries;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    const normalizedLine = trimmed.toLowerCase();
    if (
      !trimmed ||
      normalizedLine === "date,hours" ||
      normalizedLine === "date,hours,tags"
    ) {
      continue;
    }

    const cells = trimmed.split(",");
    const dateIso = cells[0]?.trim();
    const hoursRaw = cells[1]?.trim();
    const tagsRaw = cells.slice(2).join(",").trim();
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

    const item = {
      hours,
      tags: parseStoredTags(tagsRaw),
    };
    const entry = entries.get(dateIso);
    if (entry) {
      entry.items.push(item);
    } else {
      entries.set(dateIso, { items: [item] });
    }
  }

  return entries;
}

function writeMonthEntries(
  filePath: string,
  entries: Map<string, EntryRecord>,
): void {
  const rows = Array.from(entries.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const lines = ["date,hours,tags"];
  for (const [date, entry] of rows) {
    for (const item of entry.items) {
      lines.push(`${date},${formatHours(item.hours)},${item.tags.join("|")}`);
    }
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function parseStoredTags(raw: string): string[] {
  if (!raw) {
    return [];
  }

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split("|")) {
    const normalized = part.trim().toLowerCase();
    if (normalized.length === 0) {
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      tags.push(normalized);
    }
  }
  return tags;
}

function cloneEntry(entry: EntryRecord): EntryRecord {
  return {
    items: entry.items.map(cloneEntryItem),
  };
}

function cloneEntryItem(item: EntryItem): EntryItem {
  return {
    hours: item.hours,
    tags: [...item.tags],
  };
}

function entryTotal(entry: EntryRecord): number {
  return entry.items.reduce((total, item) => total + item.hours, 0);
}

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const aTags = new Set(a);
  return b.every((tag) => aTags.has(tag));
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
