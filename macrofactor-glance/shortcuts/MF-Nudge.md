# Shortcut: MF Nudge

Buzzes the watch only when you're behind. Notifications from Shortcuts mirror to the Fenix
if Garmin Connect > Notifications allows **Shortcuts**.

## Actions
1. **Number** 60 → **PLeft1500**. **Number** 40 → **PLeft2000**. (Or read `Static.nudge`.)
2. Get File `Shortcuts/mf-static.json` → Get Dictionary → **Static**.
3. Find Health Samples (today) for Dietary Energy and Protein, sum and round → **Kcal**, **P**.
4. **Calculate** Static.targets.p − P → **PLeft**. Format Date Now `HH` → **Hour** (Number).
5. **If** Kcal > Static.targets.kcal → **Show Notification** "Over: +N kcal". Stop.
6. **If** Hour < 18 and PLeft > PLeft1500 → Show Notification "Protein: N g left". Stop.
7. **If** Hour ≥ 18 and PLeft > PLeft2000 → Show Notification "Protein: N g left".
8. Otherwise nothing. Silence is the feature.

## Automations
Time of Day 15:00 and 20:00, Run Immediately → Run MF Nudge.

Tip: run MF Push from MF Nudge first (Run Shortcut) so the glance matches the buzz.
