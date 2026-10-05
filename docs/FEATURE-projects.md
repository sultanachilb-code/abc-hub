# Operations Future Projects + Project Tracker

Folder **Operations Projects and Budget**, two tiles opening `/tools/projects`:

* **Operations Future Projects** — a board: *Idea → Planned → Approved* (drag a card to move it on a laptop; or set the stage in the project).
* **Project Tracker** — *In progress / On hold* (and *Completed* with “Show completed”): RAG colour (late = red), progress bar, milestones done, spent vs budget, and a **timeline** (month bars with today's line).
* A project has owner, contractor, location, start, due, budget estimate, spent, priority, category, description, **milestones** (progress is calculated from them when there are any) and an **updates log** (each update can also set spent / progress).
* **Linked CAPEX line**: pick the project's line from *Budget (CAPEX / OPEX)* — its budget is shown from there.
* Alerts (once each): project past its due date, milestone due today, milestone overdue. New approved / in-progress project → notification to the flagship.
* Operations team edits; everyone with the flagship reads. Changes go to **Change history**.

Files: `modules/projects.js` · `tools/projects.html` · table `projects` · cron `projectsRun` (from 08:00).
