# Knowledge Store — System Design Document

Version 1.0 · 21 September 2026 · Companion to the Requirements Specification

## 1. Architecture

Two deployables and one database.

```
Browser ── React 18 / Vite 5 / Ant Design 5 (frontend)
   │  HTTP + JWT (Authorization: Bearer …)
   │  WebSocket /rtc — meeting signalling only
   ▼
Express 4 API (backend)  ──  filesystem: uploads/, backups/
   │  Mongoose 8
   ▼
MongoDB

Browser ⇄ Browser — meeting audio and video, peer to peer, never via the API
```

There is no message broker, no cache and no background worker process. The
scheduled work — the chat retention sweep, and the ping that reaps dead meeting
sockets — runs on intervals inside the API process.

Everything is request/response except meeting signalling, which shares the
API's port over a WebSocket. Section 4.9 explains why that one case cannot be
polled like the rest.

| Layer | Location | Responsibility |
|---|---|---|
| Routes | `backend/src/routes` | URL shape, permission middleware, multipart handling |
| Controllers | `backend/src/controllers` | Request validation, orchestration, response shape |
| Models | `backend/src/models` | Mongoose schemas plus the queries that enforce ownership |
| Helpers | `backend/src/helpers` | Cross-cutting rules: auth, permissions, workflow, retention, maintenance |
| Pages | `frontend/src/pages` | One page per sidebar entry; owns its data fetching |
| Components | `frontend/src/components` | Reusable UI, grouped by feature (`wallet/`, `project/`, `account/`, `ui/`) |

`frontend/src/App.jsx` holds session state and the resources shared by several
pages (users, records, categories, cameras) and passes them down;
`DashboardPage.jsx` owns the shell, the sidebar and page switching.

## 2. Authentication and authorisation

**Two ways in, and they are alternatives.** `POST /auth/login` takes a username
and password; `POST /auth/login/face` takes a descriptor and nothing else.
Either returns a JWT signed with `JWT_SECRET`, carrying `{ sub, username, role }`
and expiring in 8 hours.

**Token, and why it is not trusted.** `requireAuth` verifies the signature and
then reads the account from the database, refusing one that no longer exists or
whose status is not `allowed`. A token is a signed snapshot of who somebody was
up to eight hours ago; without that read, denying or deleting an account would
take effect some time before tomorrow, which is not a revocation. The cost is
one indexed lookup per request, deliberately without the face photo — a base64
image of up to 2MB would otherwise be the most expensive part of most requests.
`req.currentUser` carries the account onward, so the permission middleware that
already did this read now reuses it.

**Permissions.** `requirePermission('page:action')` loads the *current*
database record for `req.user.sub` and calls `hasPermission`. The role and
permission list in the token are never consulted for a decision — a promotion
or a revocation therefore takes effect on the next request rather than the
next sign-in. Administrators bypass the permission list.

This rule is worth stating twice, because breaking it caused a real defect:
`GET /users` once narrowed its result to the caller unless `req.user.role`
said `admin`. That role came from the token, so a user promoted mid-session
kept seeing only themselves, and a non-administrator holding `users:view` saw
only themselves for ever. The route's permission gate is the whole decision;
there is no second check inside the handler.

**Account status.** `pending` → `allowed` / `denied`, held on the account and
checked in front of roles and permissions. A denied account is not an account
with nothing granted to it; it is one that cannot be used at all. Registration
produces `pending` and returns **no token** — a session whose every request is
refused is worse than being told plainly to wait. `pending` and `denied` are
kept apart because an administrator reviewing a list needs to see the
difference between "nobody has looked" and "somebody said no", and because
telling a waiting applicant they have been rejected sends them to ask about a
decision that was never made.

Adding the field was itself a hazard: Mongoose applies a schema default to a
path missing from a document it loads, so every pre-existing account began
reading as `pending` the moment the field existed — an upgrade that locks out
everybody, administrators included. `helpers/accountStatusBackfill.js` sets
them to `allowed` once, marker-guarded like the permission backfill, before the
port opens. `ensureSeedAdmin` and `ensureSuperuser` both write `allowed`
explicitly, because an administrator who needs approving by an administrator is
a locked door with the key inside.

