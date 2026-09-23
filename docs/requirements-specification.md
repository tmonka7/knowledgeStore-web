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
| FR-AUTH-01 | A visitor can register with full name, username, email and password. All four are mandatory. A face photo may be added at the same time but is not required. |
| FR-AUTH-02 | Registration must reject a username or email already in use, a password under 6 characters, and a malformed email address. |
| FR-AUTH-03 | A face photo offered at registration must yield a 128-value descriptor and be stored with the photo it came from; a photo that cannot be read is rejected rather than stored. An account created without a face is complete and signs in by password. An administrator can enrol a face for it later on the Users page. |
| FR-AUTH-04 | Registration may also record gender, birthday, phone number, address and job. Each is optional and an account is complete without them. |
| FR-AUTH-05 | A user signs in by **either** of two methods. They are alternatives, not steps: (1) username and password, (2) facial recognition on its own. |
| FR-AUTH-05a | Face sign-in supplies no username. The captured descriptor is compared against every approved account, and the closest match is accepted only if it is within the distance threshold **and** clearly closer than the next nearest account. |
| FR-AUTH-05b | A refused face sign-in gives one message whatever the reason, so the form cannot be used to discover who is enrolled. |
| FR-AUTH-06 | A session is a bearer token valid for 8 hours. Expiry returns the user to the sign-in screen. |
| FR-AUTH-07 | Self-registration always creates a plain user. A role can only be granted by an administrator afterwards. |
| FR-AUTH-08 | Every user can change their own password, whatever their permissions. |
| FR-AUTH-09 | Registration creates the account with status **Pending** and does not start a session. The person is told the account is waiting for approval. |
| FR-AUTH-10 | Sign-in is refused while an account is Pending or Denied, by either method, with a message that tells the two apart. |
| FR-AUTH-11 | The account behind a session is re-read on every request. An account denied or deleted mid-session stops working immediately rather than when its token expires. |

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
| FR-USR-12 | A permission added to the defaults after accounts already exist must be granted to those accounts once, at startup, and not re-granted afterwards — a permission an administrator revokes has to stay revoked. |
| FR-USR-13 | Every account has a status of **Pending**, **Allowed** or **Denied**. An administrator sets it from the Users page, and the list can be filtered by it. |
| FR-USR-14 | Pending and Denied are distinct states. Pending means nobody has decided yet; Denied means somebody decided no. |
| FR-USR-15 | An administrator cannot deny their own account, and cannot deny or delete the last administrator who is able to sign in. |
| FR-USR-16 | Accounts that existed before the status field must be treated as already approved, once, at startup — an upgrade must not lock everybody out. |
| FR-USR-17 | An administrator can delete an account. Everything belonging to it is removed: records and their files, wallet, contacts, schedule, posts, chat conversations and their files, mail, hosted meetings and their recordings, in-call messages, activity log entries, and the face photo. |
| FR-USR-18 | Shared project work is not destroyed with the account. Projects they owned pass to the administrator performing the deletion, membership is removed, their tasks are unassigned, their comments are deleted, and their entries in a task's history are anonymised so the trail stays whole. |
| FR-USR-19 | Before an account is deleted, the administrator is shown a count of exactly what will be destroyed and what will be kept and unlinked. |
| FR-USR-20 | An administrator cannot delete their own account. |
| FR-USR-21 | **Every** destructive action in the application asks for confirmation before it runs, and a confirmation names what is about to be destroyed rather than asking only "are you sure?". |

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
| FR-MSG-11 | A mail icon in the header carries the unread total and opens a menu of the five newest messages in the inbox, each showing the sender, the subject and when it arrived. It behaves exactly as the message icon beside it. |
| FR-MSG-12 | Choosing one of those opens the Mail page **on that message**, switching to the Inbox if the Sent folder was open. The icon is shown only to accounts that can use Mail. |

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

### 3.6c Video meetings (FR-MTG)

