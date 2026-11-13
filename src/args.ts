import type { SettingsPatch } from "./settings";
import { parseTags } from "./entries";

type Action = "save" | "week" | "month" | "all" | "exportAll";

type ExportFormat = "csv" | "tsv";

const ACTION_FLAGS = new Map<string, Action>([
  ["-s", "save"],
  ["-save", "save"],
  ["-w", "week"],
  ["-week", "week"],
  ["-m", "month"],
  ["-month", "month"],
  ["-a", "all"],
  ["-all", "all"],
]);

export interface ParsedArgs {
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

export interface ExportOptions {
  enabled: boolean;
  format: ExportFormat;
  zeroEmpty: boolean;
  skipEmpty: boolean;
  skipNonWorkdays: boolean;
  skipHolidays: boolean;
  zeroHolidays: boolean;
  decimalComma: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
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
    const action = ACTION_FLAGS.get(token);
    if (action) {
      if (parsed.action) {
        errors.push(`Only one action is allowed. Already set: ${parsed.action}.`);
      } else if (action === "save") {
        const value = readSaveFlagValue(argv, token, i, errors);
        if (value !== undefined) {
          i += 1;
          parsed.action = action;
          saveRaw = value;
        }
      } else {
        parsed.action = action;
      }
      continue;
    }

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
  if (next === undefined || (!allowDashValue && next.startsWith("-"))) {
    errors.push(`Missing value for ${flag}.`);
    return undefined;
  }
  return next;
}

function parseSaveValues(raw: string): number[] | null {
  const values = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map(Number);
  return values.length > 0 &&
    values.every((value) => Number.isFinite(value) && value >= 0)
    ? values
    : null;
}

function parseExportFormat(raw: string): ExportFormat | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "csv" || normalized === "tsv") {
    return normalized;
  }
  return null;
}

export function printUsage(): void {
  console.log(`Usage
  Configuration: trak -h <hours> -l <locale> -ww <workweek>
  Logging:       trak -s <hours|h1,h2,...> [-t [tag|t1,t2,...]] [-d <date>] [-o <offset>]
  Reporting:     trak -w [-t [tag|t1,t2,...]] [-d <week|date>] [-o <offset>]
                 trak -m [-t [tag|t1,t2,...]] [-d <month|date>] [-o <offset>]
  Export:        trak -w|-m -x [csv|tsv] [flags] [-t [tag|t1,t2,...]] [-d <date>] [-o <offset>]
                 trak -x [csv|tsv] [flags] [-t [tag|t1,t2,...]]
                 format default: tsv
                 flags: -zero-empty|-ze -skip-empty|-se -skip-nonworkdays|-sn -skip-holidays|-sh -zero-holidays|-zh -decimal-comma|-dc
  All:           trak -a [-t [tag|t1,t2,...]]

Date formats
  Save: YYYY-MM-DD | DD.MM.YYYY | DD.MM. | MM/DD/YYYY | MM/DD
  Week: ISO week number (1..53) | YYYY-MM-DD | DD.MM.YYYY | DD.MM. | MM/DD/YYYY | MM/DD
  Month: month name (English) | 1..12 | MM.YYYY | YYYY-MM-DD | DD.MM.YYYY | DD.MM. | MM/DD/YYYY | MM/DD

Examples
  trak -h 40 -l de-rp -ww mo-fr          # create or update settings
  trak -s 7.5                            # log 7.5h for today
  trak -s 8 -d 25.02.                    # log 8h on 25 Feb (current year)
  trak -s 8 -t client                    # log 8h for today tagged "client"
  trak -s 8 -t                           # log 8h untagged, replacing selected day(s)
  trak -s 8 -d 02/25                     # log 8h on Feb 25 (current year, US format)
  trak -s 8 -o -1                        # log 8h for yesterday
  trak -s 0 -d 25.02.                    # clear entry on 25 Feb (current year)
  trak -s 8,7.5,6 -d 2026-12-24          # log across next valid workdays
  trak -t ai -d 01.07. -s 3,2,6          # log tagged hours across workdays
  trak -s 8,7.5 -t client,meeting        # apply both tags to each saved entry
  trak -w                                # show current week report
  trak -w -t client,meeting              # filter week report by tags (OR)
  trak -w -o -1                          # show previous week report
  trak -w -d 8                           # show ISO week 8 (current year)
  trak -m                                # show current month report
  trak -m -d February                    # show February report (current year)
  trak -m -t client                      # show month report filtered by tag
  trak -w -x                             # export current week as TSV and copy
  trak -x                                # export all entries (first..last day)
  trak -x -t client                      # export all entries filtered by tag
  trak -m -x csv -ze                     # export month as CSV, zeros for empty days
  trak -m -x tsv -sh -zh                # skip blocking holidays (skip wins over zero)
  trak -w -x tsv -dc                     # export with decimal commas
  trak -a                                # show all logged entries
  trak -a -t client,meeting              # show all entries filtered by tags (OR)`);
}
