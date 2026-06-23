# DevFlow

A Pomodoro timer built for people who want to track not just focus time, but everything — work, study, interruptions, and distractions. At the end of the week you can see exactly where your time went: how many hours on which projects, how much was deep work, and how much was lost to things that pulled you away.

Pure static site — open `index.html` in any browser. No server, no build step, no accounts. All data stays in your browser.

---

## What it's good for

- Working across multiple projects or contexts (work, side projects, study) and wanting to see time split between them
- Tracking distractions honestly rather than ignoring them — log what interrupted you and for how long, without stopping your focus timer
- Setting a daily time goal per project and knowing when you hit it
- Getting a clear weekly summary: how many hours per category, per project, per day

---

## Features

- **Timer** — focus, short break, and long break modes with a visual ring
- **Projects** — multiple projects tracked independently, each with its own focus/break durations and a daily time goal
- **Categories** — user-defined groupings (e.g. Work, Study, Personal). Mark a category as "distraction" to separate it in reports
- **Side-note log** — stamp a distraction or interruption mid-session without stopping your timer (`D` key)
- **Activity log** — live log of every session and event
- **Daily report** — one line per project and task, copy-paste ready
- **Weekly report** — time breakdown by category and by project, one column per day
- **Two themes** — Tokyo Night (dark) and Tokyo Day (light), toggle in the header
- **Persistent** — timer state, sessions, projects, and settings all survive browser close and restarts

---

## How to use

### First time setup

1. Open `index.html` in your browser
2. Click `+` → **manage categories** to create your own categories (e.g. Work, Study, Distractions)
3. Create projects and assign them to categories
4. Set per-project timer durations in the project modal

### Daily workflow

1. Pick a project from the dropdown
2. Optionally type a task label: `PRE-8555 #feature #review`
3. Press **Space** to start
4. If something interrupts you, press **D** — type what it was and how long, hit Enter. Your timer keeps running
5. Check the **reports** tab at the end of the day or week

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Start / pause timer |
| `D` | Open side-note / distraction log |
| `R` | Reset timer |
| `S` | Skip to next session |
| `1` | Switch to Deep Work mode |
| `2` | Switch to Coffee Break mode |
| `3` | Switch to Long Break mode |
| `Esc` | Close any open panel |

### Managing projects and categories

- **Edit a project** — click the **✎** button on any project row in the left sidebar
- **Delete a project** — edit modal → "delete" button (past sessions are kept in history)
- **Manage categories** — open any project modal → "manage categories" link next to the category field
- **Delete a category** — category manager → ✕ button (only works if no projects are assigned to it)

### Reports

- Switch to the **reports** tab in the header
- Pick a date and choose **daily** or **weekly** view
- **Daily** — one line per project and task combination with total time
- **Weekly** — time breakdown by category and by project across the week
- Hit **copy** to copy to clipboard

---

## Label format

The task input supports a simple format:

```
PRE-8555 #feature #review
```

- Everything before the first `#` becomes the task name
- `#words` become tags
- Both appear in reports and the activity log
