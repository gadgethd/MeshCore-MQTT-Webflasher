# STATUS: UI simplification implemented and deployed 2026-08-07 (see commit). Items below are historical context; 0a-0c, 1, 3-5, 7, 9-10 already live. Remaining: 6, 8, 11-15, 17-18 (minor).

# MeshCore-MQTT-WebFlasher UI Improvements

Recommended UI changes, organized by priority. This is a planning document — no code has been changed yet.

---

## Critical (Flow Broken)

### 0a. App Starts on Step 2 Instead of Step 1
On page load `syncActiveStep()` calls `recommendedStepId()`, which jumps to `choose-board` (step 2) rather than `read-device` (step 1). Users land mid-flow with no explanation of what they missed.

- Fix `recommendedStepId()` so a fresh page load always starts on `read-device` (step 1) unless a device has already been read in this session
- Only auto-advance past step 1 if `deviceCaptured === true`
- This is a logic bug in `app.js` — not a cosmetic issue

### 0b. Device Settings and MQTT Settings Should Be a Single Combined Step
Currently step 4 (`device-settings`) and step 5 (`mqtt-settings`) are split across separate tabs, but they are applied together in step 6 (`configure-device`). This split forces users to navigate back and forth and makes the flow feel fragmented.

- Merge `device-settings` and `mqtt-settings` into a single step (e.g., step 4: "Configure Device")
- Use section headings or accordions within the step to separate Device/WiFi and MQTT sections
- The step order becomes: `1 Backup → 2 Board → 3 Flash → 4 Configure → 5 Apply`
- Step 5 (`configure-device`) becomes the final "Apply & Verify" step
- Update `STEP_ORDER` in `app.js` and the tab buttons in `index.html` accordingly

### 0c. Reconnect Serial Prompt Is Not Prominent Enough
After flashing and after sending device settings, the device reboots and serial is automatically closed. The only cue to reconnect is the `nav-serial-button` in the top bar — which is easy to miss, especially if the user is focused on the lower content area. Users get stuck not knowing why nothing is happening.

- After flash completes: show a full-width inline banner in the flash step panel saying "Flash complete. Reconnect serial to continue →" with a prominent "Connect Serial" button embedded in the banner
- After device settings are applied and the device reboots: show the same style banner in the configure step panel: "Device rebooted. Reconnect serial to verify →"
- The banner should be visually distinct — use the same coral/warning color as the alpha bar, or a distinct teal "action required" style
- The embedded connect button should call the same serial connect logic as the top nav button
- Banner disappears once serial is reconnected

---

## High Priority (UX Blockers)

### 1. Step Progress Indicator
Add a visible numbered stepper (1–6) at the top of the workflow so users always know where they are. Currently there is no global progress context — users can lose track of which step they're on.

- Fixed horizontal stepper bar at top of page
- Steps: `1 Backup → 2 Board → 3 Flash → 4 Device → 5 WiFi → 6 MQTT`
- Active step highlighted; completed steps marked with checkmark
- Clicking a completed step could scroll to that section

### 2. Mode Switching UX
Add a visible "Switch Mode" or "Change Workflow" link in the sidebar/header. Currently switching mode (e.g., from Flash to Config-only) requires a page reload with no obvious affordance.

- Small text link or icon button in the header: `← Change Workflow`
- Should reset relevant state and return to the mode selector screen
- No full page reload required

### 3. Settings Confirmation Feedback
After clicking "Apply WiFi Settings" or "Apply MQTT Settings", the user receives no visual confirmation that commands were sent. Add a brief toast or inline status chip.

- Show a green "Sent ✓" toast for 2–3 seconds after successful apply
- If an error occurs, show a red "Failed — check serial log" message inline
- Reset confirmation state on next edit so it doesn't stale

### 4. MQTT Broker Pair Labeling
Broker and status-broker fields are currently displayed as separate unnamed cards. This is confusing — each broker has a paired status URL but the relationship isn't visually obvious.

- Rename sections to "Broker 1", "Broker 2", etc.
- Nest the status broker URL inside each broker card as a sub-field
- Use a mild visual indent or border-left to show parent-child relationship
- Optionally make status broker sub-section collapsible

### 5. "Apply All Settings" Button
Most users want to send WiFi + MQTT + device settings in one shot, but currently must click multiple Apply buttons separately. Add a single "Apply All Settings" button.

- Placed prominently at the bottom of the settings panel
- Fires WiFi → MQTT → device settings commands in sequence
- Shows combined progress/result feedback (e.g., "3/3 applied ✓")
- Individual Apply buttons remain for granular control

---

## Medium Priority (Polish & Clarity)

### 6. Radio Input Validation Hints
Frequency, Bandwidth, SF, and CR fields have no range guidance. Users can enter invalid values with no feedback until they cause a device issue.

- Add placeholder text showing a valid example value (e.g., `869.5250`)
- Add tooltip or small helper text showing valid range (e.g., `863–870 MHz`)
- Highlight field in red with inline error message if value is out of range on blur
- Disable Apply button if any radio field has a validation error

### 7. Private Key Reveal Toggle
The private key fields are always masked. Users cannot verify they've pasted the correct key without revealing it.

- Add an eye icon button (👁) to private key input fields
- Toggles `type="password"` / `type="text"` on click
- Icon changes state to indicate visibility (open/closed eye)
- No value is logged or sent anywhere when revealed

