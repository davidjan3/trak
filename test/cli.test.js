const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CLI_PATH = path.join(__dirname, "..", "dist", "cli.js");
const tempHomes = [];

afterEach(() => {
  for (const home of tempHomes.splice(0)) {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

function createTempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "trak-test-"));
  tempHomes.push(home);
  return home;
}

function createTrakHome(settings = {}) {
  const home = createTempHome();
  run(
    [
      "-h",
      String(settings.weeklyHours ?? 40),
      "-l",
      settings.locale ?? "de-rp",
      "-ww",
      settings.workweek ?? "mo-fr",
    ],
    home,
  );
  return home;
}

function runRaw(args, trakHome) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      TZ: "Europe/Berlin",
      TRAK_HOME: trakHome,
      TRAK_NO_CLIPBOARD: "1",
    },
  });
}

function run(args, trakHome) {
  const result = runRaw(args, trakHome);

  if (result.status !== 0) {
    throw new Error(
      [
        `trak ${args.join(" ")} failed with ${result.status}`,
        result.stdout,
        result.stderr,
      ].join("\n"),
    );
  }

  return result.stdout;
}

function fail(args, trakHome = createTempHome()) {
  const result = runRaw(args, trakHome);
  expect(result.status).not.toBe(0);
  return `${result.stdout}${result.stderr}`;
}

function exportLine(output) {
  const lines = output.split(/\r?\n/);
  return lines[lines.length - 2] ?? lines[0] ?? "";
}

function exportFields(output, delimiter = "\t") {
  return exportLine(output).split(delimiter);
}

function rowFor(output, isoDate) {
  return output
    .split(/\r?\n/)
    .find((line) => /^[A-Z][a-z]{2}\s/.test(line) && line.includes(isoDate));
}

function saveTaggedSeries(home) {
  run(["-t", "ai", "-d", "2026-07-01", "-s", "3,2,6"], home);
  run(["-t", "jkc", "-d", "2026-07-01", "-s", "4,5.5,4"], home);
}

test("creates and updates settings inside the configured trak home", () => {
  const home = createTempHome();

  const created = run(["-h", "40", "-l", "de-rp", "-ww", "mo-fr"], home);
  expect(created).toContain("Set work hours per week to 40.");
  expect(created).toContain("Set workweek to Monday - Friday.");

  const updated = run(["-h", "35", "-ww", "mo-su"], home);
  expect(updated).toContain("Set work hours per week to 35.");
  expect(updated).toContain("Set workweek to Monday - Sunday.");

  expect(fs.readFileSync(path.join(home, "settings.ini"), "utf8")).toBe(
    "weekly_hours=35\nlocale=de-rp\nworkweek=mo-su\n",
  );
});

test("rejects invalid input and invalid flag combinations", () => {
  expect(fail(["-s", "1"])).toContain("Settings file not found");
  expect(fail(["-h", "40", "-l", "de-rp", "-ww", "xx-fr"])).toContain(
    "Invalid workweek",
  );

  const home = createTrakHome();

  expect(fail(["-s", "-1"], home)).toContain(
    "-s/-save expects a number or comma-separated non-negative numbers.",
  );
  expect(fail(["-s", "1", "-t", "bad|tag"], home)).toContain(
    "-t/-tag expects non-empty comma-separated tags.",
  );
  expect(fail(["-ze"], home)).toContain("Export modifiers require -x.");
  expect(fail(["-x", "-d", "2026-07-01"], home)).toContain(
    "-x export-all does not use -d/-date or -o/-offset.",
  );
  expect(fail(["-a", "-d", "2026-07-01"], home)).toContain(
    "-a/-all does not use -d/-date or -o/-offset.",
  );
  expect(fail(["-w", "-m"], home)).toContain("Only one action is allowed");
  expect(fail(["--wat"], home)).toContain("Unknown flag or argument: --wat");
});

test("saves explicit date formats, normalizes tags, and sorts all entries", () => {
  const home = createTrakHome();

  run(["-s", "1", "-d", "2026-07-03"], home);
  run(["-s", "2.5", "-d", "04.07.2026", "-t", "Client,CLIENT"], home);
  run(["-s", "3", "-d", "07/05/2026", "-t", "Admin"], home);

  const all = run(["-a"], home);
  expect(rowFor(all, "2026-07-03")).toMatch(/Fri 2026-07-03\s+1\s*$/);
  expect(rowFor(all, "2026-07-04")).toMatch(
    /Sat 2026-07-04\s+2.5\s+client \(2.5\)\s*$/,
  );
  expect(rowFor(all, "2026-07-05")).toMatch(
    /Sun 2026-07-05\s+3\s+admin \(3\)\s*$/,
  );
  expect(all).toContain("Total logged: 6.5");
  expect(all.indexOf("2026-07-03")).toBeLessThan(all.indexOf("2026-07-04"));
});

