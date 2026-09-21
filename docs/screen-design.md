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
Management · Schedule · Tools (LVGL, Converting, YOLO, Transformers, Keras) ·
Chat · Mail · Database Management · System Monitoring · Basic Data (Category).

A menu entry is present only if the account can view that page; a parent with
no visible children disappears with them. **My Page is not in the sidebar** —
it is reached from the avatar menu in the header, because it belongs to the
person rather than to the organisation.

**Chat** carries an unread count as a blue badge on its own label.

**Header icons**, right of the clock and language selector: a **message**
icon, then the notification bell, then the user menu. The message icon carries
the unread total as a badge and opens a menu of the five newest messages
addressed to you — sender in bold, a one-line preview, the time on the right,
and a dot marking an unread one. Choosing one opens Chat **on that
conversation**; the last entry, "Open Chat", goes to the page without picking
one. Accounts that cannot use Chat do not see the icon at all.

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

- **Login:** username, password, Remember me, Sign in, and a "Login with Face"
  button that opens a camera modal.
- **Register (top to bottom):** Full name · Username · Email · Password ·
  Confirm password · **Gender** (select: Male / Female / Other, clearable) ·
  **Birthday** (date picker, future dates disabled) · **Phone number** ·
  **Job** · **Address** · face capture panel · Register.

The five personal fields are optional and carry no asterisk; the face capture
panel refuses to submit without a photo.

### 3.2 Overview

Stat cards for records, users, categories and cameras, a category
distribution chart and a recent-activity list.

### 3.3 Users

Header actions: **Refresh** and Add User (administrators only). The list is
re-read whenever the page is opened, so an account created during the session
is present without a reload.

Filter bar: search text, role, face-enrolment state, Search and Reset.

Table columns: Name · Photo · Username · Email · Role · Access · Actions.
Administrators get a pencil action per row.

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
| Camera Management / Camera Wall | Table of cameras; wall of live tiles. |
| Schedule | Month view with an entry dialog and an upcoming list. |
| Mail | Inbox list, reading pane, compose dialog with one attachment. |
| Contacts (My Page tab) | Searchable list with favourite toggle and a contact dialog. |
| Tools | One page per tool: LVGL, Converting, YOLO, Transformers, Keras. |

## 4. Interaction rules

- A destructive action always confirms, and the confirmation states what else
  it takes with it ("its 12 tasks, with every comment and the whole history").
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