**Face recognition as a way in.** The browser computes a 128-float descriptor
with `frontend/src/lib/faceRecognition`, stored on the account with
`select: false` so an ordinary read never returns it. The photo is kept as a
data URL for display only.

What changed is what the descriptor now buys. Previously it was a *second*
factor: the password was required and, for any account with a face on file, so
was the face. It is now a *first* factor on its own, and no username is
supplied with it — so this identifies rather than verifies, searching every
approved account for the closest match. That is a different and harder problem:
the risk that grows with the number of accounts is not "is this close enough"
but "is this closer to the right person than to someone else". Two rules
answer it. The distance must be under `FACE_MATCH_MAX` (0.5, tightened from the
0.6 used for verification), and the best match must beat the runner-up by at
least `FACE_MATCH_MARGIN` (0.05); if two accounts are near-equally close, the
honest answer is that the system does not know which, and it refuses rather
than taking the smaller number. Every refusal returns the same message, so the
form cannot be used to enumerate who is enrolled.

The security trade is real and is recorded in the constraints: a descriptor can
be produced from a photograph and nothing here checks liveness, so this
establishes what somebody looks like, not what they know.

## 3. Data model

All collections use a UUID string `id` as the public identifier; Mongo's
`_id` never leaves the server.

| Collection | Key fields | Ownership |
|---|---|---|
| `users` | username, email, fullName, role, **status (pending/allowed/denied)**, permissions[], passwordHash, faceDescriptor, faceImage, gender, birthday, phone, address, job | — |
| `records` | title, categoryId, content (HTML), attachment(s), ownerId, **visibility, sharedWith[]** | owner + whoever it is shared with |
| `categories` | name, parentId, path, level | shared |
| `cameras` | name, location, address, status, notes | shared |
| `schedules` | title, notes, date, time, repeat, repeatUntil, ownerId | per owner |
| `mail_messages` | senderId, subject, body, **recipients[{userId, name, readAt, deletedAt}]**, recipientIds[], attachment, replyToId, sentAt | sender + recipients |
| `posts` | title, body, authorId, pinned, **views[{userId, userName, viewedAt}]**, viewerIds[] | shared |
| `meetings` | title, description, hostId, openToAll, inviteeIds[], scheduledAt, status, startedAt, endedAt, **participants[{userId, name, joinedAt, leftAt}]**, recordings[] | host + invitees, or everyone |
| `meeting_messages` | meetingId, senderId, senderName, body | everyone in that meeting |
| `contacts` | fullName, email, phone, company, jobTitle, group, tags[], favourite, ownerId | per owner |
| `wallet_entries` | type, amount, **currency**, category, note, method, date, ownerId | per owner |
| `projects` | key, name, status, colour, dates, memberIds[], progressOverride, taskCounter | shared |
| `tasks` | projectId, number, key, title, description, type, status, priority, assigneeId, reporterId, bug fields, resolution, attachments[], comments[], activity[] | shared |
| `chat_threads` | participantIds[2] (sorted), lastMessageAt, lastMessagePreview, lastMessageSenderId | two participants |
| `chat_messages` | threadId, senderId, recipientId, body, **attachment**, readAt | two participants |
| `activity_logs` | level, source, action, message, actor, meta | shared |
| `app_migrations` | id, appliedAt, note — markers for one-off tasks such as permission backfills | — |

Dates that mean a **calendar day** — a schedule date, a wallet entry date, a
birthday — are stored as `YYYY-MM-DD` strings, not `Date` values. A `Date`
would shift across a timezone boundary and move the day, which matters when a
figure is grouped by month or a birthday is displayed.

Ownership is enforced in the model layer: `getWalletEntries(ownerId, …)` and
`getThreadFor(userId, threadId)` take the caller as their first argument, so
there is no query path that forgets to scope. `getThreadFor` has no
administrator bypass, by design.

## 4. Key mechanisms

### 4.1 Task lifecycle

`backend/src/helpers/taskWorkflow.js` is the single source of the state
machine:

```
open        → in_progress, resolved, closed
in_progress → resolved, open, closed
resolved    → verified, reopened
verified    → closed, reopened
reopened    → in_progress, resolved, closed
closed      → reopened
```

