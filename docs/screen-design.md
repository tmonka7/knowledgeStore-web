# Knowledge Store — Screen Design Document

Version 1.0 · 21 September 2026

## 1. Shell and navigation

Every signed-in screen sits inside one shell:

```
┌──────────────┬───────────────────────────────────────────────┐
│              │  Header: page search · language · avatar menu │
│   Sidebar    ├───────────────────────────────────────────────┤
│   (240px)    │  PageHeader: title · subtitle · actions       │
│              │                                               │
│  menu items  │  Content: stat cards → filters → panels       │
│  filtered by │                                               │
│  permission  │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

**Sidebar order:** Overview · Users · Data · Camera Management · Project
Management · Schedule · Tools (LVGL, Converting, and an **AI** group holding
YOLO, TTS, Transformers and Keras) ·
Chat · Mail · Meetings · Posts · Database Management · System Monitoring ·
Basic Data (Category).

A menu entry is present only if the account can view that page; a parent with
no visible children disappears with them. **My Page is not in the sidebar** —
it is reached from the avatar menu in the header, because it belongs to the
person rather than to the organisation.

**Chat** and **Posts** carry a count as a blue badge on their own label —
unread messages, and posts this account has not opened.

The **notification bell** holds two groups: "*n* new post(s)" above, then
"due tomorrow" for the schedule, separated by a rule. Its badge is the sum.
Choosing a post opens it on the Posts page; choosing a reminder opens the
Schedule. With nothing in either group it reads "nothing due tomorrow".

**Header icons**, right of the clock and language selector: a **mail** icon, a
**message** icon, the notification bell, then the user menu.

Mail and messages are built the same way, deliberately — two inboxes that
behaved differently would be two things to learn. Each carries its unread
total as a badge and opens a menu of the five newest items: who it is from in
bold, a one-line preview (the subject, for mail), the time on the right, and a
dot marking an unread one. Choosing one opens that page **on that item** — the
conversation, or the message, switching to the Inbox if Sent was open. The
last entry ("Open Chat" / "Open Mail") goes to the page without picking one.
An account that cannot use Chat, or Mail, does not see that icon at all.

The browser tab carries `frontend/public/favicon.svg` — the same rounded
square, gradient and shield as the sidebar's brand mark, so the tab and the
application agree.

## 2. Shared page grammar

| Region | Component | Rule |
|---|---|---|
| Page heading | `PageHeader` | Title, one-line subtitle, action buttons on the right. Refresh is a ghost button; the primary action is filled. |
| Summary | `StatCard` grid | Four cards: tone, icon, label, value, optional trend and one line of meta. |
| Filters | `FilterBar` | One row above the content. Search on the left, selects after it, Clear on the right. |
| Content | `vision-panel` | A titled panel per block; tables scroll horizontally inside `vision-table-scroll`. |
| Row actions | `vision-row-actions` | Icon-only 34px buttons. Each carries a tooltip and an accessible label naming its subject; no text labels, because the row is narrow and the icon already says it. |
| Empty state | antd `Empty` | Says what is missing and what would fill it. |

Colour tokens come from `vision.css`. Categorical chart series are blue and
amber, never green and red.

## 3. Screen catalogue

### 3.1 Sign in / Register

Split layout: artwork and face-scan illustration on one side, the form on the
other, with a switch between Login and Register.

- **Login:** username, password, Remember me, Sign in, then a divider reading
  "or" and a **Login with Face** button that opens a camera modal.

  The divider is the point. These are two ways in, not two steps: the face
  button no longer validates the username and password first, and sends no
  username at all. Pressing it opens the camera straight away, and the face on
  its own identifies the account.

  A failed capture leaves the modal open to try again rather than closing and
  making the person start over.
- **Register (top to bottom):** an information banner saying new accounts need
  an administrator's approval, then Full name · Username · Email · Password ·
  Confirm password · **Gender** (select: Male / Female / Other, clearable) ·
  **Birthday** (date picker, future dates disabled) · **Phone number** ·
  **Job** · **Address** · face capture panel · Register.

  The banner sits above the form rather than appearing as a message after it
  is submitted: somebody expecting to be signed in at the end should find that
  out before filling anything in. On success the card returns to the Login
  side, because there is nothing more to do here until an administrator acts.

The five personal fields are optional and carry no asterisk. So is the face
capture panel: it says "optional" under its heading, its status line reads
"Face not registered — optional" against an information icon rather than a
warning one, and once a photo is taken a **Remove** button appears beside
Change Face. Nothing on the panel blocks the form.

### 3.2 Overview

Stat cards for records, users, categories and cameras, a category
distribution chart and a recent-activity list.

### 3.3 Users

Header actions: **Refresh** and Add User (administrators only). The list is
re-read whenever the page is opened, so an account created during the session
is present without a reload.

Stat cards: Total users · Administrators · Regular users · Face ID enrolled ·
**Waiting for approval**. The last one is the only card on the page that is a
job rather than a number — somebody registered and cannot use the system until
it reaches zero — so it is amber whenever it is not zero, and its sub-line
carries the denied count.

Filter bar: search text, role, face-enrolment state, **status**, Search and
Reset.

Table columns: Name · Photo · Username · Email · Role · **Status** · Access ·
Actions.

**Status** is a pill: Pending in amber with a dot, Allowed in green, Denied in
red. Amber rather than red for Pending, because it is a question waiting for an
answer and not a failure; red is kept for the decision to refuse.

**Actions** per row, for administrators: **Allow** (shown unless already
allowed), **Deny** (unless already denied), edit, and delete. Allow and Deny
act from the list without opening anything — approving a morning's
registrations should not mean opening five dialogs.

Deny and Delete are absent from your own row rather than shown and refused. The
API blocks both either way, and a button that can only fail is not a choice.

**Deleting an account** asks with a dialog built from a server-side count of
what will actually go: a list of what is destroyed — "12 data records (with
their files)", "4 chat conversations (deleted for the other person too)", "2
meetings they host (with their recordings)" — and, separately, what is kept and
unlinked: projects whose ownership passes to you, tasks that are unassigned.
A red line at the bottom says it cannot be undone. Where the account would be
the last administrator able to sign in, a warning dialog explains that instead
of offering the choice.

**User editor** (modal, three tabs):

| Tab | Contents |
|---|---|
| Basic Info | Face photo card with Choose File; Full name; Email; **Gender**; **Birthday**; **Phone number**; **Address** (two-row text area); **Job**; Role (disabled when editing yourself). |
| Permissions | A page × action matrix with Grant all / Clear all. Replaced by an explanatory banner when the role is Admin, since an admin bypasses the list. |
| Logs | Recent activity for that account. |

### 3.4 My Page

Reached from the avatar menu. Tabs: **Account**, **Wallet** (if permitted),
**Contacts** (if permitted).

The Account tab stacks three panels:

1. **Profile** — face photo beside a fact list: Name, Username, Email,
   Gender, Birthday, Phone, Job, Address, Member since. A note states that
   name, email and face photo are changed by an administrator.
2. **Personal details** — an editable form for the five personal fields
   (gender, birthday, phone, job in a two-column grid; address full width)
   with a Save details button.
3. **User settings** — current password, new password, confirmation.

### 3.5 Wallet (page, and the Wallet tab of My Page)

Embedded in My Page the toolbar sits on its own line, because that page
already carries a header; otherwise the toolbar lives in the PageHeader.
Toolbar: Refresh · Add entry.

**Statistics show both currencies at once.** There is no currency selector
anywhere on the page, because there is nothing to choose between: every
figure is reported per currency.

```
┌ Income · USD ┬ Expense · USD ┬ Balance · USD ┬ Entries · USD ┐
├ Income · REM ┼ Expense · REM ┼ Balance · REM ┼ Entries · REM ┤
└──────────────┴───────────────┴───────────────┴───────────────┘
 Filters: date range · type · category · months

 ┌ Income and expense ─────────────────────────────────────────┐
 │ [USD]  grouped bars, one pair per month                     │
 │ ────────────────────────────────────────────────────────    │
 │ [REM]  grouped bars, one pair per month                     │
 └─────────────────────────────────────────────────────────────┘
 ┌ Running balance (USD, REM) ─┬ Spending by category (USD, REM)┐
 ┌ Income by category (USD,REM)┬ Monthly figures table          ┐
 └ Entries table                                                ┘