### 8. Captured vs Uncaptured Distinction
Currently, fields that haven't been read from the device show generic "Not captured" chips. Users don't know they need to take an action.

- Replace "Not captured" chips with a distinct "Read device first" badge
- Badge includes a shortcut button: `→ Read Now` that triggers the read command
- Visual distinction: use a different color/icon from normal status chips
- After reading, badge is replaced with the captured value

### 9. Progress Bar Enhancement
During flashing, the progress bar shows a percentage but no label for the current operation. Users don't know if flashing is slow or stuck.

- Display current operation label beneath the progress bar
  - e.g., `Writing partition table…`, `Erasing flash…`, `Verifying…`
- Keep existing percentage indicator
- On completion, show `Flash complete ✓` label

### 10. Serial Log Timestamps and Copy
The serial log shows raw output with no timestamps. There is no way to copy log content.

- Prefix each log line with a timestamp: `[21 Mar 13:20:40]`
- Add a "Copy Log" button (clipboard icon) to copy full log text
- Optionally add a small filter/search input above the log pane
- Keep the fixed-height scrollable log pane as-is

---

## Low Priority (Polish)

### 11. Consistent Button Sizing
Primary action buttons (e.g., "Flash Full Firmware", "Apply WiFi Settings") have inconsistent padding and font sizes, making the UI feel unpolished.

- Normalize all primary action buttons to the same padding and font-size
- Define a `.btn-primary` class used consistently
- Secondary/cancel actions use `.btn-secondary` with smaller visual weight

### 12. Alpha Warning Bar Prominence
The alpha/warning notice uses a muted gold color that reads as decorative rather than cautionary.

- Change background to coral or red-tinted panel
- Use bold text and a warning icon (⚠)
- Ensure sufficient contrast ratio (WCAG AA minimum)

### 13. Focus and Accessibility
Interactive elements (combobox, tabs, toggles, icon buttons) lack visible focus indicators and ARIA labels.

- Add `:focus-visible` ring to all interactive elements using a consistent color
- Add `aria-label` to all icon-only buttons (e.g., eye toggle, copy button)
- Ensure tab order follows visual reading order
- Test with keyboard-only navigation

### 14. Mobile Responsive Improvements
On narrow viewports, the sidebar and main content panel overlap or overflow.

- On viewports < 768px: sidebar stacks below main content
- Serial log pane uses `max-height: 200px` on mobile
- Settings form fields stack in single column (remove two-column grid)
- Buttons go full-width on mobile

### 15. Download Backup Preview
Before downloading a backup file, users cannot confirm it contains the expected content.

- Show a small collapsible preview of the backup file content
- Or display a summary chip list (e.g., `WiFi SSID ✓`, `3 MQTT Brokers ✓`, `Private Key ✓`)
- Preview is inline, above or beside the Download button
- Helps catch incomplete backups before they're saved

### 16. Board Label Casing in Board Selector
Board names in `firmware-data.js` are inconsistently cased. The two Heltec V4 entries appear in the dropdown as `"heltec v4 repeater"` and `"heltec v4 tft repeater"` (all lowercase) while other boards like `"Heltec v3 Repeater"` are properly capitalised.

- Rename `"heltec v4 repeater"` → `"Heltec V4"`
- Rename `"heltec v4 tft repeater"` → `"Heltec V4 TFT"`
- Review all board labels for consistent title casing (e.g., `"heltec tracker v2 repeater"`, `"Heltec T190 repeater "` has a trailing space)
- Change is in `firmware-data.js` only — no JS logic affected

### 17. Hardware Validation Status for Heltec V4
Both V4 variants (`heltec_v4_repeater`, `heltec_v4_tft_repeater`) are marked `"Compile validated"` in `firmware-data.js`, unlike the V3 which is `"Verified on hardware"`. If a V4 has been physically tested and confirmed working, update the status.

- Update `"hardwareStatus"` field in `firmware-data.js` for V4 entries once hardware-verified
- The status is displayed in the board selector UI — users can see it when picking a board
- Keeping it as `"Compile validated"` is fine until hardware testing is confirmed

### 18. Board-Specific Post-Flash Notes
After flashing, all boards get the same generic reconnect flow. Some boards (particularly the V4 variants) may have quirks — e.g., button combos needed to enter flash mode, or known issues — with no way to surface this in the UI.

- Add an optional `"notes"` field per board entry in `firmware-data.js`
- Display any notes as an inline callout on the flash step when that board is selected
- Example: `"notes": "Hold USER button while connecting USB to enter flash mode."`
- Only show the callout if `notes` is non-empty

---

## Implementation Notes

- Items 0a, 0b, 0c are the most critical — fix these before anything else
- Item 0b (merging steps 4+5) requires updating `STEP_ORDER` in `app.js` and the tab markup in `index.html`
- Item 0c reconnect banners need to hook into the same serial connect function as `nav-serial-button`; check where `updateSerialButton()` is called after flash/config completion
- Items 1, 3, 5 are likely the next highest-impact changes for usability
- Items 4 and 8 require understanding the current data model in `app.js`
- Item 16 is a trivial data fix in `firmware-data.js` — do it alongside any other firmware data changes
- Item 17 is a data-only change pending hardware confirmation from Ben
- CSS changes (11, 12, 13, 14) can be batched and done in a single pass through `styles.css`
- Item 10 (timestamps) depends on how log lines are currently written — check the `appendLog()` function in `app.js`
