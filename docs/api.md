# CTRL — Tauri Command API

All commands called via `window.__TAURI__.core.invoke(command, payload)`.

## Window
| Command | Payload | Returns |
|---|---|---|
| `close_window` | — | void |
| `minimize_window` | — | void |
| `toggle_maximize` | — | void |

## Dashboard
| Command | Payload | Returns |
|---|---|---|
| `get_pinned` | — | `PinnedItem[]` |
| `pin_item` | `{item_type, item_id, group_name?}` | `i64` (new id) |
| `unpin_item` | `{id}` | void |
| `reorder_pins` | `{orders: [{id, sort_order}]}` | void |
| `get_sys_info` | — | `SysInfo` — hostname/username/OS/RAM/CPU/boot time, via a PowerShell CIM query |
| `get_perf_stats` | — | `PerfStats` — live CPU/RAM/network/drive usage, polled every 1.5s by the dashboard perf panel |
| `get_recent_activity` | `{limit?}` (default 12) | `ActivityEntry[]` — most recent `run_log` rows |

## Terminal / PTY
| Command | Payload | Returns |
|---|---|---|
| `list_shells` | — | `ShellInfo[]` — detected PowerShell 7/5, cmd, WSL, Git Bash |
| `pty_open` | `{tabId, shell, args, cols, rows}` | void — opens a new PTY session for that tab, killing any existing session on the same `tabId` first |
| `pty_write` | `{tabId, data}` | void — raw bytes written to the PTY (keystrokes, or a command + `\r`) |
| `pty_resize` | `{tabId, cols, rows}` | void |
| `pty_close` | `{tabId}` | void — kills the child process and emits `pty-exit-{tabId}` |
| `is_elevated` | — | `bool` |
| `open_elevated_terminal` | — | void — spawns a new elevated PowerShell/pwsh window via UAC |
| `stop_current_run` | — | void — see ScriptStash section; also usable to cancel a Quick Fix/tweak run in progress |
| `kill_process` | `{pid}` | void — `taskkill /PID /T /F` |

PTY output streams via `pty-data-{tabId}` events (raw terminal bytes), not as a command return value. `pty-exit-{tabId}` fires when the shell process dies.

## Tools
| Command | Payload | Returns |
|---|---|---|
| `get_tools` | `{search?}` | `Tool[]` |
| `add_tool` | `{data: ToolData}` | `i64` |
| `update_tool` | `{id, data: ToolData}` | void |
| `delete_tool` | `{id}` | void |
| `launch_tool` | `{id}` | void |
| `browse_for_exe` | — | `string\|null` |
| `get_ql_items` | — | `QlItem[]` — Windows shell shortcuts (`ms-settings:`, `.cpl` files), seeded on first run |
| `launch_shortcut` | `{cmd}` | void — `cmd /c start "" <cmd>` |
| `list_external_apps` | — | `ExternalApp[]` — simple name+path launch targets, used only by the Dashboard pin picker's "App" type now (Tools page's own Apps UI was removed 2026-08-17) |
| `add_external_app` | `{name, path}` | `i64` |
| `remove_external_app` | `{id}` | void |
| `launch_external` | `{path}` | void |
| `pick_exe_file` | — | `string\|null` |

## Custom Tweaks
| Command | Payload | Returns |
|---|---|---|
| `get_custom_tweaks` | — | `CustomTweak[]` — user-defined tweaks, rendered below the built-in (non-DB-backed) ones on the Tweaks page |
| `add_custom_tweak` | `{data: CustomTweakData}` | `i64` |
| `update_custom_tweak` | `{id, data: CustomTweakData}` | void |
| `delete_custom_tweak` | `{id}` | void |

## Scripts

The Scripts pane (profiles, Master, drag-reorder) runs entirely on the **ScriptStash port** (`ss_*` commands) below. Only three commands remain from the original pre-port API — everything else in that surface (`add_script`/`update_script`/`delete_script`/`get_profiles`/`add_profile`/`rename_profile`/`remove_profile`/`get_profile_scripts`/`add_to_profile`/`remove_from_profile`/`set_script_disabled`/`reorder_profile_scripts`/`export_profile`/`import_profile`/`open_script_location`/`browse_for_script`/`read_text_file`) was removed 2026-08-17 as dead code with zero frontend callers, fully superseded by `ss_*` equivalents operating on the same tables.

| Command | Payload | Returns |
|---|---|---|
| `get_scripts` | `{search?}` | `Script[]` — dashboard pin picker, workflow item picker |
| `run_script` | `{id, forceAdmin?: bool}` | `RunResult` — routes through the embedded PTY (`exec::run`/`run_elevated`); `forceAdmin` overrides the script's own `run_as_admin` |
| `open_script_editor` | `{id}` | void — called internally by `ss_open_in_editor`, not directly from JS |
| `watch_script_edit` | `{id}` | void — called internally by `ss_open_in_editor`; polls the temp file every 1.5s and syncs edits back to `scripts.content`, emitting `script-synced` |

