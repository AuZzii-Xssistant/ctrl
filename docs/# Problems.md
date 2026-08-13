Most Scripts and stuff does not work.
✅ FIXED — Root cause was Tauri v2 camelCase param mismatch: JS was sending snake_case keys (item_type, item_id) but Tauri v2 expects camelCase (itemType, itemId). All invoke calls updated. get_last_runs, get_run_history, pin_item now work correctly.

There is no way of auto running scripts with admin that requires it. Can we not bridge the outputs?
✅ FIXED — Output is now bridged for admin runs: command written to temp PS1, run elevated with Start-Process -Verb RunAs -Wait -WindowStyle Hidden, output captured via Out-File and returned to the output drawer + logged to run history. If UAC is cancelled, output reads "(No output — UAC may have been cancelled)".

Pin Something does not work.
✅ FIXED — Two bugs: (1) Tauri v2 camelCase mismatch — pin_item was called with snake_case keys, now uses itemType/itemId/groupName. (2) pin_item was not idempotent (now returns existing ID instead of error). Picker also shows already-pinned items dimmed.

Content touching sticky bar (all panes — settings, tweaks, everywhere).
✅ FIXED — Root cause: .tweaks-note and other first-child elements have explicit margin:0 which overrode the margin-top:12px rule. Fixed by giving .pane-divider { height: 12px } instead of display:none — a physical spacer that cannot be collapsed by child element margins.

We added bottom padding on sticky bars but still stuff is touching maybe we have a way that stuff starts a bit lower from the bar.
✅ FIXED — See above (pane-divider height fix, applies globally).

Like even on system tweaks the message directly touch the line of the sticky bar. Fix on all pages not just those ones.
✅ FIXED — See above (global fix, applies to all panes including tweaks).

Quick Fixes shows no history even if something was ran. History button broken in this sense.
✅ FIXED — Root cause was Tauri v2 camelCase mismatch: get_run_history was called with item_type/item_id (snake_case) which Tauri v2 could not deserialize, silently returning [] due to .catch(() => []). Now uses itemType/itemId. Also fixed for scripts.

The app uses save info auto complete in most input fields should be off.
✅ FIXED (Major Upgrade 5) — openModal() now applies autocomplete="off", autocorrect="off", spellcheck="false" to all modal inputs centrally.

There is a default right click as if I am in a browser most places or everywhere except where we added our custom right click already.
✅ FIXED (Major Upgrade 5) — Global document.addEventListener('contextmenu', e => e.preventDefault()) suppresses browser context menu everywhere.

Settings the first div for >_CTRL is touching the toolbar top ensure there are no such problems in future for all stuff we create. Also fix it in settings.
✅ FIXED — pane-divider height fix covers this globally.

Some places we get the ugly white scrollbar for horizontal and vertical make sure all scrollbars are always custom and neat.
✅ FIXED (Major Upgrade 5) — Global ::-webkit-scrollbar rules applied to all elements.

Make search the ctrl k or ctrl f currently default shortcuts for a browser exist. Like the ctrl f of a page as if it was a browser.
✅ FIXED (Major Upgrade 5) — keydown handler blocks Ctrl/Meta + F, G, H, U, P, J, R globally.

The output popup looks weird at times. Can we have it like pinned as close even if we did not yet run a command but we have to expand it by choice not auto expand.
✅ FIXED (Major Upgrade 5) — Output drawer is always visible as a thin collapsed bar. Click header or chevron to expand. Amber pulse dot signals new output without auto-opening.

Recent activity should not be on the dashboard. We can move it to a tab called Recent Activity and that tab icon should be just above the settings icon.
✅ FIXED (Major Upgrade 5) — Dedicated "Recent Activity" pane added (activity.js). Nav button with ti-history icon positioned above settings. Dashboard now shows only stats + pinned launchpad.

I noticed there is no way to edit add or remove system tweaks
⏳ DEFERRED — System Tweaks CRUD not yet implemented. Planned for future Major Upgrade.

Our Script Builder should be WinScript https://github.com/flick9000/winscript so clone it make a sub module of it we need it to stay the way it is but create our own script to convert their code into our module so it will be easy for us to update when they release an update. I want it to look and work like theirs and have all their stuff in ours but obviously we use our look and feel etc. We should also add a save script in the builder so if we toggled stuff we want we can either run it or save script and our save script will save it to our scripts page. So this in itself is major.
⏳ DEFERRED — WinScript integration is a major feature requiring its own session. Planned.
