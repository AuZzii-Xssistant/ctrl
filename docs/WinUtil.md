# WinUtil Port — Known Problems (flagged, not fixed)

`data/tweaks/winutil-tweaks.json` is a reshaped copy of [WinUtil](https://github.com/ChrisTitusTech/winutil)'s `config/tweaks.json` (MIT). This file tracks correctness problems found in that ported data — **flagged for a future pass, not fixed yet**, per explicit instruction. Don't edit `winutil-tweaks.json` based on this file without checking in first.

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

## Lower-confidence: 9 more Explorer/taskbar-affecting tweaks with *no* refresh step at all

Heuristic scan (registry path touches `Explorer\Advanced`, `Taskbar`, `Search`, `Themes\Personalize`, etc.) found these with **no** invoke/undo script calling any refresh mechanism, private or otherwise:

`WPFTweaksHiber`, `WPFTweaksTelemetry`, `WPFTweaksRemoveHomeAndGallery`, `WPFTweaksDisplay`, `WPFTweaksEndTaskOnTaskbar`, `WPFToggleBatteryPercentage`, `WPFToggleBingSearch`, `WPFToggleTaskbarSearch`, `WPFToggleTaskView`

**Not confirmed as bugs** — some Explorer-observed registry keys do apply live without a restart on modern Windows (varies by key), and this may match WinUtil's own upstream behavior rather than something CTRL broke. Worth spot-checking a few of these against real WinUtil behavior before assuming they need a fix.

## Minor data smell: 1 no-op revert entry

`WPFToggleNewOutlook`'s registry entry for `DoNewOutlookAutoMigration` has `value` and `originalValue` set to the same string — reverting that specific entry does nothing (the tweak has other entries too, so overall Revert isn't fully inert, just this one field). Likely an upstream WinUtil data quirk, not something introduced by the port. Low priority.

## What's already fixed (not flagged here — see `docs/known-issues.md`)

- `admin` flag was hardcoded true for all 66 tweaks; now correctly derived (HKCU-only + no script = no admin needed).
- Revert button now hidden for the 8 tweaks with no registry entries and no undo script (was previously shown and reported fake success on a no-op).