## ScriptStash (Scripts pane — profiles, Master, drag-reorder)
| Command | Payload | Returns |
|---|---|---|
| `ss_get_state` | `{profileId: i64\|null}` | `{scripts: SsScript[], profiles: SsProfile[], running: bool}` — `profileId: null` = Master |
| `ss_add_script` | `{profileId: i64\|null, data: SsScriptData}` | `SsScript` |
| `ss_edit_script` | `{scriptId, data: SsScriptData}` | `bool` |
| `ss_remove_scripts` | `{profileId: i64\|null, ids: i64[]}` | `bool` — Master = deletes globally; named profile = removes membership only |
| `ss_toggle_scripts` | `{profileId: i64\|null, ids: i64[]}` | `Record<i64, bool>` (id → new enabled state) |
| `ss_reorder_scripts` | `{profileId: i64\|null, orderedIds: i64[]}` | `bool` |
| `ss_duplicate_script` | `{profileId: i64\|null, scriptId}` | `SsScript\|null` |
| `ss_set_script_profiles` | `{scriptId, profileIds: i64[], inMaster: bool}` | `bool` — full membership set including Master |
| `ss_copy_scripts_to_profile` | `{scriptIds: i64[], targetProfileIds: i64[]}` | `i64` (count copied) |
| `ss_open_in_editor` | `{scriptId}` | `bool` — opens in default editor, watches temp file, syncs edits back to DB |
| `ss_add_profile` | `{name}` | `SsProfile` |
| `ss_rename_profile` | `{id, name}` | `bool` |
| `ss_remove_profile` | `{id}` | `bool` — does not delete member scripts (Master unaffected) |
| `ss_duplicate_profile` | `{id, newName}` | `SsProfile\|null` |
| `ss_export_profile` | `{profileId: i64\|null}` | `string` (JSON) |
| `ss_import_profile` | `{json: string}` | `SsProfile` |
| `ss_export_pick_file` / `ss_import_pick_file` | — | `string\|null` (file dialog) |
| `stop_current_run` | — | void — sets the cancel flag `exec::run`/`run_elevated` poll each tick |
| `kill_process` | `{pid: u32}` | void — `taskkill /PID /T /F`, used to kill an external elevated console on Stop |

`SsScript` adds `interactive: bool` ("Pause Script" — holds the embedded terminal open at the end instead of spawning an external console) and `inMaster: bool` (Master membership — a real toggleable flag as of 2026-08-17, not "every script unconditionally") on top of the fields shared with `Script`.

## Quick Fixes
| Command | Payload | Returns |
|---|---|---|
| `get_fixes` | `{search?}` | `Fix[]` |
| `add_fix` | `{data: FixData}` | `i64` |
| `update_fix` | `{id, data: FixData}` | void |
| `delete_fix` | `{id}` | void |
| `run_fix` | `{id}` | `RunResult` |

## Projects
| Command | Payload | Returns |
|---|---|---|
| `get_projects` | `{search?}` | `Project[]` |
| `add_project` | `{data: ProjectData}` | `i64` |
| `update_project` | `{id, data: ProjectData}` | void |
| `delete_project` | `{id}` | void |
| `open_project_path` | `{id}` | void |

## Builder
| Command | Payload | Returns |
|---|---|---|
| `get_builder_actions` | — | `BuilderDefs` |
| `build_script` | `{action_ids: string[], output_type}` | `string` |
| `run_built_script` | `{code, script_type}` | `RunResult` |
| `save_built_script` | `{code, name, scriptType, profileIds: i64[], inMaster: bool}` | void — asks which profile(s) to save into (Master checked by default) |

## Workflows
| Command | Payload | Returns |
|---|---|---|
| `get_workflows` | — | `Workflow[]` |
| `add_workflow` | `{data: WorkflowData}` | `i64` |
| `update_workflow` | `{id, data: WorkflowData}` | void |
| `delete_workflow` | `{id}` | void |
| `toggle_workflow` | `{id, enabled}` | void |
| `run_workflow` | `{id}` | `StepResult[]` — also persists to `run_log` and updates `last_run_at`/`last_run_ok` |
| `start_workflow_scheduler` | — | void (no return) — called once at app startup; polls `trigger_type='schedule'` workflows and fires `run_workflow` when due |

## Tweaks
| Command | Payload | Returns |
|---|---|---|
| `run_tweak_cmd` | `{cmd: string}` | `RunResult` |