There is deliberately no `resolved → closed` edge: verification cannot be
skipped, and that is a structural property rather than a convention. An
illegal move returns 409 with the list of legal ones, so a board holding a
stale card can correct itself. The Kanban board mirrors the same table to dim
columns a card cannot be dropped on — a convenience, never the decision.

### 4.2 Wallet currencies

Each entry carries `currency` (`USD` or `REM`, defaulting to `USD` for rows
written before the field existed). `GET /wallet/summary` groups the filtered
rows by currency and summarises each group independently, returning:

```
{ range, currencies: ['USD','REM'], entries: <count>,
  byCurrency: { USD: { totals, monthly[], categories{income,expense} },
                REM: { … } } }
```

Every currency is summarised even when it has no rows, so the page can always
render both side by side. Nothing anywhere converts between them: the system
holds no rate, and a combined balance would be a figure nobody could act on.
`frontend/src/components/wallet/money.js` formats USD through `Intl` and REM
as a plain number followed by its code, because REM is not an ISO 4217 code.

### 4.3 Chat delivery and retention

There is no socket in this stack. The open conversation polls
`GET /chat/threads/:id/messages?after=<ISO>` every 4 seconds and the list
polls every 6; a quiet conversation returns an empty array. Fetching messages
also marks the incoming ones read.

A file is sent as a message of its own (`POST /chat/threads/:id/attachments`,
multipart, with an optional `body` note), so it sits in the conversation in
the order it was sent. `expiresAt` is stamped one week ahead at upload.

`backend/src/helpers/chatRetention.js` sweeps at boot and hourly:

1. find messages whose `attachment.expiresAt` has passed and whose
   `attachment.deletedAt` is still null;
2. resolve the stored path, **refusing anything that resolves outside
   `uploads/chat`** — the path comes back out of the database, so it is
   checked rather than trusted;
3. unlink the file (a missing file is the expected case on a second run);
4. append `(deleted)` to `attachment.name`, guarded so a second sweep cannot
   stack the tag, and stamp `deletedAt`.

The message is never removed. The record that a file was sent outlives the
file, and the tagged name is what tells the UI to stop offering a download.

### 4.4 Record sharing

A record carries `visibility` (`everyone` or `selected`) and `sharedWith`, a
list of account ids. `recordAccessFilter(userId, isAdmin)` in `recordModel.js`
turns that into the clause every read goes through:

```
owner is me  OR  visibility != 'selected'  OR  sharedWith contains me
```

`!= 'selected'` rather than `== 'everyone'`, because a record written before
this field existed has no `visibility` at all, and a missing value has to read
the same way as the default a new record gets. The consequence is stated in
the Requirements Specification: existing records become readable by everyone.

Two details are easy to get wrong and are handled deliberately:

- **The filter is a clause, not a top-level key.** Both the access filter and
  a text search are `$or` expressions, so a query that spread one over the
  other would silently drop the access check and let a search return records
  the caller cannot read. Everything composes through `allOf`, which nests
  each condition under `$and`.
- **The administrator bypass is read from the account**, via `req.currentUser`
  that `requirePermission` has already loaded — not from `req.user.role` in
  the token. With records selectively shared, a demoted administrator keeping
  the bypass until their eight-hour token expired would be a real leak.

Sharing is read access. `updateData` and `deleteData` still require ownership
or administrator, and the list hides those controls on a record you do not
own rather than offering a button that answers 403.

The picker is filled by `GET /users/directory`, which returns id, name and
username for every account behind nothing but `requireAuth`. Sharing is not an
administrative act, so it cannot sit behind `users:view`; it is deliberately
narrower than `GET /users`, which also carries email, role and permissions.

### 4.5 Mail delivery and open tracking

The previous model gave every message a single `ownerId`, addressed `to` as
free text and filed what it created under 'Draft' — so sending mail wrote a
note to yourself that no recipient could receive. It is replaced for the same
reason chat was: none of those fields describe a message with two ends.

One document per message, with a row per recipient, rather than a copy per
mailbox:

```
mail_messages: { senderId, subject, body, attachment,
                 recipients: [{ userId, name, readAt, deletedAt }],
                 recipientIds: [ … ] }
```