```

Each block inside a panel is introduced by a small pill carrying its currency
code, separated from the next by a rule. A currency with no entries shows
"Nothing recorded in <code>" rather than an empty axis.

- **Monthly figures** table columns: Month · Currency · Income · Expense · Net.
- **Entries** table columns: Date · Type · Category · Note · Method ·
  **Currency** · Amount · Actions. The amount is prefixed + or − and formatted
  in the entry's own currency.
- **Entry dialog:** Type (Income / Expense radio) · Amount · **Currency**
  (USD / REM, preselected from the last entry, with the note "Kept per entry;
  totals are never converted") · Date · Category · Method · Note.

### 3.5a Data — sharing a record

The last control in both the add and edit dialogs, directly under the
attachment picker:

```
 Share with   [ Everyone ]  [ Selected people ]

 People       [ ⌄ Ada Lovelace (ada) × ] [ ⌄ … ]
              Nobody selected — only you can see this record.
```

Two questions rather than one list with an "everyone" entry in it: sharing
with everyone and sharing with a named set are different answers, and a list
that mixes them lets a record claim both at once. The people picker appears
only when **Selected people** is chosen, searches by name and username, and
leaves the owner out — they always have access, so an empty selection means
"only me" and the hint says so.

The record detail dialog states the result beside the category tag: *Shared
with everyone*, *Shared with Ada Lovelace, Grace Hopper*, or *Private to you*.

In the record table, the edit and delete buttons are absent on a record you do
not own; the preview button is always there.

### 3.6 Chat

Two columns: conversation list and the open thread.

- **List:** one search box that both filters existing conversations and looks
  up people to start a new one; results appear under a "People" heading.
  Each row: avatar, name, time, preview, unread badge. A conversation whose
  last message is a file previews it as `📎 <file name>`.
- **Thread:** day dividers, bubbles right-aligned for your own messages, a
  clock time and a one-or-two-tick receipt on your own bubbles.
- **Attachment bubble:** file-type icon, file name, and a meta line of size
  and remaining retention ("Deleted in 5 days"). It is a download link while
  the file exists. Once swept, the same row is dimmed, is no longer a link,
  and the name carries its `(deleted)` tag.
- **Composer:** a paper-clip button, the text area, and Send. Above it, one
  line states that files are deleted a week after they are sent and that the
  name is tagged in the conversation. Anything typed in the box when a file is
  chosen is sent as the note on that file.

### 3.7 Project Management

Card grid, one card per project: colour accent, key, name, status badge,
description, progress bar with "x of y tasks done", and four counts (Open, In
progress, To verify, Reopened). The footer holds the due date and three
icon-only actions — Edit, Delete, Open — each with a tooltip and a label
naming the project.

**Project detail** replaces the list in place. It offers a Kanban board with
one column per status, a table view, and a task drawer showing the report,
the bug fields, attachments, comments and the full history. Only the moves
the lifecycle allows are offered as buttons; columns that cannot accept the
dragged card are dimmed.

### 3.7a Mail

Two columns. The left one holds the folder switch — **Inbox** (with its unread
count) and **Sent** — a search box, and the message list. An unread message
carries a bold subject and a dot; a sent one carries an "Opened *n*/*m*" chip.

The reading pane shows the sender, the recipients, the time, the body, and the
attachment with its size. Then the open tracking, which differs by side:

- **Sent:** "Opened by 2 of 3", and a row per recipient — name, then either
  *Opened 14 Mar 14:12* or *Not opened yet*.
- **Inbox:** one line, either when you opened it or a note that opening it
  marks it read for the sender.

Reply and Delete sit at the top right; Reply is offered only on a message you
received, Delete only with the permission.

**Compose** is a dialog: recipients as a multi-select of accounts (never a
typed address), subject, the rich-text editor, and one attachment.

### 3.7b Posts

Table: Title (pinned ones first, marked with a pin, with a **New** badge until
you open it) · Author · Posted · **Read by** · Actions.

The "Read by" cell is a count that is itself a button — the number and
"exactly who" are one question, so one leads to the other. It opens a dialog
listing every reader with the time they opened it.

Clicking a title opens the post: author, date, and the rich-text body, with
"Read by *n*" in the footer. Opening is what records your view, which is what
takes it off the notification count.

New post, Edit and Delete appear only with the matching permissions; the
editor is a dialog with Title, the rich-text editor and a "Pin to the top"
switch.

### 3.7c Meetings

**List.** Page header with Refresh and New meeting. Four stat cards: In
progress, Upcoming, Recordings, Meetings. A filter row — search, and a status
selector (All / In progress / Upcoming / Ended). Below that, a card grid.

A meeting that is in progress is outlined in green and carries a dotted "Live"
badge; it also names who is in the call, because "3 people" is not the
information that makes somebody decide to join. Each card shows the host, when
it is, and whether it is open to everyone or limited to named people; a footer
carries the attendance count, the recordings count, and the actions — Edit, End
and Delete for the host or an administrator, and Join for anyone.

If the browser cannot reach a camera at this address — a plain `http://` page
that is not `localhost` — a warning panel sits directly under the page header.
It is deliberately there and not on the Join button: discovering the camera is
unavailable in front of everyone already in the call is the wrong moment.

