const {
  formatIsoDate,
  resolveSaveAnchor,
  resolveWeekAnchor,
  resolveMonthAnchor,
} = require("../dist/dates");

beforeAll(() => jest.useFakeTimers().setSystemTime(new Date(2026, 6, 1)));
afterAll(() => jest.useRealTimers());

test.each(["2026-07-01", "01.07.2026", "01.07.", "07/01/2026", "07/01"])(
  "save, week, and month accept the same date format: %s",
  (input) => {
    for (const resolve of [resolveSaveAnchor, resolveWeekAnchor, resolveMonthAnchor]) {
      expect(formatIsoDate(resolve(input, 0))).toBe("2026-07-01");
    }
  },
);

test.each(["2026-02-29", "31.04.2026", "02/30/2026"])(
  "save, week, and month reject impossible dates: %s",
  (input) => {
    for (const resolve of [resolveSaveAnchor, resolveWeekAnchor, resolveMonthAnchor]) {
      expect(() => resolve(input, 0)).toThrow("Invalid -d/-date");
    }
  },
);

test("date offsets handle leap days and year boundaries", () => {
  expect(formatIsoDate(resolveSaveAnchor("2028-02-29", 1))).toBe("2028-03-01");
  expect(formatIsoDate(resolveWeekAnchor("53", 1))).toBe("2027-01-04");
  expect(formatIsoDate(resolveMonthAnchor("12.2026", 1))).toBe("2027-01-01");
});