test("save offset applies after the anchor date", () => {
  const home = createTrakHome();

  run(["-s", "4", "-d", "2026-07-06", "-o", "-3"], home);

  expect(rowFor(run(["-a"], home), "2026-07-03")).toMatch(
    /Fri 2026-07-03\s+4\s*$/,
  );
});

test("series saves skip weekends and blocking holidays", () => {
  const home = createTrakHome();

  run(["-s", "1,2,3,4", "-d", "2025-12-31"], home);

  const all = run(["-a"], home);
  expect(rowFor(all, "2025-12-31")).toMatch(/Wed 2025-12-31\s+1\s*$/);
  expect(rowFor(all, "2026-01-02")).toMatch(/Fri 2026-01-02\s+2\s*$/);
  expect(rowFor(all, "2026-01-05")).toMatch(/Mon 2026-01-05\s+3\s*$/);
  expect(rowFor(all, "2026-01-06")).toMatch(/Tue 2026-01-06\s+4\s*$/);
  expect(rowFor(all, "2026-01-01")).toBeUndefined();
  expect(rowFor(all, "2026-01-03")).toBeUndefined();
});

test("single saves warn but still record non-workdays and blocking holidays", () => {
  const home = createTrakHome();

  const holiday = runRaw(["-s", "2", "-d", "2026-01-01"], home);
  expect(holiday.status).toBe(0);
  expect(holiday.stderr).toContain("is a public holiday");

  const weekend = runRaw(["-s", "3", "-d", "2026-07-04"], home);
  expect(weekend.status).toBe(0);
  expect(weekend.stderr).toContain("is outside workweek Monday - Friday");

  const all = run(["-a"], home);
  expect(rowFor(all, "2026-01-01")).toMatch(/Thu 2026-01-01.*\s2\s*$/);
  expect(rowFor(all, "2026-07-04")).toMatch(/Sat 2026-07-04\s+3\s*$/);
});

test("keeps existing multi-tag save and OR filter behavior", () => {
  const home = createTrakHome();

  run(["-s", "8", "-t", "client,meeting", "-d", "2026-07-01"], home);

  expect(exportLine(run(["-x"], home))).toBe("8");
  expect(exportLine(run(["-x", "-t", "client"], home))).toBe("8");
  expect(exportLine(run(["-x", "-t", "meeting"], home))).toBe("8");
  expect(exportLine(run(["-x", "-t", "client,other"], home))).toBe("8");

  const all = run(["-a"], home);
  expect(rowFor(all, "2026-07-01")).toMatch(
    /\s8\s+client \(8\), meeting \(8\)\s*$/,
  );
  expect(all).toContain("Total logged: 8");
  expect(all).toContain("Logged on client: 8");
  expect(all).toContain("Logged on meeting: 8");
});

test("coexisting same-day tags sum for plain export and filter per tag", () => {
  const home = createTrakHome();

  saveTaggedSeries(home);

  expect(exportLine(run(["-x"], home))).toBe("7\t7.5\t10");
  expect(exportLine(run(["-x", "-t", "ai"], home))).toBe("3\t2\t6");
  expect(exportLine(run(["-x", "-t", "jkc"], home))).toBe("4\t5.5\t4");

  const week = run(["-w", "-d", "2026-07-01"], home);
  expect(rowFor(week, "2026-07-01")).toMatch(
    /Wed 2026-07-01\s+7\s+ai \(3\), jkc \(4\)\s*$/,
  );
  expect(week).toContain("Total logged: 24.5");
  expect(week).toContain("Logged on ai: 11");
  expect(week).toContain("Logged on jkc: 13.5");

  const month = run(["-m", "-d", "2026-07-01"], home);
  expect(rowFor(month, "2026-07-02")).toMatch(
    /Thu 2026-07-02\s+7.5\s+ai \(2\), jkc \(5.5\)\s*$/,
  );

  const all = run(["-a"], home);
  expect(rowFor(all, "2026-07-03")).toMatch(
    /Fri 2026-07-03\s+10\s+ai \(6\), jkc \(4\)\s*$/,
  );
});

