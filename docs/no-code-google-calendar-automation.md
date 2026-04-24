# No-Code Automated Task Calendar (Google Calendar + Airtable + Zapier)

This setup gives you:
- Task capture from ChatGPT message format.
- Google Calendar event creation/updates.
- Daily recurring non-negotiables that reset each day.
- Status workflow (`not started`, `in progress`, `completed`, `skipped`).
- Urgency tiers (`low`, `medium`, `high`, `critical`).
- Two reminders per task via Google Calendar notifications.
- SMS reminders via Zapier + Twilio.
- 10:00 AM daily summary.

## Locked-In Preferences (Your Choices)

- Calendar: **Google Calendar**
- Reminder offsets: **60 minutes + 10 minutes**
- Daily summary time: **10:00 AM**
- Time zone: **America/New_York** (New Jersey time)
- Non-negotiables streak tracking: **Enabled**
- Skipped task behavior: **Optional rollover** using a `Show Until Finished` toggle per task

## 1) Stack (No Code)

- **ChatGPT**: You send your morning tasks in a structured template.
- **Airtable**: Source of truth for tasks, statuses, non-negotiables, and history.
- **Zapier**: Automation glue for create/edit/complete flows.
- **Google Calendar**: Calendar events + push reminders.
- **Twilio (SMS)**: Text reminders.

## 2) Airtable Base Design

Create a base named `Life OS`.

### Table: `Tasks`
Fields:
- `Task ID` (autonumber)
- `Title` (single line text)
- `Due DateTime` (date + time)
- `Urgency` (single select: low, medium, high, critical)
- `Category` (single select: work, health, personal, admin, other)
- `Notes` (long text)
- `Status` (single select: not started, in progress, completed, skipped)
- `Show Until Finished` (checkbox)
- `Is Non-Negotiable` (checkbox)
- `Recurrence` (single select: none, daily)
- `Streak Count` (number)
- `Calendar Event ID` (single line text)
- `Last Updated` (last modified time)

### Table: `Daily Log`
Fields:
- `Date` (date)
- `Task` (link to `Tasks`)
- `Was Completed` (checkbox)
- `Completion Time` (date + time)

## 3) Google Calendar Setup

1. Create a dedicated calendar: `Life Tasks`.
2. In calendar settings, default notifications:
   - Push: 60 minutes before.
   - Push: 10 minutes before.
3. Keep phone Google Calendar notifications enabled.
4. Set calendar + Zapier account timezone to `America/New_York`.

## 4) Zapier Automations

## Zap A — Create Calendar Event for New/Updated Task
Trigger:
- Airtable: New or Updated Record in `Tasks` where `Due DateTime` is not empty.

Actions:
1. Filter: status is not `completed`.
2. Formatter: map urgency to emoji prefix (optional):
   - critical = 🔴
   - high = 🟠
   - medium = 🟡
   - low = 🟢
3. Google Calendar: Create Detailed Event (if no `Calendar Event ID`) OR Update Event (if ID exists).
4. Airtable: save `Calendar Event ID` back into record.

Event title format:
`[{{Urgency}}] {{Title}}`

Event description format:
`Category: {{Category}}\nStatus: {{Status}}\nNotes: {{Notes}}\nTask ID: {{Task ID}}`

## Zap B — SMS Reminder (2 reminders)
Trigger:
- Schedule by Zapier every 5 minutes.

Actions:
1. Airtable Find Records where:
   - status in (`not started`, `in progress`)
   - due time within next 60 min OR next 10 min
2. Twilio: Send SMS (at T-60 and T-10 only).

SMS template:
`Reminder: {{Title}} is due at {{Due DateTime}} ({{Urgency}}).`

Use a dedupe key in Airtable (e.g., `Last Reminder Sent`) to avoid duplicate sends.

## Zap C — Complete Task by Natural-Language Command
Trigger options:
- Chat channel webhook (e.g., Zapier Chatbot/Webhook)
- Manual Airtable update from mobile

Actions:
1. Parse command (examples):
   - `mark reading completed`
   - `move gym to 7:00 PM`
   - `make tax filing critical`
2. Airtable: update target task.
3. Google Calendar: update matching event.

## Zap D — Daily Reset for Non-Negotiables
Trigger:
- Schedule by Zapier at 12:01 AM local time.

Actions:
1. Find `Tasks` where `Is Non-Negotiable = true` and `Recurrence = daily`.
2. Set status to `not started`.
3. Shift due date to current date with preferred time.
4. Keep streak logic enabled for daily non-negotiables.

## Zap E — Streak Tracking
Trigger:
- Airtable record changes to `Status = completed`.

Actions:
1. If task is non-negotiable and completed today, increment `Streak Count`.
2. Write record in `Daily Log`.

Optional nightly check:
- At 11:59 PM, for daily non-negotiables not completed, reset streak to 0.

## Zap G — Optional Rollover for Skipped/Unfinished Tasks
Trigger:
- Schedule by Zapier at 11:55 PM in `America/New_York`.

Actions:
1. Find tasks where:
   - `Status` is `skipped` OR (`Status` is not `completed` and due date is today)
   - `Show Until Finished = true`
2. Move `Due DateTime` to next day (same time).
3. Set `Status` to `not started` (or keep `in progress`, based on preference).
4. Update Google Calendar event with new time.

## Zap F — 10:00 AM Morning Summary
Trigger:
- Schedule by Zapier daily at 10:00 AM.

Actions:
1. Airtable find today’s tasks.
2. Build summary grouped by urgency/category.
3. Send summary via SMS.

Summary template:
- Critical:
- High:
- Medium:
- Low:
- Non-negotiables left:

## 5) Message Template You Send Each Morning

Use this with ChatGPT (or any parser step):

```text
Date: YYYY-MM-DD
Tasks:
- Title: <task>
  Due: <time>
  Urgency: <low|medium|high|critical>
  Category: <work|health|personal|admin|other>
  Show Until Finished: <yes|no>
  Notes: <optional>

Non-Negotiables:
- Title: <task>
  Due: <time>
  Category: <health|personal|other>
  Show Until Finished: <yes|no>
  Notes: <optional>
```

## 6) Editable + Iterable Design Rules

- Never delete task history; use status transitions.
- Keep Airtable as source of truth.
- Keep `Calendar Event ID` for reliable updates.
- Prefer update over recreate to preserve notification settings.

## 7) Recommended Build Order (90 minutes)

1. Build Airtable base and fields.
2. Connect Airtable + Google Calendar in Zapier.
3. Create Zaps A + D + F first.
4. Add Twilio SMS (Zap B).
5. Add natural-language edit commands (Zap C).
6. Add streaks (Zap E).
7. Add optional unfinished rollover (Zap G).

## 8) Remaining Decisions

- Exact SMS provider account and sender number.
- Should rollover keep status as `not started` or `in progress`.
