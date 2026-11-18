# Changelog

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
