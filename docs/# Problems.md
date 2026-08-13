Most Scripts and stuff does not work.
✅ FIXED (Major Upgrade 5) — Added run_as_admin flag. Seeded fixes requiring admin now use UAC elevation via Start-Process -Verb RunAs.

There is no way of auto running scripts with admin that requires it.
✅ FIXED (Major Upgrade 5) — run_as_admin DB column added to fixes and scripts. Admin checkbox in Add/Edit modal. Shield badge on admin rows. UAC elevation logic in Rust run_fix/run_script. Note: output is not captured for elevated processes (known limitation, see docs/known-issues.md).

Pin Something does not work.
⚠️ INVESTIGATED — Static analysis shows code looks correct. Needs runtime debugging. Deferred.

We added bottom padding on sticky bars but still stuff is touching maybe we have a way that stuff starts a bit lower from the bar
✅ FIXED (Major Upgrade 5) — .pane-divider + * { margin-top: 12px } ensures content starts below the sticky divider even when divider is display:none.

Like even on system tweaks the message directly touch the line of the sticky bar. Fix on all pages not just those ones.
✅ FIXED — See above (global fix, applies to all panes).

The app uses save info auto complete in most input fields should be off.
✅ FIXED (Major Upgrade 5) — openModal() now applies autocomplete="off", autocorrect="off", spellcheck="false" to all modal inputs centrally.

There is a default right click as if I am in a browser most places or everywhere except where we added our custom right click already.
✅ FIXED (Major Upgrade 5) — Global document.addEventListener('contextmenu', e => e.preventDefault()) suppresses browser context menu everywhere.

Quick Fixes shows no history even if something was ran. History button broken in this sense.
⚠️ PARTIALLY ADDRESSED — Added UTF-8 encoding prefix to PowerShell output capture. Root cause still unclear; most likely admin-required fixes were failing before DB insert (now fixed with run_as_admin). Monitor in next loop.

Settings the first div for >_CTRL is touching the toolbar top ensure there are no such problems in future for all stuff we create. Also fix it in settings.
✅ FIXED (Major Upgrade 5) — Settings pane wrapped in pane-scroll container with pane-header and pane-divider. Global sticky gap fix applied.

Some places we get the ugly white scrollbar for horizontal and vertical make sure all scrollbars are always custom and neat.
✅ FIXED (Major Upgrade 5) — Global ::-webkit-scrollbar rules applied to all elements (not just .pane-scroll).

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
