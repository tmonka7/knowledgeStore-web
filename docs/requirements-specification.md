# Knowledge Store — Requirements Specification

Version 1.0 · 21 September 2026 · Status: baseline for the current build

## 1. Purpose and scope

Knowledge Store is a single-tenant internal web application. One installation
serves one organisation: its records, its cameras, its projects, its people.
Everything is reached through one signed-in session and one sidebar.

This document states what the system must do. It is written against the
current build, so each requirement is either implemented or explicitly marked
as not implemented. It does not describe how the code achieves any of it —
that is the System Design Document.

**In scope:** knowledge records and categories, camera registry, project and
bug tracking, direct messages, internal mail, schedules, personal wallet and
contacts, user and permission administration, database maintenance, system
monitoring, and the developer tool pages.

**Out of scope:** multi-tenancy, external email delivery (mail is internal to
the installation), currency conversion, real-time transport (messages are
polled), mobile applications, and single sign-on.

## 2. Actors

| Actor | Description |
|---|---|
| Visitor | Not signed in. May register an account or sign in. |
| User | A signed-in account. Sees exactly the pages its permissions allow. |
| Administrator | `role = admin`. Bypasses the permission list entirely and reaches every page, including Users and Database Management. |
| System | Scheduled work with no human actor: the chat file retention sweep. |

## 3. Functional requirements

### 3.1 Authentication and account creation (FR-AUTH)

| ID | Requirement |
|---|---|
| FR-AUTH-01 | A visitor can register with full name, username, email, password and a face photo. All five are mandatory. |
| FR-AUTH-02 | Registration must reject a username or email already in use, a password under 6 characters, and a malformed email address. |
| FR-AUTH-03 | Registration must capture a 128-value face descriptor from the photo. An account cannot be created without one. |
| FR-AUTH-04 | Registration may also record gender, birthday, phone number, address and job. Each is optional and an account is complete without them. |
| FR-AUTH-05 | A user signs in with username and password. An account that has a face descriptor must also pass face verification. |
| FR-AUTH-06 | A session is a bearer token valid for 8 hours. Expiry returns the user to the sign-in screen. |
| FR-AUTH-07 | Self-registration always creates a plain user. A role can only be granted by an administrator afterwards. |
| FR-AUTH-08 | Every user can change their own password, whatever their permissions. |

### 3.2 Users and permissions (FR-USR)

| ID | Requirement |
|---|---|
| FR-USR-01 | A user holding `users:view` sees **every** registered account, not only accounts related to them. |
| FR-USR-02 | The user list must be re-read when the Users page is opened, and on demand from a Refresh control, so an account registered during the session appears without a reload. |
| FR-USR-03 | An administrator can edit any account's full name, email, role, page permissions and face photo. |
| FR-USR-04 | An administrator can edit any account's gender, birthday, phone number, address and job. |
| FR-USR-05 | A user can edit their own gender, birthday, phone number, address and job from My Page. They cannot change their own name, email, role or permissions. |
| FR-USR-06 | Gender is one of male, female, other, or not specified. Birthday is a calendar day, must be a real date, and must not be in the future. |
| FR-USR-07 | An administrator cannot remove their own administrator role. |
| FR-USR-08 | Permissions are read from the database on every request, so a change takes effect on the user's next request rather than their next sign-in. |
| FR-USR-09 | Each page permission is one of view, create, edit, delete (or manage, for Database Management). A page the user cannot view is absent from the sidebar. |
| FR-USR-10 | Every signed-in user can read a directory of accounts — id, name and username only — because addressing a share is not an administrative act. The full user list stays behind `users:view`. |
| FR-USR-11 | An administrator's bypass is read from their account on each request, not from their token, so a demotion takes effect immediately rather than when the token expires. |

### 3.3 Knowledge records and categories (FR-REC)

