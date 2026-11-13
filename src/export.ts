import { spawnSync } from "node:child_process";
import type { ExportOptions } from "./args";
import type { RowInfo } from "./reports";
import { warningText, formatHours } from "./output";

export function runExport(
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
