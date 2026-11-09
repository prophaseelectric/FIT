# Shortcut: MF Log (write-back, Phase 4)

Triggered by tapping the Pushcut notification the watch sends.

## Pushcut setup
1. Pushcut > Notifications > + → name **MF Log**. Title "MF Log".
2. Default Action: **Run Shortcut** → MF Log, with **Shortcut Input = Notification input**.
3. Copy the notification's Webhook URL → Connect IQ app setting **Pushcut URL** and `.env`.
4. The watch POSTs:
   ```json
   { "title": "MF Log", "text": "Water 500 ml", "input": "{\"action\":\"water\",\"ml\":500}" }
   ```
   `input` is a JSON string. Free tier: you tap the notification on the phone or watch.
   Automation Server (paid) runs it hands-off; switch later only if the tap annoys you.

## Actions
1. **Get Dictionary from Input** (Shortcut Input) → **Req**.
2. **If** Req.action is `water` → MacroFactor **Log Water**, amount Req.ml, unit mL.
3. **Otherwise If** Req.action is `food`:
   - Get File `Shortcuts/mf-static.json` → Get Dictionary → Static.
   - **Repeat with Each** Static.staples; **If** item.id = Req.id → set **Staple**.
   - MacroFactor **Log by JSON** with Staple. Parameter shape: see
     `docs/macrofactor-shortcuts.md` (to be filled from the real action, not guessed).
4. **Run Shortcut** MF Push, so the blob catches up immediately.