test("re-saving a tag updates that tag entry without duplicating it", () => {
  const home = createTrakHome();

  run(["-s", "3", "-t", "client,meeting", "-d", "2026-07-01"], home);
  run(["-s", "4", "-t", "meeting,client", "-d", "2026-07-01"], home);

  expect(exportLine(run(["-x"], home))).toBe("4");
  expect(rowFor(run(["-a"], home), "2026-07-01")).toMatch(
    /Wed 2026-07-01\s+4\s+client \(4\), meeting \(4\)\s*$/,
  );
});

test("untagged save replaces same-day tagged entries and zero clears the day", () => {
  const home = createTrakHome();
  saveTaggedSeries(home);

  run(["-s", "8", "-d", "2026-07-01"], home);

  const week = run(["-w", "-d", "2026-07-01"], home);
  expect(rowFor(week, "2026-07-01")).toMatch(/Wed 2026-07-01\s+8\s*$/);
  expect(exportLine(run(["-x", "-zero-empty"], home))).toBe("8\t7.5\t10");
  expect(exportLine(run(["-x", "-t", "ai"], home))).toBe("2\t6");

  run(["-s", "0", "-d", "2026-07-02"], home);

  expect(exportLine(run(["-x", "-zero-empty"], home))).toBe("8\t0\t10");
});

test("tagged zero clears only matching tag entries", () => {
  const home = createTrakHome();
  saveTaggedSeries(home);

  run(["-s", "0", "-t", "ai", "-d", "2026-07-01"], home);

  expect(exportLine(run(["-x", "-zero-empty"], home))).toBe("4\t7.5\t10");
  expect(exportLine(run(["-x", "-t", "ai"], home))).toBe("2\t6");
  expect(exportLine(run(["-x", "-t", "jkc"], home))).toBe("4\t5.5\t4");

  run(["-s", "0", "-t", "missing", "-d", "2026-07-01"], home);

  expect(exportLine(run(["-x", "-zero-empty"], home))).toBe("4\t7.5\t10");
});

test("all view handles empty data and tag filters", () => {
  const home = createTrakHome();

  expect(run(["-a"], home)).toContain("No entries found.");

  run(["-s", "2", "-t", "ai", "-d", "2026-07-01"], home);
  run(["-s", "5", "-t", "ops", "-d", "2026-07-02"], home);

  const filtered = run(["-a", "-t", "ai"], home);
  expect(filtered).toContain("2026-07-01");
  expect(filtered).not.toContain("2026-07-02");
  expect(filtered).toContain("Total logged: 2");
  expect(filtered).toContain("Logged on ai: 2");
});

test("standalone export uses a continuous range and tag filters shrink to matched entries", () => {
  const home = createTrakHome();

  run(["-s", "1", "-t", "ops", "-d", "2026-07-01"], home);
  run(["-s", "3", "-t", "ai", "-d", "2026-07-03"], home);

  expect(exportLine(run(["-x"], home))).toBe("1\t\t3");
  expect(exportLine(run(["-x", "-zero-empty"], home))).toBe("1\t0\t3");
  expect(exportLine(run(["-x", "-t", "ai", "-zero-empty"], home))).toBe("3");
  expect(exportLine(run(["-x", "-t", "missing"], home))).toBe("");
});

test("week report calculates remaining hours and dynamic expected days", () => {
  const home = createTrakHome();

  run(["-s", "4", "-d", "2026-07-01"], home);
  run(["-s", "8", "-d", "2026-07-02"], home);

  const week = run(["-w", "-d", "2026-07-01"], home);
  expect(week).toContain("Week 2026-06-29 to 2026-07-05");
  expect(rowFor(week, "2026-06-29")).toMatch(/Mon 2026-06-29\s+9.33\s*$/);
  expect(rowFor(week, "2026-07-01")).toMatch(/Wed 2026-07-01\s+4\s*$/);
  expect(rowFor(week, "2026-07-04")).toMatch(/Sat 2026-07-04\s+0\s*$/);
  expect(week).toContain("Total logged: 12");
  expect(week).toContain("Hours left: 28");
  expect(week).toContain("Expected/day (remaining): 9.33");
  expect(week).toContain("Warning: Estimates are based on weekly hours only.");
});

