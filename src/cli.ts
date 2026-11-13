#!/usr/bin/env node

import { printUsage, parseArgs } from "./args";
import { SETTINGS_PATH } from "./paths";
import { readSettings, upsertSettings, printSettingsChanges } from "./settings";
import { runSave } from "./save";
import { runReport, runAll, runExportAll } from "./reports";
import { errorText } from "./output";

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
      case "month":
        runReport(parsed.action, parsed, settings);
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

main();
