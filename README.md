# trak

Minimal TypeScript CLI for local time tracking.

## Install

```bash
npm install
npm run build
npm install -g .
```

Then use:

```bash
trak ...
```

Data is stored centrally in:

- `~/.trak/settings.ini`
- `~/.trak/data/YYYY_MMM.csv`

## Usage

```bash
Configuration: trak -h <hours> -l <locale> -ww <workweek>
Logging:       trak -s <hours|h1,h2,...> [-d <date>] [-o <offset>]
Reporting:     trak -w [-d <week|date>] [-o <offset>]
               trak -m [-d <month|date>] [-o <offset>]
               trak -a
```

## Examples

```bash
trak -h 40 -l de-rp -ww mo-fr          # create or update settings
trak -s 7.5                            # log 7.5h for today
trak -s 8 -d 25.02.                    # log 8h on 25 Feb (current year)
trak -s 8 -d 02/25                     # log 8h on Feb 25 (current year, US format)
trak -s 8 -o -1                        # log 8h for yesterday
trak -s 0 -d 25.02.                    # clear entry on 25 Feb (current year)
trak -s 8,7.5,6 -d 2026-12-24          # log across next valid workdays
trak -w                                # show current week report
trak -w -d 25.02.                      # show week containing 25 Feb (current year)
trak -w -d 02/25                       # show week containing Feb 25 (current year, US format)
trak -w -d 8                           # show ISO week 8 (current year)
trak -m -d February                    # show February report (current year)
trak -m -d 02/25                       # show month containing Feb 25 (current year, US format)
trak -a                                # show all logged entries
```

## Holiday behavior

- Non-workdays are shown in green rows.
- Free holidays are shown in yellow rows.
- Optional holidays keep normal row coloring; only the holiday name is gray.
- Optional holidays are not skipped and do not trigger save warnings.