That shape is what makes the open status answerable. The sender's copy *is*
the recipients' copy, so `readAt` — stamped once, when a recipient first opens
the message — is the same fact the sender reads back as "opened at 14:12".
A separate receipt record could disagree with the mailbox it describes; this
cannot.

Inbox is `recipients` matching `{ userId, deletedAt: null }`; Sent is
`senderId` with `deletedBySender` false. Deleting is therefore per person: it
stamps `deletedAt` on your own row, and the document is destroyed only once
nobody is holding it — which is also what stops its attachment being
collected while someone can still open it.

`getMailFor(userId, id)` is the single privacy gate, and like chat's it has no
administrator bypass.

### 4.6 Posts and the notification count

A post stores its readers rather than a counter:

```
posts: { title, body, authorId, pinned,
         views: [{ userId, userName, viewedAt }], viewerIds: [ … ] }
```

A count cannot answer "has the late shift seen this yet?", and the page has to
show exactly who. `viewerIds` is the same data flattened, so "have I seen
this?" is an indexed test rather than a scan of subdocuments on every
notification poll.

`recordPostView` filters on `viewerIds: { $ne: userId }` and both `$addToSet`s
the id and `$push`es the row, so a second reading cannot add a second row —
the count stays a number of people, not a number of page loads.

The bell counts posts where `viewerIds` does not contain you, which is why
reading one makes the number fall. Recording the view is its own request
(`POST /posts/:id/view`) rather than a side effect of fetching a post: a list
that prefetched bodies would otherwise mark everything read without anyone
reading it. The Posts page calls back into the shell when it records one, so
the bell recounts immediately instead of at the next poll.

### 4.7 Permissions added after the fact

`DEFAULT_USER_PERMISSIONS` is read only when an account is created, so adding
a key to it does nothing for anyone who registered earlier. That gap is not
theoretical: when Posts shipped, every existing account lacked `posts:view`,
so the page was hidden from their sidebar and their notification poll answered
403 — a post published for everyone reached nobody, and nothing said so.

`helpers/permissionBackfill.js` holds a list of such keys, each with its own
id, and `models/migrationModel.js` records which have been applied in
`app_migrations`. Each runs **once**: re-applying a backfill on every boot
would quietly undo a revocation an administrator made on purpose. A key is
validated against the catalog before it is written, so a typo cannot store a
permission no route checks, and administrators are skipped because they bypass
the list anyway.

The frontend now logs a 403 from a notification poll rather than swallowing
it, so the same class of gap is visible in the console next time.

### 4.8 Database maintenance

`databaseMaintenance.js` covers backup (canonical Extended JSON via the BSON
library Mongoose already ships, so `Date` and `ObjectId` round-trip), restore
(replace or merge, always after a safety backup), replication commands, and
optimisation.

The orphan-upload scan builds the referenced set from record attachments,
mail attachments, task attachments **and chat attachments whose file has not
yet been swept**. Anything not in that set and older than one hour is an
orphan. Missing a source here means deleting live files, which is why the set
is built from every model that stores a path.

### 4.9 Video meetings

Media never passes through this server. Two browsers exchange an offer, an
answer and a set of ICE candidates, and from then on the audio and video go
directly between them. What the backend provides is the exchange, over a
WebSocket at `/rtc` sharing the API's port.

**Why a socket here and polling everywhere else.** Chat, mail and posts can
afford to be a few seconds stale. A handshake cannot: an offer that arrives a
poll interval late is a call that takes that much longer to connect, and an ICE
candidate that arrives after its peer has given up is a call that never
connects at all. This is the one part of the app where latency is correctness,
so it is the one part with a socket. `server.js` therefore builds an explicit
`http.Server` — `app.listen()` never exposes the object `ws` needs.

**Topology: full mesh.** Every participant holds an `RTCPeerConnection` to
every other one. No media server is required, which is what makes the feature
possible in a plain Express app; the cost is that each person uploads their
camera once per other participant, so the room is capped by
`MEETING_MAX_PEERS` (default 8, comfortable at 4–6).