| ID | Requirement |
|---|---|
| FR-REC-01 | A user can create, read, update and delete records, each with a title, a category, rich-text content and file attachments. |
| FR-REC-02 | Records can be searched by text, by category, and by a date range. |
| FR-REC-03 | A record can be exported as a Word document. |
| FR-REC-04 | Categories form a tree. A category can be created and deleted; deleting one must not orphan its records silently. |
| FR-REC-05 | When creating or editing a record, its owner chooses who it is shared with: **everyone**, or one or more named accounts. |
| FR-REC-06 | The default is everyone. A record saved without a choice, and a record saved before this feature existed, is readable by everyone. |
| FR-REC-07 | Choosing named accounts and selecting nobody means the record is readable by its owner alone. |
| FR-REC-08 | Sharing grants reading only. Editing and deleting a record stay with its owner and with administrators, and the controls for them are not offered on someone else's record. |
| FR-REC-09 | A record's sharing is stated on the record itself, not only in the form that created it. |
| FR-REC-10 | The record list and every search must return exactly the records the caller may read — a text search must never widen that set. |

### 3.4 Project and bug tracking (FR-PRJ)

| ID | Requirement |
|---|---|
| FR-PRJ-01 | A user can create, edit and delete projects, each with a key, name, description, status, colour, dates, members and progress. |
| FR-PRJ-02 | Project progress is derived from its tasks unless it has been set manually. |
| FR-PRJ-03 | A project holds tasks of type bug, task or feature, with priority, assignee, reporter, due date, description, attachments and comments. |
| FR-PRJ-04 | A bug carries steps to reproduce, expected result, actual result and environment. |
| FR-PRJ-05 | A task moves through: open, in progress, resolved, verified, reopened, closed. |
| FR-PRJ-06 | A resolved task can only be verified or reopened. It can never be closed directly — verification cannot be skipped. |
| FR-PRJ-07 | The server rejects any move the lifecycle does not allow, and tells the caller which moves are legal, so a stale board can correct itself. |
| FR-PRJ-08 | Every status change, assignment, comment and attachment is recorded in the task's history with who did it and when. |
| FR-PRJ-09 | The member and assignee pickers must offer every account, and must be re-read when a picker is opened. |

### 3.5 Chat (FR-CHT)

| ID | Requirement |
|---|---|
| FR-CHT-01 | A user can search every other account by name, username or email and open a conversation with any of them. |
| FR-CHT-02 | A conversation is between exactly two accounts. Opening one twice must reuse the same conversation. |
| FR-CHT-03 | A message sent by one participant must be delivered to the other and must appear in their window without a reload. |
| FR-CHT-04 | A conversation is private to its two participants. An administrator has no privileged access to it. |
| FR-CHT-05 | Unread messages are counted per conversation and in total; the total is shown on the sidebar. Opening a conversation clears its count. |
| FR-CHT-06 | A user can send a file of up to 25 MB in a conversation, with or without a note alongside it. |
| FR-CHT-07 | An uploaded file is deleted one week after it was sent. |
| FR-CHT-08 | When a file is deleted, its message stays and a deletion tag is appended to the stored file name. The conversation still shows that a file was sent; the file is simply no longer available. |
| FR-CHT-09 | A file still in retention shows how long it has left. |
| FR-CHT-10 | A message icon in the header carries the unread total and opens a menu of the five most recent messages addressed to the user, each showing who sent it, a preview and when. |
| FR-CHT-11 | Choosing one of those messages opens the Chat page **on that conversation**. The menu is shown only to accounts that can use Chat. |

### 3.6 Mail (FR-MSG)