| ID | Requirement |
|---|---|
| FR-MTG-01 | An account holding `meetings:create` can create a meeting with a title, an optional description and an optional start time. A meeting with no start time is a room that can be opened whenever it is needed. |
| FR-MTG-02 | A meeting is open to everyone by default. The host can instead name one or more people, and only they and the host may join. |
| FR-MTG-03 | Joining a meeting connects the participant's camera and microphone to every other participant. Audio and video travel directly between browsers; the server carries only the handshake. |
| FR-MTG-04 | A participant can mute their microphone and turn their camera off, and everyone else sees that state on their tile. |
| FR-MTG-05 | A participant can share their screen in place of their camera, and stop sharing to return to it. |
| FR-MTG-06 | Participants can send text messages to everyone in the call. The messages are kept with the meeting, so somebody joining late sees what has been said. |
| FR-MTG-07 | A participant can record the meeting. The recording captures every tile and everybody's audio, and is saved to the meeting when it stops. |
| FR-MTG-08 | While a recording is running, every participant is told so. The indicator is not under the control of the person recording. |
| FR-MTG-09 | The meeting list shows which meetings are in progress and who is in each one. This reflects live connections, so it cannot show somebody who has gone. |
| FR-MTG-10 | Each meeting keeps an attendance record: who joined, when, and when they left. Leaving and rejoining is two visits, not one. |
| FR-MTG-11 | The host, or an administrator, can end a meeting. Ending it disconnects anyone still in the call and keeps the recordings, the messages and the attendance record. |
| FR-MTG-12 | The host, an administrator, or the person who made a recording can delete it. Deleting a meeting deletes its recordings and messages with it. |
| FR-MTG-13 | The number of people in one meeting is capped, because every participant sends their camera to every other one. The cap is configurable. |

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

- Uploaded files live on the API server's filesystem under `uploads/`, and are
  served from the static `/uploads` path. Anyone holding a file's URL can
  fetch it without signing in; the generated file name is the only obscurity.
  This applies to chat attachments and meeting recordings as it does to
  records, mail and tasks, and is a known limitation rather than a design goal.
- REM is not an ISO 4217 currency code, so it is formatted as a plain number
  followed by the code rather than with a currency symbol.
- There is no exchange rate anywhere in the system, by decision.
- Records created before sharing existed carry no visibility field, and are
  read as shared with everyone — the same answer a new record gets by default.
  This widens what a non-owner can see compared with the previous build, where
  records were visible only to their owner and to administrators. It is the
  consequence of making "everyone" the default, and is stated here because it
  changes existing data's meaning rather than only new data's.
- MongoDB is reachable at `MONGODB_URI`; the API listens on `127.0.0.1` unless
  `HOST` says otherwise. Meetings are the first feature for which that default
  matters: bound to loopback, the only browsers that can reach the server are
  the ones on the same machine, so a call cannot have a second participant.
- Browsers only grant camera, microphone and screen access in a **secure
  context** — HTTPS, or `localhost`. A plain `http://` page on a LAN address
  does not qualify, and the API is not merely refused there but absent, so
  meetings on such an address can be joined only to watch and listen.
- Meeting media is a full mesh: every participant sends their camera to every
  other participant. This needs no media server, which is what makes the
  feature possible in a plain Express app, but the cost grows quadratically and
  the room is capped (`MEETING_MAX_PEERS`, default 8, comfortable at 4–6).
- Connecting across the internet relies on STUN. A symmetric NAT or a firewall
  that blocks peer-to-peer UDP needs a TURN server, which relays the media and
  therefore has to be one the operator runs or pays for; without one, a
  minority of participants will fail to connect and cannot be made to.
- Who is in a meeting right now is held in the API process's memory, not in
  the database. This is what makes occupancy self-correcting, and it means the
  backend must run as a single process.
- Facial recognition is now **sufficient on its own** to sign in, where before
  it was a second factor on top of a password. A face descriptor is not a
  secret the way a password is: it can be produced from a photograph, and
  nothing here tests for liveness, so method 2 establishes what somebody looks
  like rather than what they know. The 1:N thresholds are tightened and a
  margin over the runner-up is required, which reduces false matches but does
  not make a photograph fail. An installation that needs a stronger guarantee
  should disable face sign-in rather than rely on it.
- The seeded administrator is `admin` / `admin123` and must be changed before
  any real use.

## 6. Traceability

Each requirement above has at least one case in the Test Case Specification,
which cites requirement IDs directly. Screen behaviour for each requirement is
described in the Screen Design Document.
