# trak

Minimal TypeScript CLI for local time tracking.

## Local install

From this repo, install dependencies, build the CLI, then link it globally:

```bash
npm install
npm run build
npm install -g .
```

After that, use `trak` from anywhere:

```bash
trak ...
```

After local code changes, rerun:

```bash
npm run build
npm install -g .
```

Data is stored centrally in:

- `~/.trak/settings.ini`
- `~/.trak/data/YYYY_MMM.csv`

## Usage

```bash
Configuration: trak -h <hours> -l <locale> -ww <workweek>
Logging:       trak -s <hours|h1,h2,...> [-t [tag|t1,t2,...]] [-d <date>] [-o <offset>]
Reporting:     trak -w [-t [tag|t1,t2,...]] [-d <week|date>] [-o <offset>]
               trak -m [-t [tag|t1,t2,...]] [-d <month|date>] [-o <offset>]
Export:        trak -w|-m -x [csv|tsv] [flags] [-t [tag|t1,t2,...]] [-d <date>] [-o <offset>]
               trak -x [csv|tsv] [flags] [-t [tag|t1,t2,...]]
               format default: tsv
               flags: -zero-empty|-ze -skip-empty|-se -skip-nonworkdays|-sn -skip-holidays|-sh -zero-holidays|-zh -decimal-comma|-dc
All:           trak -a [-t [tag|t1,t2,...]]
```

## Examples

```bash
trak -h 40 -l de-rp -ww mo-fr          # create or update settings
trak -s 7.5                            # log 7.5h for today
trak -s 8 -t client                    # log 8h tagged "client"
trak -s 8 -t                           # log 8h untagged, replacing selected day(s)
trak -s 8 -d 25.02.                    # log 8h on 25 Feb (current year)
trak -s 8 -d 02/25                     # log 8h on Feb 25 (current year, US format)
trak -s 8 -o -1                        # log 8h for yesterday
trak -s 0 -d 25.02.                    # clear entry on 25 Feb (current year)
trak -s 8,7.5,6 -d 2026-12-24          # log across next valid workdays
trak -t ai -d 01.07. -s 3,2,6          # log tagged hours across workdays
trak -s 8,7.5 -t client,meeting        # apply both tags to each saved entry
trak -w                                # show current week report
trak -w -t client,meeting              # filter week report by tags (OR)
trak -w -d 25.02.                      # show week containing 25 Feb (current year)
trak -w -d 02/25                       # show week containing Feb 25 (current year, US format)
trak -w -d 8                           # show ISO week 8 (current year)
trak -m -d February                    # show February report (current year)
trak -m -t client                      # filter month report by tag
trak -m -d 02/25                       # show month containing Feb 25 (current year, US format)
trak -w -x                             # export current week as TSV and copy to clipboard
trak -x                                # export all entries (first..last day range)
trak -x -t client                      # export all entries filtered by tag
trak -x csv -se -t client,meeting      # export filtered all-range as CSV
trak -m -x csv -ze                     # export month as CSV, zeros for empty days
trak -m -x tsv -sn -sh                 # skip empty non-workdays and blocking holidays
trak -m -x tsv -zh                     # export blocking holidays as 0 instead of baseline
trak -w -x tsv -dc                     # export with decimal commas
trak -a                                # show all logged entries
trak -a -t client,meeting              # show all entries filtered by tags
```

## Tag behavior

- Tags are normalized to lowercase on save.
- Tagged saves coexist with other tagged entries on the same day.
- Untagged saves replace all entries on the selected day; `-s 0` without tags clears the day.
- `-s 0 -t <tag>` clears matching tagged entries and leaves other tags intact.
- Multiple tags in `-t` are comma-separated and belong to the same saved entry.
- Filtering by multiple tags uses OR matching.
- Reports show multiple same-day entries as comma-separated hours and tags in matching order.
- Exports without a tag filter sum same-day entries; exports with `-t` include only matching entries.
- Per-tag `Logged on <tag>:` lines count full entry hours for each tag.

## Standalone export behavior

- `trak -x` exports all entries as an hours-only line.
- Range for standalone export is continuous from first matched entry day to last matched entry day.
- Clipboard copy is attempted first; if unavailable, the CLI prints the export line.
- `-decimal-comma` / `-dc` only changes number formatting in export output.
- With `csv` plus `-dc`, numeric values are quoted so comma decimals do not break the CSV columns.

## Holiday behavior

- Non-workdays are shown in green rows.
- Free holidays are shown in yellow rows.
- Optional holidays keep normal row coloring; only the holiday name is gray.
- Optional holidays are not skipped and do not trigger save warnings.