**Who offers.** Whoever is already in the room offers to whoever arrives. The
newcomer never offers. Exactly one side of each pair initiates, so two peers
can never be offering each other at the same moment — "glare", the classic way
a WebRTC call ends up connected in one direction only. It is prevented by the
protocol rather than detected and recovered from.

**Both m-lines are reserved at connection time**, with or without a track to
put in them. Starting a screen share is then `RTCRtpSender.replaceTrack`, which
does not change the shape of the session and so needs no renegotiation — and a
renegotiation mid-call is exactly where glare would otherwise reappear. It also
means someone who joined without a camera can still share their screen.

**ICE candidates are queued** until the description they belong to has been
applied. They routinely arrive first, and adding one early throws.

**Occupancy is not stored.** Who is in a room lives in the signalling process's
memory and is read from there by the REST layer. Writing it to the database
looks tidier until a crash or a dropped socket leaves a room permanently
occupied by nobody, with nothing to correct it. Derived from live sockets, it
cannot go stale. The price is that the backend must be a single process. A
30-second ping/pong reaps sockets whose browser was suspended rather than
closed, which TCP alone would take minutes to notice.

**Identity is per connection, not per person.** Two tabs are two peers, so a
second tab cannot tear down the first one's call. The roster, the room cap and
the attendance log all de-duplicate by account, so opening a second tab is
never what makes a room full, and closing one is not leaving the meeting.

**Authentication is the socket's first message**, not a query parameter.
A browser cannot set headers on a WebSocket, and the usual alternative —
`?token=…` — puts a bearer credential for the whole API into proxy and access
logs. A socket that says nothing within ten seconds is closed. As everywhere
else, the role is then re-read from the database rather than trusted from the
token.

**Recording happens in the browser.** Every tile is painted onto a canvas and
everybody's audio is mixed through a `MediaStreamAudioDestinationNode`; the
result is what `MediaRecorder` captures, and it uploads as one file when it
stops. The server has no stream to record, which is also why it cannot produce
a recording nobody in the room knew about. The recorder's state is published to
the room like mute and camera are, and the indicator is not separately
controllable: a recording light the recorder can switch off is not consent.
Audio is taken from the camera stream rather than the displayed one, so a
presenter's voice is not dropped for the duration of their screen share.

**Ending a meeting closes the room.** Narrowing an open meeting to a named list
does too, if somebody in the call is no longer on it — otherwise the one person
just excluded is the one person still connected.

### 4.10 Deleting an account

"Everything of theirs" splits in two, and `helpers/userPurge.js` treats the
halves differently.

**Theirs alone — destroyed, files included.** Records and their attachments,
wallet entries, contacts, schedule, posts they wrote, direct message threads
and their attachments, mail they sent, their copy of mail they received,
meetings they host and those meetings' recordings, in-call messages, activity
log entries, and the account document that carries the face photo and
descriptor.

**Shared work others are still doing — unlinked, not destroyed.** A project is
not one person's information, and deleting it would take other people's tasks,
comments and history with it. So ownership passes to the administrator doing
the deletion — an `ownerId` nobody holds would leave a project that nobody can
edit or remove — membership is dropped, tasks they held are unassigned rather
than left pointing at a missing account, their comments are deleted, and their
entries in a task's history are anonymised. That last one is deliberate: the
history is the record of how a bug reached "verified", and deleting the steps
they performed would leave a trail with holes in it.

Two cases needed a decision rather than a rule:

- A **direct message thread** is destroyed outright, taking the other
  participant's copy with it. There is no half of a conversation that is not
  also theirs.
- **Mail they received** loses only their recipient row. A message is deleted
  outright only when the sender has also deleted it — exactly the condition
  `deleteMail` already uses. Dropping every message left with no recipients
  would destroy the *sender's* copy in Sent: someone else's data, deleted
  because the person they wrote to was removed.

**The confirmation is built from the same queries as the deletion.**
`GET /users/:id/deletion-preview` runs `describeUserFootprint`, the function
`purgeUser` calls first, so the dialog cannot describe one thing while the
deletion does another. An administrator sees "12 data records (with their
files), 4 chat conversations (deleted for the other person too), 2 meetings
they host (with their recordings)" and, separately, what is being kept and
unlinked.

