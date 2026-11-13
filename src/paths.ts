import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const BASE_DIR = process.env.TRAK_HOME ?? path.join(os.homedir(), ".trak");

export const SETTINGS_PATH = path.join(BASE_DIR, "settings.ini");

export const DATA_DIR = path.join(BASE_DIR, "data");

export function ensureBaseDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