**Room.** Joining replaces the page rather than routing away, the same way
opening a camera or a project does, so leaving returns to the list as it was.

A header line carries the title and a count of who is in the call, plus a
recording pill while one is running. Under it, any of: a warning that somebody
is recording, a notice that you joined without a camera, an error. Then the
tile grid — one tile fills the frame, two sit side by side, more flow into a
responsive grid. Each tile shows the name, a microphone icon when that person
is muted, a camera icon in amber when their camera is off, a screen icon when
they are presenting, and a red REC badge when they are recording. A tile with
no picture shows the person's initials, not an empty black rectangle.

The in-call chat is a panel on the right, toggled from the control bar and
stacking underneath the video on narrow screens. Its button carries an unread
count while the panel is closed.

The control bar is a row of circular buttons: microphone, camera, screen
share, record, chat, leave. Off is the state that gets the colour — a muted
microphone is amber, an active share or open chat is blue, a running recording
is red — because the state worth noticing should not look like every other
button on the bar. Leaving while recording asks first, and saves the recording.

### 3.8 Database Management

Four panels: Initialization (safe or reset, the latter requiring the word
RESET and superuser details), Backups (create, upload, list, inspect,
restore, download, delete), Replication (status, initiate, members), and
Optimization (task list with per-task results).

### 3.9 System Monitoring

