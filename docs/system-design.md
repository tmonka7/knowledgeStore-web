# Knowledge Store — System Design Document

Version 1.0 · 21 September 2026 · Companion to the Requirements Specification

## 1. Architecture

Two deployables and one database.

```
Browser ── React 18 / Vite 5 / Ant Design 5 (frontend)
   │  HTTP + JWT (Authorization: Bearer …)
   ▼
Express 4 API (backend)  ──  filesystem: uploads/, backups/
   │  Mongoose 8
   ▼
MongoDB
```

There is no message broker, no cache and no background worker process. The one
piece of scheduled work — the chat retention sweep — runs on an interval inside
the API process.

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

**Token.** `POST /auth/login` returns a JWT signed with `JWT_SECRET`, carrying
`{ sub, username, role }` and expiring in 8 hours. `requireAuth` verifies it
and puts the payload on `req.user`.

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

**Face verification.** The browser computes a 128-float descriptor with
`frontend/src/lib/faceRecognition`. It is stored on the account (`select:
false`, so it is never returned by an ordinary read). At sign-in the server
compares the submitted descriptor with the stored one by Euclidean distance
and rejects anything over 0.6. The photo itself is kept as a data URL for
display only.

## 3. Data model

All collections use a UUID string `id` as the public identifier; Mongo's
`_id` never leaves the server.

| Collection | Key fields | Ownership |
|---|---|---|
| `users` | username, email, fullName, role, permissions[], passwordHash, faceDescriptor, faceImage, **gender, birthday, phone, address, job** | — |
| `records` | title, categoryId, content (HTML), attachment(s), ownerId, **visibility, sharedWith[]** | owner + whoever it is shared with |
| `categories` | name, parentId, path, level | shared |
| `cameras` | name, location, address, status, notes | shared |
| `schedules` | title, notes, date, time, repeat, repeatUntil, ownerId | per owner |
| `mail_messages` | senderId, subject, body, **recipients[{userId, name, readAt, deletedAt}]**, recipientIds[], attachment, replyToId, sentAt | sender + recipients |
| `posts` | title, body, authorId, pinned, **views[{userId, userName, viewedAt}]**, viewerIds[] | shared |
| `contacts` | fullName, email, phone, company, jobTitle, group, tags[], favourite, ownerId | per owner |
| `wallet_entries` | type, amount, **currency**, category, note, method, date, ownerId | per owner |
| `projects` | key, name, status, colour, dates, memberIds[], progressOverride, taskCounter | shared |
| `tasks` | projectId, number, key, title, description, type, status, priority, assigneeId, reporterId, bug fields, resolution, attachments[], comments[], activity[] | shared |
| `chat_threads` | participantIds[2] (sorted), lastMessageAt, lastMessagePreview, lastMessageSenderId | two participants |
| `chat_messages` | threadId, senderId, recipientId, body, **attachment**, readAt | two participants |
| `activity_logs` | level, source, action, message, actor, meta | shared |

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

### 4.7 Database maintenance

`databaseMaintenance.js` covers backup (canonical Extended JSON via the BSON
library Mongoose already ships, so `Date` and `ObjectId` round-trip), restore
(replace or merge, always after a safety backup), replication commands, and
optimisation.

The orphan-upload scan builds the referenced set from record attachments,
mail attachments, task attachments **and chat attachments whose file has not
yet been swept**. Anything not in that set and older than one hour is an
orphan. Missing a source here means deleting live files, which is why the set
is built from every model that stores a path.

## 5. API surface

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login` |
| Users | `GET /users`, `GET /users/directory`, `PUT /users/:id`, `GET /permissions/catalog`, `GET /user/profile`, `PUT /user/password`, `PUT /user/profile` |
| Records | `GET /data`, `GET /data/search`, `POST /data`, `PUT /data/:id`, `DELETE /data/:id` |
| Categories | `GET/POST /categories`, `DELETE /categories/:id` |
| Cameras | `GET/POST /cameras`, `PUT/DELETE /cameras/:id` |
| Projects | `GET /projects/members`, CRUD on `/projects[/:id]`, CRUD on `/projects/:projectId/tasks[/:taskId]`, `POST …/transition`, `POST …/comments`, `POST/DELETE …/attachments` |
| Chat | `GET /chat/users`, `GET /chat/recent`, `GET/POST /chat/threads`, `GET/POST /chat/threads/:id/messages`, `POST /chat/threads/:id/attachments`, `POST /chat/threads/:id/read` |
| Mail | `GET /mail?folder=inbox\|sent`, `GET /mail/inbox`, `GET /mail/unread`, `GET/DELETE /mail/:mailId`, `POST /mail` |
| Posts | `GET /posts`, `GET /posts/notifications`, `POST /posts`, `GET/PUT/DELETE /posts/:id`, `POST /posts/:id/view` |
| Schedule | `GET /schedules`, `GET /schedules/upcoming`, `POST /schedules`, `PUT/DELETE /schedules/:id` |
| Wallet | `GET /wallet/summary`, `GET /wallet/entries`, `POST /wallet/entries`, `PUT/DELETE /wallet/entries/:id` |
| Contacts | `GET/POST /contacts`, `PUT/DELETE /contacts/:id`, `PATCH /contacts/:id/favourite` |
| Database | `/database/status`, `/logs`, `/initialize`, `/backups…`, `/replication…`, `/optimization`, `/optimize` |
| Tools | `/tools/lvgl/*`, `/tools/convert/*` |

Routes whose literal segment could be read as a parameter (`/chat/users`,
`/projects/members`) are declared before the parameterised route that would
otherwise swallow them.

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

At boot the API creates `uploads/` and `backups/`, seeds the `admin` account
and the default categories, and starts the retention sweep. CORS allows only
loopback origins on any port, which suits the Vite dev server.

## 8. Known limitations

- Uploads are served from a static path with no authorisation check; a chat
  attachment's URL is unguessable but not protected. Moving to an
  authenticated download route would change every attachment surface in the
  app, so it is recorded here rather than done piecemeal.
- Chat delivery is polled, so a message can take up to four seconds to appear.
- The retention sweep runs in-process; if the API is down when a file expires,
  it is deleted at the next boot instead.
- Face matching uses a single stored descriptor and a fixed threshold, which
  suits an internal tool and is not a security boundary on its own — the
  password is still required.