| ID | Requirement |
|---|---|
| FR-MSG-01 | A message is addressed to one or more **accounts on this installation**, chosen from a list, not to a typed address. Mail never leaves the installation. |
| FR-MSG-02 | A sent message is delivered: it appears in every recipient's Inbox and in the sender's Sent folder. |
| FR-MSG-03 | A message carries a subject, rich-text content and at most one attachment of up to 10 MB. |
| FR-MSG-04 | Inbox shows how many messages are unread, and which. Opening one marks it read. |
| FR-MSG-05 | **Open tracking.** A sender can see, for each recipient, whether they have opened the message and at what time. The summary "opened *n* of *m*" is shown on the message and in the Sent list. |
| FR-MSG-06 | The open time is recorded once, on first opening. Re-reading a message must not move it. |
| FR-MSG-07 | A user can reply to a message they received; the reply is addressed to the sender with the original quoted. |
| FR-MSG-08 | Deleting removes the message from the caller's own mailbox only. Everyone else keeps their copy; the message is destroyed once nobody holds it. |
| FR-MSG-09 | A mailbox is private to its owner. There is no administrator bypass. |
| FR-MSG-10 | Both mailboxes can be searched by subject, sender, recipient and preview text. |

### 3.6a Schedule (FR-SCH)

| ID | Requirement |
|---|---|
| FR-SCH-01 | A user can create, edit and delete schedule entries with a date, time and repeat rule, and see what is coming up. |

### 3.6b Posts (FR-PST)

| ID | Requirement |
|---|---|
| FR-PST-01 | An account holding `posts:create` — in practice an administrator — can publish a post with a title and rich-text content, and can pin one above the rest. |
| FR-PST-02 | Posts can be edited and deleted by accounts holding the matching permission. Everyone with `posts:view` can read them. |
| FR-PST-03 | Recent posts the reader has not opened appear in the notification bell, alongside the schedule reminders, and the sidebar entry carries the same count. |
| FR-PST-04 | The count is of posts **this account has not opened**, so it falls as they are read. Choosing one from the bell opens it. |
| FR-PST-05 | Opening a post records who read it and when. A second reading must not add a second record. |
| FR-PST-06 | The post list shows how many people have read each post. |
| FR-PST-07 | The reader can see exactly **who** has read a post, with the time each of them opened it. |

### 3.7 Wallet (FR-WAL)

| ID | Requirement |
|---|---|
| FR-WAL-01 | A wallet is personal. No user, administrator included, can see another user's entries. |
| FR-WAL-02 | An entry records type (income or expense), amount, currency, category, date, and optionally a note and a payment method. |
| FR-WAL-03 | The currency is chosen **per entry**, and is one of USD or REM. |
| FR-WAL-04 | An entry saved before currencies existed is treated as USD. |
| FR-WAL-05 | The statistics show both currencies at the same time: totals, monthly income and expense, running balance and category breakdown, once per currency. |
| FR-WAL-06 | Figures in different currencies are never added together and never converted. The system holds no exchange rate. |
| FR-WAL-07 | Totals are calculated on the server, so the cards, charts and tables cannot disagree with each other. |

### 3.8 Contacts (FR-CON)

| ID | Requirement |
|---|---|
| FR-CON-01 | A user can create, edit, delete and favourite personal contacts with name, email, phone, company, job title, group, tags and notes. |
| FR-CON-02 | Contacts are personal and scoped to their owner, like the wallet. |

### 3.9 Cameras (FR-CAM)

| ID | Requirement |
|---|---|
| FR-CAM-01 | A user can register cameras with a name, location, address, status and notes, and view a single camera or a wall of them. |
| FR-CAM-02 | The Add, Edit and Delete controls are shown only to accounts holding the matching camera permission; a viewer sees the cameras and nothing else. |
| FR-CAM-03 | Opening the edit dialog shows the camera's current values. |
| FR-CAM-04 | A stream is previewed in the page only when it is an http(s) source and the camera is marked online; anything else states that no preview is available rather than showing a broken frame. Status is a value an operator sets — the system does not probe the camera. |

### 3.10 Database management (FR-DBA)