Cards for API latency, browser heap, record and user counts, and line charts
of the measured series. Nothing on this page is simulated.

### 3.10 Remaining screens

| Screen | Shape |
|---|---|
| Data | Filter bar (text, category, mode, date range), table, record detail drawer with Word export, add/edit modal with a rich-text editor, attachments and the sharing control below them. |
| Category | Tree with add and delete. |
| Camera Management / Camera Wall | Card grid of cameras with a preview or a "no preview" placeholder, status badge, protocol chip and per-card actions (Edit and Delete only with the permission); a wall of live tiles; a single-camera view with fullscreen and object detection. |
| Schedule | Month view with an entry dialog and an upcoming list. |
| Contacts (My Page tab) | Searchable list with favourite toggle and a contact dialog. |
| Tools | LVGL and Converting sit directly under Tools; YOLO, TTS, Transformers and Keras sit in an **AI** group beneath them, since those are about models where the other two are file converters. Both image tools — Converting and the LVGL image tab — take SVG as well as raster input, and render the vector at each output size rather than scaling one decode of it. Converting also emits SVG, by tracing. The LVGL tab emits the v9 `lv_image_dsc_t` form and says so on the output card. YOLO has a Labelling tab: a folder picker on the left with the class list, the image on a canvas in the middle, and the shape list and exports on the right. TTS mirrors that shape for audio: folder picker, rejected-file list and exports on the left; the player and transcript box in the middle; the text history on the right, ticking off clips as they are done. |

## 4. Interaction rules

- A destructive action **always** confirms — there is no exception anywhere in
  the application — and the confirmation states what else it takes with it
  ("its 12 tasks, with every comment and the whole history"), not merely "are
  you sure?". Where the scope can only be known by asking the server, it is
  asked before the dialog opens; that is what deleting an account does.
- A confirmation is asked **once** per action. A bulk operation confirms the
  whole selection and then runs without asking again per item.
- The destructive button in a confirmation is `danger`, and its label names the
  act ("Delete", "Remove", "End meeting") rather than saying "OK".
- A failed request raises a toast carrying the server's message, never a
  generic one, and the page keeps the data it already had.
- Pickers that list people — project members, task assignee — re-read the
  account list when they open, so someone who registered a minute ago can be
  chosen.
- Every page that lists server data offers Refresh.

## 5. Localisation

All interface strings come from `frontend/public/translations.xml` (English,
Spanish, Chinese, Japanese). Dates and numbers are formatted with the
browser's locale; currency amounts follow the rules in the System Design
Document.
