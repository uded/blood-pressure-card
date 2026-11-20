# Changelog

## 0.2.9

### Changed

- **Find it in HACS.** The card is now in the HACS default store: search for **Blood Pressure Card** in HACS, no custom repository needed. The README install steps lead with that.

## 0.2.8

### New

- **Last reading or average, your choice.** The panel under the chart now shows either your last measurement or the average of the period. Pick it with **Under the chart** in the card editor (or `summary: last` / `summary: average` in YAML). Tapping a day shows that day in the same place, so the card keeps its size either way. Last reading is the default.

### Changed

- **No more average tiles.** The two large average boxes are gone; with **Average** chosen, the average sits in the panel under the chart instead. The old **Show averages** switch (`show_stats`) is replaced by the choice above, and an old `show_stats` in YAML is ignored.

### Fixed

- **Highest and lowest values stay when averages are off.** Turning off the averages used to hide the highest and lowest readings as well. **Show highest and lowest readings** now works on its own.

## 0.2.7

### New

- **Last reading at a glance.** Under the chart, the card now shows your last measurement of the period: blood pressure, pulse, category and when it was taken. Tapping a day shows that day in the same place, and tapping it again (or Escape) goes back to the last reading.
- **Highest and lowest values are optional.** Turn them off with **Show highest and lowest readings** in the card editor (or `show_extremes: false` in YAML) for a shorter card. They stay on by default.

### Fixed

- **The card no longer jumps when you tap a day.** The day details used to appear as an extra box that pushed everything below it down, and disappear again on the next tap. They now replace the last reading, so the card keeps its size.

## 0.2.6

### New

- **Weeks start on your day.** With **Periods** set to **Calendar**, the week now starts on the first weekday chosen in your Home Assistant profile (Sunday, Saturday or Monday, or the one your language uses). Rolling 7 days are unchanged.

### Fixed

- **Readable chart labels on phones.** The dates and mmHg values on the chart shrank with the card and were tiny on a phone. They now stay at a readable size on any screen.
- **The right pulse.** The pulse next to the highest and lowest readings is now the one measured together with that reading. Before, a pulse from an earlier measurement could show up.
- **‹ stops where your history ends.** Stepping back through periods stops at the first one the recorder has no data for, instead of going on through empty years.
- A new pulse value now refreshes the card, like a new blood pressure value does.
- Screen readers pronounce the card in its own language, Polish included.

### Documentation

- Clearer manual install steps, with how to make browsers pick up a new version.
- Which Home Assistant versions are needed, and what older ones miss.
- How readings are paired, described the way the card actually does it.
- A note on privacy: blood pressure is health data, and how to keep the card out of other people's view.

## 0.2.5

### Changed

- **Faster switching.** Going back to a period you already looked at (7 days, then 30, then 7 again, or ‹ then ›) shows it instantly instead of loading it from Home Assistant again. A new measurement clears this, so the numbers are always current.

### Fixed

- **"History may be purged" only when it really is.** If you keep more than the default 10 days of history, an empty period older than 10 days used to suggest the history was purged. The card now checks whether the recorder still has any data for that period, and otherwise simply says there are no readings.

## 0.2.4

### New

- **Works with the keyboard.** Tab to the chart, then use the arrow keys to go through the days (or months in the 365-day view). Home and End jump to the first day and to today, Escape closes the details. Screen readers read out the selected day and a one-line summary of the period.
- **Readable colours on light themes.** The light yellow and green categories were hard to see on a white card. With a light theme the card now uses deeper shades of the same colours; dark themes keep the bright ones. Colours you set yourself under `colors` are not changed.

### Fixed

- **Focus stays where you left it.** Switching between 7, 30 and 365 days or stepping back with ‹ no longer throws keyboard focus to the top of the page.
- The ‹ › buttons are labelled in the card language for screen readers.

## 0.2.3

### New

- **Last 7, 30 and 365 days.** The card now shows rolling periods that end today, so the chart and the averages always cover a full stretch of recent readings. Before, on the 1st of the month the month view showed a single day. The buttons read **7 days / 30 days / 365 days**, and ‹ › steps back one whole period at a time.
- The 365-day view has one bar per month. The first and last months are partial; tap a bar to see its exact dates.

### Changed

- **Rolling periods are the new default.** If you prefer this week, this month and this year, set **Periods** to **Calendar** in the card editor (or `range: calendar` in YAML).

## 0.2.2

### New

- **Home or office thresholds.** Most of us measure at home, and home readings are judged against a lower limit: 135/85 instead of the 140/90 used at the doctor's office. Set **Category thresholds** to **Home** in the card editor (or `thresholds: home` in YAML) and the colours, categories and dashed lines use the home limit. Office stays the default. The card now says which one it uses, under the averages.

### Fixed

- **Wall tablets move on at midnight.** A dashboard left open used to keep showing yesterday's week or last month until the next measurement. It now switches to the new day, week, month or year on its own.
- **No made-up readings after an outage.** If your blood pressure sensor was unavailable when a week or month started (a restart, a Withings reconnect), the card could count its return as a new measurement. It now checks what the last real value was.
- **Days follow your Home Assistant time zone setting.** If your profile is set to use the server's time zone, readings are now grouped into days in that zone, the same as the rest of Home Assistant.

## 0.2.1

No changes to the card. This release re-publishes 0.2.0 so the card can be listed in the HACS default store.

## 0.2.0

### New

- **Visual editor.** Configure the card from the dashboard editor: pick your sensors, the default view, language, chart height and more. Colours still need YAML.
- **Suggested for your sensors.** When you add a card and pick a systolic or diastolic sensor, Home Assistant now offers Blood Pressure Card with the matching sensor and your pulse sensor already filled in. Needs a recent Home Assistant.
- **Preview in the card picker**, using your own sensors.

### Fixed

- **The colour matches the number.** An average shown as "140" could be labelled "High normal" because the category was worked out before rounding. It now uses the number you see.
- **Clear errors instead of an empty chart.** A typo in the card's YAML (say `pair_window: 2m`) now shows Home Assistant's error card with what is wrong, instead of "No readings".
- **Missing sensor named.** If a sensor id is wrong, the card says which one instead of blaming recorder history.
- **Readings just before midnight on the 1st** stay in the month (or week) they were taken in.
- **Sensor glitches ignored.** Impossible values such as 0 or 65535 no longer stretch the chart.
- **A missing pulse sensor** no longer hides the blood pressure chart.

## 0.1.0

First version: Withings-style range chart per day or month, week, month and year views, averages and highest/lowest readings, English and Polish.