test("tag-filtered week reports calculate totals from matching entries only", () => {
  const home = createTrakHome();
  saveTaggedSeries(home);

  const week = run(["-w", "-d", "2026-07-01", "-t", "ai"], home);

  expect(rowFor(week, "2026-07-01")).toMatch(
    /Wed 2026-07-01\s+3\s+ai \(3\)\s*$/,
  );
  expect(rowFor(week, "2026-07-02")).toMatch(
    /Thu 2026-07-02\s+2\s+ai \(2\)\s*$/,
  );
  expect(week).toContain("Total logged: 11");
  expect(week).toContain("Logged on ai: 11");
  expect(week).not.toContain("Logged on jkc");
  expect(week).toContain("Hours left: 29");
  expect(week).toContain("Expected/day (remaining): 14.5");
});

test("month report credits blocking holidays without counting them as logged", () => {
  const home = createTrakHome();

  const month = run(["-m", "-d", "01.2026"], home);

  expect(month).toContain("Month 2026-01");
  expect(rowFor(month, "2026-01-01")).toMatch(/Thu 2026-01-01.*\s8\s*$/);
  expect(rowFor(month, "2026-01-03")).toMatch(/Sat 2026-01-03\s+0\s*$/);
  expect(month).toContain("Total logged: 0");
  expect(month).toContain("Hours left: 168");
  expect(month).toContain("Expected/day (remaining): 8");
});

test("month and week report offsets move the selected period", () => {
  const home = createTrakHome();

  expect(run(["-w", "-d", "2026-07-01", "-o", "1"], home)).toContain(
    "Week 2026-07-06 to 2026-07-12",
  );
  expect(run(["-m", "-d", "07.2026", "-o", "-1"], home)).toContain(
    "Month 2026-06",
  );
});

test("custom workweeks alter workday rows and daily baselines", () => {
  const home = createTrakHome({ weeklyHours: 35, workweek: "mo-su" });

  const week = run(["-w", "-d", "2026-07-01"], home);

  expect(rowFor(week, "2026-07-04")).toMatch(/Sat 2026-07-04\s+5\s*$/);
  expect(rowFor(week, "2026-07-05")).toMatch(/Sun 2026-07-05\s+5\s*$/);
  expect(week).toContain("Hours left: 35");
  expect(week).toContain("Expected/day (remaining): 5");
});

test("week exports support empty, nonworkday, and holiday flags", () => {
  const home = createTrakHome();

  run(["-s", "7.5", "-d", "2025-12-29"], home);

  expect(exportFields(run(["-w", "-d", "2025-12-29", "-x"], home))).toEqual([
    "7.5",
    "",
    "",
    "8",
    "",
    "",
    "",
  ]);
  expect(
    exportFields(run(["-w", "-d", "2025-12-29", "-x", "-zero-empty"], home)),
  ).toEqual(["7.5", "0", "0", "8", "0", "0", "0"]);
  expect(
    exportFields(run(["-w", "-d", "2025-12-29", "-x", "-skip-empty"], home)),
  ).toEqual(["7.5", "8"]);
  expect(
    exportFields(
      run(["-w", "-d", "2025-12-29", "-x", "-skip-nonworkdays"], home),
    ),
  ).toEqual(["7.5", "", "", "8", ""]);
  expect(
    exportFields(run(["-w", "-d", "2025-12-29", "-x", "-zero-holidays"], home)),
  ).toEqual(["7.5", "", "", "0", "", "", ""]);
  expect(
    exportFields(run(["-w", "-d", "2025-12-29", "-x", "-skip-holidays"], home)),
  ).toEqual(["7.5", "", "", "", "", ""]);
  expect(
    exportFields(
      run(
        [
          "-w",
          "-d",
          "2025-12-29",
          "-x",
          "-skip-holidays",
          "-zero-holidays",
        ],
        home,
      ),
    ),
  ).toEqual(["7.5", "", "", "", "", ""]);
});

test("csv exports escape decimal comma values", () => {
  const home = createTrakHome();

  run(["-s", "7.5", "-d", "2026-07-01"], home);

  expect(exportLine(run(["-w", "-d", "2026-07-01", "-x", "csv", "-dc"], home))).toBe(
    ",,\"7,5\",,,,",
  );
  expect(
    exportLine(run(["-w", "-d", "2026-07-01", "-x", "csv", "-dc", "-ze"], home)),
  ).toBe('0,0,"7,5",0,0,0,0');
});

test("month export applies holiday and nonworkday skipping across a full month", () => {
  const home = createTrakHome();

  const fields = exportFields(
    run(["-m", "-d", "01.2026", "-x", "-skip-nonworkdays", "-skip-holidays"], home),
  );

  expect(fields).toHaveLength(21);
  expect(fields.every((value) => value === "")).toBe(true);
});
