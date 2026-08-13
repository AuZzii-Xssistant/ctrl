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

## Tools
| Command | Payload | Returns |
|---|---|---|
| `get_tools` | `{search?}` | `Tool[]` |
| `add_tool` | `{data: ToolData}` | `i64` |
| `update_tool` | `{id, data: ToolData}` | void |
| `delete_tool` | `{id}` | void |
| `launch_tool` | `{id}` | void |
| `browse_for_exe` | — | `string\|null` |

## Scripts
| Command | Payload | Returns |
|---|---|---|
| `get_scripts` | `{search?}` | `Script[]` |
| `add_script` | `{data: ScriptData}` | `i64` |
| `update_script` | `{id, data: ScriptData}` | void |
| `delete_script` | `{id}` | void |
| `run_script` | `{id}` | `RunResult` |
| `open_script_editor` | `{id}` | void |
| `open_script_location` | `{id}` | void |
| `browse_for_script` | — | `string\|null` |

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
| `save_built_script` | `{code, name, script_type}` | void |

## Workflows
| Command | Payload | Returns |
|---|---|---|
| `get_workflows` | — | `Workflow[]` |
| `add_workflow` | `{data: WorkflowData}` | `i64` |
| `update_workflow` | `{id, data: WorkflowData}` | void |
| `delete_workflow` | `{id}` | void |
| `run_workflow` | `{id}` | `StepResult[]` |

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

## Misc
| Command | Payload | Returns |
|---|---|---|
| `get_stats` | — | `Stats` |
| `global_search` | `{query}` | `SearchResults` |
| `open_data_folder` | — | void |

## Types

```typescript
RunResult    = { success: boolean, output: string }
Stats        = { tools, scripts, fixes, projects: number }
PinnedItem   = { id, item_type, item_id, item_name, item_icon, group_name, sort_order }
SearchResults= { tools, scripts, fixes, projects: SearchResult[] }
SearchResult = { item_type, id, name, meta: string }
LastRun      = { item_id: number, success: boolean, ran_at: string }
RunHistoryEntry = { id: number, success: boolean, ran_at: string, output: string }
Workflow     = { id, name, description, steps: string (JSON), created_at: string }
WorkflowData = { name, description?, steps: string (JSON) }
StepResult   = { label: string, success: boolean, output: string }
BackupJob    = { id, name, source, dest, last_run?: string, created_at: string }
BackupData   = { name, source, dest: string }
ActivityEntry= { item_type, item_name, success: boolean, ran_at: string }
```