| ID | Requirement |
|---|---|
| FR-DBA-01 | An administrator can initialise the database, either safely (indexes and seed data only) or by reset. |
| FR-DBA-02 | A reset must require the word RESET to be typed, must create a backup first, and must create a superuser. Because it drops the user collection, it invalidates the current session and says so. |
| FR-DBA-03 | An administrator can create, download, upload, inspect, restore and delete backups. A restore takes a safety backup first and can replace or merge. |
| FR-DBA-04 | An administrator can see replication status, initiate a replica set, and add or remove members. A standalone server must be reported as such, not as an empty list. |
| FR-DBA-05 | Optimisation can delete upload files that nothing references, clear activity logs, compact collections and re-synchronise indexes, reporting each task separately. |
| FR-DBA-06 | An upload referenced by a record, a mail, a task or a live chat attachment must never be treated as unreferenced. Files younger than one hour are reported but never deleted. |

### 3.11 System monitoring and tools (FR-SYS)

| ID | Requirement |
|---|---|
| FR-SYS-01 | The monitoring page charts measured figures only: API latency measured around a real request, and browser heap use. No plotted series may be fabricated. |
| FR-SYS-02 | The tool pages (LVGL, Converting, YOLO, Transformers, Keras) are each gated by their own permission. |

### 3.12 Internationalisation (FR-I18N)

| ID | Requirement |
|---|---|
| FR-I18N-01 | Interface text is loaded at runtime from `frontend/public/translations.xml` in English, Spanish, Chinese and Japanese. |
| FR-I18N-02 | A missing translation falls back to English, then to the key itself. A missing catalogue must not blank the application. |

## 4. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-01 | **Authorisation.** Every API route is gated server-side. Hiding a control in the browser is never the only protection. |
| NFR-02 | **Password storage.** Passwords are stored only as bcrypt hashes and are never returned by any endpoint. |
| NFR-03 | **Session.** Tokens expire after 8 hours. The role in a token is never used for an authorisation decision; the database record is read instead. |
| NFR-04 | **Privacy scoping.** Wallet entries, contacts, schedules, mail and chat threads are scoped to their owner or participants in the data layer, not in the UI. |
| NFR-05 | **Responsiveness.** List pages paginate rather than render unbounded tables. Chat polls at 4–6 second intervals; an idle conversation costs one small empty response. |
| NFR-06 | **Upload limits.** 25 MB per chat or task file; 3 MB request bodies for JSON. Limits are enforced on the server. |
| NFR-07 | **Accessibility.** Icon-only controls carry a tooltip and an accessible label. Charts carry a text alternative and do not rely on colour alone. |
| NFR-08 | **Browser support.** Current Chromium, Firefox and Safari. Heap statistics are Chromium-only and degrade to an estimate elsewhere. |
| NFR-09 | **Data retention.** Chat uploads are deleted after 7 days. Nothing else is deleted automatically. |

## 5. Constraints and assumptions

- MongoDB is reachable at `MONGODB_URI`; the API listens on `127.0.0.1` only.
- Uploaded files live on the API server's filesystem under `uploads/`, and are
  served from the static `/uploads` path. Anyone holding a file's URL can
  fetch it without signing in; the generated file name is the only obscurity.
  This applies to chat attachments as it does to records, mail and tasks, and
  is a known limitation rather than a design goal.
- REM is not an ISO 4217 currency code, so it is formatted as a plain number
  followed by the code rather than with a currency symbol.
- There is no exchange rate anywhere in the system, by decision.
- Records created before sharing existed carry no visibility field, and are
  read as shared with everyone — the same answer a new record gets by default.
  This widens what a non-owner can see compared with the previous build, where
  records were visible only to their owner and to administrators. It is the
  consequence of making "everyone" the default, and is stated here because it
  changes existing data's meaning rather than only new data's.
- The seeded administrator is `admin` / `admin123` and must be changed before
  any real use.

## 6. Traceability

Each requirement above has at least one case in the Test Case Specification,
which cites requirement IDs directly. Screen behaviour for each requirement is
described in the Screen Design Document.