## Backup
| Command | Payload | Returns |
|---|---|---|
| `get_backup_jobs` | — | `BackupJob[]` |
| `add_backup_job` | `{data: BackupData}` | `i64` |
| `update_backup_job` | `{id, data: BackupData}` | void |
| `delete_backup_job` | `{id}` | void |
| `run_backup` | `{id}` | `RunResult` |
| `browse_for_folder` | — | `string\|null` |

## Run Log
| Command | Payload | Returns |
|---|---|---|
| `get_last_runs` | `{item_type: "script"\|"fix"\|"tool"}` | `LastRun[]` |
| `get_run_history` | `{item_type, item_id, limit?}` | `RunHistoryEntry[]` |

`get_last_runs` returns the most recent run per item of that type.  
`get_run_history` returns the last N runs (default 10) for a single item with full captured output.

## Environment Variables
| Command | Payload | Returns |
|---|---|---|
| `get_env_vars` | — | `EnvVars` |
| `set_env_var` | `{name, value, target?: "User"\|"Machine"}` | void |
| `delete_env_var` | `{name, target?: "User"\|"Machine"}` | void |
| `open_env_editor` | — | void (opens Windows ENV editor via rundll32) |
| `add_to_path` | `{dir, target?: "User"\|"Machine"}` | void |

## Snippets
| Command | Payload | Returns |
|---|---|---|
| `get_snippets` | `{search: string}` | `Snippet[]` |
| `add_snippet` | `{data: SnippetData}` | `i64` |
| `update_snippet` | `{id, data: SnippetData}` | void |
| `delete_snippet` | `{id}` | void |

## Misc
| Command | Payload | Returns |
|---|---|---|
| `get_stats` | — | `Stats` |
| `global_search` | `{query}` | `SearchResults` |
| `open_data_folder` | — | void |
| `open_path` | `{path}` | void |

## Types

```typescript
Tool         = { id, name, category, path, args, tags, notes: string, run_as_admin: boolean }
ToolData     = { name, path: string, category?, args?, tags?, notes?: string, run_as_admin?: boolean }
Fix          = { id, name, description, category, shell_type, command, tags: string, confirm_required, run_as_admin: boolean }
FixData      = { name, command: string, description?, category?, shell_type?, tags?: string, confirm_required?, run_as_admin?: boolean }
Project      = { id, name, description, type, status, path, tags, notes: string }
ProjectData  = { name: string, description?, type?, status?, path?, tags?, notes?: string }
Script       = { id, name, description, category, file_path, script_type, tags, status, icon: string, run_as_admin, interactive: boolean, content?: string, sort_order: number, disabled: boolean }  // sort_order/disabled always 0/false from get_scripts (only meaningful for the removed get_profile_scripts); live pane uses SsScript below
RunResult    = { success: boolean, output: string }
EnvVar       = { name: string, value: string }
EnvVars      = { user: EnvVar[], system: EnvVar[] }
Snippet      = { id, title, content, category, tags, created_at: string }
SnippetData  = { title, content, category?, tags?: string }
Stats        = { tools, scripts, fixes, projects, workflows, runs: number }
PinnedItem   = { id, item_type, item_id, item_name, item_icon, item_meta, group_name, sort_order }  // item_meta: cmd for 'ql', path for 'app', empty otherwise
SearchResults= { tools, scripts, fixes, projects, workflows, snippets, quick_launch, apps: SearchResult[] }
SearchResult = { item_type, id, name, meta: string }  // item_type: 'tool'|'script'|'fix'|'project'|'workflow'|'snippet'|'ql'|'app'
LastRun      = { item_id: number, success: boolean, ran_at: string }
RunHistoryEntry = { id: number, success: boolean, ran_at: string, output: string }
Workflow     = { id, name, description, steps: string (JSON), enabled: boolean, trigger_type, trigger_config: string (JSON), last_run_at?, last_run_ok?: boolean, created_at: string }
WorkflowData = { name, description?, steps: string (JSON) }
StepResult   = { label: string, success: boolean, output: string }
BackupJob    = { id, name, source, dest, last_run?: string, created_at: string }
BackupData   = { name, source, dest: string }
ActivityEntry= { item_type, item_name, success: boolean, ran_at: string }
SysInfo      = { hostname, username, os, ram_gb, cpu: string, boot_epoch_ms: number }
PerfStats    = { cpu_pct: number, ram_used_gb, ram_total_gb: number, net_name: string, net_recv_bytes, net_sent_bytes: number, drives: DriveInfo[] }
DriveInfo    = { name: string, used_gb, total_gb: number }
ShellInfo    = { name, path: string, args: string[] }
QlItem       = { id, label, icon, cmd: string }
ExternalApp  = { id, name, path: string }
CustomTweak  = { id, category, label, description, apply_cmd, revert_cmd: string, admin: boolean, sort_order: number }
CustomTweakData = { category?, label, description?, apply_cmd?, revert_cmd?: string, admin?: boolean }
```
