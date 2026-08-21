# WinUtil Port — Known Problems (flagged, not fixed)

`data/tweaks/winutil-tweaks.json` is a reshaped copy of [WinUtil](https://github.com/ChrisTitusTech/winutil)'s `config/tweaks.json` (MIT). This file tracks correctness problems found in that ported data — **flagged for a future pass, not fixed yet**, per explicit instruction. Don't edit `winutil-tweaks.json` based on this file without checking in first.

**Summary:** 12 tweaks confirmed broken to some degree (6 unresolvable private-function calls, 2 dropped `service` fields, 4 with zero executable content at all — 1 Combobox + 3 Button type), 9 more flagged lower-confidence, 1 minor data smell. That's ~18% of the 66 ported tweaks with a real gap, out of a full re-read of WinUtil's own application logic (`Invoke-WinUtilTweaks.ps1`), every top-level `Type` value, and every raw JSON key actually in use across the source data.

**Cross-checked against WinUtil's own test suite** (`pester/configs.Tests.ps1`) for extra confidence: it explicitly asserts every non-Combobox tweak must have at least one of `registry`/`service`/`InvokeScript`/`appx` — confirming `service` is a first-class, load-bearing field in their schema, not an incidental one. It even has a dedicated assertion for `WPFTweaksLocation`'s service entry specifically (`$locationServices[0].StartupType | Should -Be "Disabled"`) — the exact tweak flagged above as partially broken in CTRL's port. Combobox-type tweaks (like `WPFchangedns`) are validated under separate, more permissive rules in their suite too, matching the "needs its own UI, not a drop-in fix" conclusion below.

## Confirmed bug: 6 tweaks call a WinUtil-private function that doesn't exist in CTRL

**User-reported root cause**, traced 2026-08-20: ran `WPFToggleTaskbarAlignment` ("Taskbar Centered Icons"), taskbar visually centered, and manually reverting the setting again didn't fix it back to left-aligned.

That tweak's `undoScript` (and `invokeScript`) calls:
```
Invoke-WinUtilExplorerUpdate -action "restart"
```
`Invoke-WinUtilExplorerUpdate` is defined in WinUtil's own `functions/private/Invoke-WinUtilExplorerUpdate.ps1` — it only exists inside WinUtil's own loaded PowerShell module. CTRL's `build_tweak_script` (winutil_tweaks.rs) appends the script text verbatim into a standalone PowerShell process with no such module loaded, so that line fails to resolve. Because `$ErrorActionPreference='Continue'`, the script doesn't stop — it just silently skips the Explorer restart and reports success anyway.

**Effect:** the registry value gets set correctly (apply or revert both), but the taskbar's *rendered* state doesn't refresh until something else restarts Explorer (log off/on, an unrelated Explorer crash, etc.) — so re-toggling the setting looks like it "doesn't work," when actually the data changed correctly but the visual never caught up.

**The actual missing behavior** (from `Invoke-WinUtilExplorerUpdate.ps1`, so a future fix can drop this in directly):
- `-action "restart"`: `taskkill.exe /F /IM "explorer.exe"` then `Start-Process "explorer.exe"`
- `-action "refresh"` (default): broadcasts `WM_SETTINGCHANGE` via `SendMessageTimeout` (P/Invoke `user32.dll`) — used for theme-adjacent changes that don't need a full Explorer restart

All 6 affected tweaks:

| id | label | calls |
|---|---|---|
| `WPFTweaksWidget` | Widgets - Remove | `Invoke-WinUtilExplorerUpdate` |
| `WPFToggleDarkMode` | Dark Theme for Windows | `Invoke-WinUtilExplorerUpdate`, `Invoke-WinutilThemeChange` |
| `WPFToggleShowExt` | File Explorer File Extensions | `Invoke-WinUtilExplorerUpdate` |
| `WPFToggleHiddenFiles` | File Explorer Hidden Files | `Invoke-WinUtilExplorerUpdate` |
| `WPFToggleStartMenuRecommendations` | Start Menu Recommendations | `Invoke-WinUtilExplorerUpdate` |
| `WPFToggleTaskbarAlignment` | Taskbar Centered Icons | `Invoke-WinUtilExplorerUpdate` |

`WPFToggleDarkMode` also calls `Invoke-WinutilThemeChange` (a second private function, not yet inspected in detail — same class of problem).

**Suggested fix (not applied):** either (a) inline the two small `Invoke-WinUtilExplorerUpdate` implementations above directly into `build_tweak_script`'s output when a tweak's script references them (string-replace at generation time), or (b) add a real `-restart`/`-refresh` helper to CTRL's own generated script preamble and rewrite these 6 tweaks' `invokeScript`/`undoScript` to call that instead of the WinUtil name.

## Confirmed bug: 2 tweaks use a `service` field the port dropped entirely

Found while re-reading WinUtil's own `Invoke-WinUtilTweaks.ps1` for a correctness gut-check — it applies THREE possible pieces per tweak (`service`, `registry`, `InvokeScript`/`UndoScript`), each independent. My conversion script only ever read `registry` and `InvokeScript`/`UndoScript` — the `service` array (`Set-WinUtilService -Name X -StartupType Y`) was silently dropped for both tweaks that use it:

- **`WPFTweaksServices`** ("Services - Set to Manual" — the exact tweak visible in the original screenshot) has a `service` list (5 services: CscService, DiagTrack, MapsBroker, StorSvc, SharedAccess, all set Disabled/Manual) *and* an `InvokeScript` that adjusts `SvcHostSplitThresholdInKB` based on installed RAM. CTRL's port kept the script (that part genuinely runs) but dropped the `service` list — so Apply does *something*, just not the main thing the tweak's name and description promise. Not fully inert, but silently incomplete.
- **`WPFTweaksLocation`** ("Location Tracking - Disable") has 3 registry entries (correctly ported) *plus* a service entry disabling `lfsvc` (the Geolocation service) that got dropped. The registry part works, but the tweak doesn't fully do what it claims — the actual location service stays running.

**Suggested fix (not applied):** add a `service?: {name, startupType, originalType}[]` field to `WinutilTweak`/`RegEntry`-adjacent struct, re-run the conversion to capture it, and have `build_tweak_script` emit `Set-Service -Name X -StartupType Y` per entry (apply) / `OriginalType` (revert) — plus `check_winutil_tweaks` would need a matching `Get-Service` read for detection, same free-detection principle as registry entries.

## Confirmed bug: 1 tweak (`WPFchangedns`, DNS selector) has no data to execute at all

`WPFchangedns` ("DNS - Set to:") is a WinUtil **Combobox**-type control, not a checkbox — its actual DNS-setting logic lives in a separate WinUtil function keyed off which dropdown option is selected, not in this JSON entry at all. The entry itself has no `registry`, no `InvokeScript`, nothing executable. In CTRL's port this renders as a normal tweak row that does nothing when clicked. `WPFMultiplaneOverlay` (also `Type: Combobox`) was handled during conversion by collapsing its 3-way `Values` dict to a binary on/off using `registry`, so it does have real content — `WPFchangedns` has no equivalent fallback since it never had registry data to collapse.

**Not a quick fix** — this one genuinely needs its own UI (a dropdown, not a toggle) and its own backend command wired to whichever provider is selected; out of scope for a drop-in fix like the others above.

## Confirmed bug: 3 `Type: "Button"` tweaks are completely inert in CTRL

Found by checking every top-level `Type` value across all 66 tweaks (`Toggle`/unset: 61, `Combobox`: 2, **`Button`: 3**) — a category I hadn't specifically inspected until this pass. In WinUtil, `Type: "Button"` tweaks dispatch through `Invoke-WPFButton` (a name-keyed lookup to a bespoke function), never through the registry/service/script path `Invoke-WinUtilTweaks` handles — confirmed by their own Pester test asserting every `Button`-type name must appear in `Get-WinUtilButtonSwitchNames`. All 3 have **zero data of any kind** in the JSON (no registry, no service, no script):

| id | label | what it actually needs |
|---|---|---|
| `WPFOOSUbutton` | O&O ShutUp10++ - Run | downloads and runs a third-party tool (`Invoke-WPFOOSU` or similar) |
| `WPFAddUltPerf` | Ultimate Performance Profile - Enable | `powercfg -duplicatescheme` with a specific hidden GUID |
| `WPFRemoveUltPerf` | Ultimate Performance Profile - Disable | `powercfg -delete` on that scheme |

In CTRL's port these render as normal tweak rows with working-looking Apply buttons that do nothing at all when clicked (empty script, trivially "succeeds"). Combined with `WPFchangedns` above, that's **4 tweaks with zero executable content in either direction** — not "missing revert," genuinely inert on Apply too.

**Not a quick fix** — same class of problem as the DNS selector: needs real implementations (a downloaded-tool runner, two `powercfg` one-liners with the correct Ultimate Performance GUID) written specifically for CTRL, not a data-shape fix.

## Lower-confidence: 9 more Explorer/taskbar-affecting tweaks with *no* refresh step at all

Heuristic scan (registry path touches `Explorer\Advanced`, `Taskbar`, `Search`, `Themes\Personalize`, etc.) found these with **no** invoke/undo script calling any refresh mechanism, private or otherwise:

`WPFTweaksHiber`, `WPFTweaksTelemetry`, `WPFTweaksRemoveHomeAndGallery`, `WPFTweaksDisplay`, `WPFTweaksEndTaskOnTaskbar`, `WPFToggleBatteryPercentage`, `WPFToggleBingSearch`, `WPFToggleTaskbarSearch`, `WPFToggleTaskView`

**Not confirmed as bugs** — some Explorer-observed registry keys do apply live without a restart on modern Windows (varies by key), and this may match WinUtil's own upstream behavior rather than something CTRL broke. Worth spot-checking a few of these against real WinUtil behavior before assuming they need a fix.

## Minor data smell: 1 no-op revert entry

`WPFToggleNewOutlook`'s registry entry for `DoNewOutlookAutoMigration` has `value` and `originalValue` set to the same string — reverting that specific entry does nothing (the tweak has other entries too, so overall Revert isn't fully inert, just this one field). Likely an upstream WinUtil data quirk, not something introduced by the port. Low priority.

## What's already fixed (not flagged here — see `docs/known-issues.md`)

- `admin` flag was hardcoded true for all 66 tweaks; now correctly derived (HKCU-only + no script = no admin needed).
- Revert button now hidden for the 8 tweaks with no registry entries and no undo script (was previously shown and reported fake success on a no-op).