This is not a transaction — the normal deployment is a standalone `mongod`,
where multi-document transactions are unavailable. The order is chosen so an
interrupted run leaves data incomplete rather than inconsistent, and can simply
be repeated: shared structures are unlinked first, personal data next, the
activity log after that (it is the only trail of what is being done until the
end), and the account document last.

Two guards, because this and Deny are the only doors with no way back: nobody
can delete their own account, and neither Deny nor Delete may take the last
administrator who is able to sign in. Only an administrator can approve or
promote, so an installation with none cannot be repaired from inside the
application at all.

### 4.11 Confirming destructive actions

Every delete in the application asks first, and the question names what is at
stake rather than asking "are you sure?" — how many sub-categories go with a
branch, how many records are in the selection, what a meeting's recordings are,
what an account holds.

Two places did not ask at all and now do: deleting a category, and removing a
task attachment. A third asked too much — the records toolbar confirmed the
whole selection and then called the single-record handler, which opened its own
dialog per record, so confirming "delete 8 records" produced eight more
questions. `handleDeleteRecords` exists so the bulk path has no second
confirmation and reloads once at the end rather than once per record.

## 5. API surface

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/login/face` |
| Users | `GET /users`, `GET /users/directory`, `PUT /users/:id`, `PUT /users/:id/status`, `GET /users/:id/deletion-preview`, `DELETE /users/:id`, `GET /permissions/catalog`, `GET /user/profile`, `PUT /user/password`, `PUT /user/profile` |
| Records | `GET /data`, `GET /data/search`, `POST /data`, `PUT /data/:id`, `DELETE /data/:id` |
| Categories | `GET/POST /categories`, `DELETE /categories/:id` |
| Cameras | `GET/POST /cameras`, `PUT/DELETE /cameras/:id` |
| Projects | `GET /projects/members`, CRUD on `/projects[/:id]`, CRUD on `/projects/:projectId/tasks[/:taskId]`, `POST …/transition`, `POST …/comments`, `POST/DELETE …/attachments` |
| Chat | `GET /chat/users`, `GET /chat/recent`, `GET/POST /chat/threads`, `GET/POST /chat/threads/:id/messages`, `POST /chat/threads/:id/attachments`, `POST /chat/threads/:id/read` |
| Mail | `GET /mail?folder=inbox\|sent`, `GET /mail/inbox`, `GET /mail/unread`, `GET /mail/recent`, `GET/DELETE /mail/:mailId`, `POST /mail` |
| Posts | `GET /posts`, `GET /posts/notifications`, `POST /posts`, `GET/PUT/DELETE /posts/:id`, `POST /posts/:id/view` |
| Meetings | `GET /meetings`, `GET /meetings/ice`, `POST /meetings`, `GET/PUT/DELETE /meetings/:id`, `POST /meetings/:id/end`, `POST /meetings/:id/recordings`, `DELETE /meetings/:id/recordings/:recordingId` — plus the `/rtc` WebSocket, which is not a REST route |
| Schedule | `GET /schedules`, `GET /schedules/upcoming`, `POST /schedules`, `PUT/DELETE /schedules/:id` |
| Wallet | `GET /wallet/summary`, `GET /wallet/entries`, `POST /wallet/entries`, `PUT/DELETE /wallet/entries/:id` |
| Contacts | `GET/POST /contacts`, `PUT/DELETE /contacts/:id`, `PATCH /contacts/:id/favourite` |
| Database | `/database/status`, `/logs`, `/initialize`, `/backups…`, `/replication…`, `/optimization`, `/optimize` |
| Tools | `/tools/lvgl/*`, `/tools/convert/*` |

Routes whose literal segment could be read as a parameter (`/chat/users`,
`/projects/members`, `/meetings/ice`) are declared before the parameterised
route that would otherwise swallow them.

Express 4 does not catch a rejected promise from an async handler, so routes
added since that was noticed wrap theirs in `asyncRoute`, which forwards the
rejection to the error middleware.

## 6. Frontend design system

`frontend/src/styles/vision.css` defines the tokens (`--v-primary`,
`--v-space-*`, `--v-radius-*`, tints, shadows) and `vision-pages.css` the
page-level classes. Charts are hand-rolled SVG — there is no charting
dependency. Categorical series use blue and amber rather than green and red,
because green/red is exactly the pair that red-green colour blindness
collapses; every chart also carries a legend or a direct label, so identity is
never colour alone.

Interface text is loaded at runtime from `frontend/public/translations.xml`
by `frontend/src/i18n.js`, which fetches the catalogue once, parses it with
`DOMParser`, and falls back from the chosen language to English to the key.

## 7. Configuration and operations

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 4000 | API port |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/knowledge-store` | Database |
| `JWT_SECRET` | a development string | **Must** be set in any real deployment |
| `VITE_API_URL` | `http://127.0.0.1:4000/api` | API base used by the browser |
| `HOST` | `127.0.0.1` | Interface the API binds to. Loopback means only this machine can reach it, so a meeting cannot have a second participant. |
| `ALLOWED_ORIGINS` | — | Extra origins the frontend is served from, comma separated. Needed alongside `HOST`. Opt-in rather than a wildcard. |
| `MEETING_MAX_PEERS` | 8 | People per meeting. Mesh cost is quadratic; 4–6 is comfortable. |
| `MEETING_MAX_RECORDING_MB` | 256 | Upload limit for a recording — far larger than any other upload here. |
| `MEETING_STUN_URL` | Google public STUN | How browsers discover their own public address. |
| `MEETING_TURN_URL` / `_USERNAME` / `_PASSWORD` | — | A relay for networks STUN cannot traverse. Must be a server you run or pay for. |
| `MEETING_ICE_SERVERS` | — | Raw `RTCIceServer[]` JSON, replacing the three settings above. |
| `FACE_MATCH_MAX` | 0.5 | How close a face must be to sign in. Looser lets strangers in; tighter rejects the same person in different light. |
| `FACE_MATCH_MARGIN` | 0.05 | How much closer the best match must be than the second best, before the system will claim to know which person it is. |

At boot the API creates `uploads/` and `backups/`, seeds the `admin` account
and the default categories, applies any outstanding permission backfills,
starts the retention sweep and attaches the meeting signalling socket. CORS
allows loopback origins on any port, which suits the Vite dev server, plus
whatever `ALLOWED_ORIGINS` lists.

In development the Vite dev server must proxy `/rtc` with `ws: true` as well as
`/api`; without the flag it answers the upgrade itself and no meeting connects.

## 8. Known limitations

- Uploads are served from a static path with no authorisation check; a chat
  attachment's URL is unguessable but not protected. Moving to an
  authenticated download route would change every attachment surface in the
  app, so it is recorded here rather than done piecemeal.
- Chat delivery is polled, so a message can take up to four seconds to appear.
- The retention sweep runs in-process; if the API is down when a file expires,
  it is deleted at the next boot instead.
- Face sign-in is now sufficient on its own, so the descriptor **is** a
  credential rather than a second check on one. It can be reproduced from a
  photograph and there is no liveness test, so an installation that needs a
  real guarantee of identity should not rely on it. The tightened threshold and
  the runner-up margin reduce false matches between enrolled people; neither
  does anything about a printed photo.
- Face sign-in compares against every approved account in one pass. That is
  fine for an internal tool and becomes linear work per attempt as the number
  of accounts grows.
- Deleting an account is not transactional (standalone `mongod`). An
  interrupted purge leaves the remainder behind; re-running the deletion
  finishes it.
- Meetings are a mesh, so they do not scale past a handful of participants.
  Going further would mean an SFU — a media server that receives each camera
  once and forwards it — which is a separate piece of infrastructure, not a
  change to this code.
- Meeting occupancy lives in one process's memory, so the backend cannot be
  run as a cluster without moving that state to Redis or similar.
- Without a TURN server, participants behind a symmetric NAT will fail to
  connect. Nothing in this application can compensate for that.
- Camera, microphone and screen capture need a secure context. On a plain
  `http://` LAN address the browser does not expose the API at all, and the
  Meetings page says so up front rather than at the moment of joining.
- A recording is made by a participant's browser, so it stops if that tab is
  closed, and a minimised tab is throttled by the browser and records fewer
  frames. It captures what that participant received, not a server-side master.
