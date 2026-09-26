# Knowledge Store

A full-stack starter app with:
- React + Vite + Ant Design frontend
- Node.js 20 + Express backend
- Login by password or by face, as alternatives
- Account approval (pending / allowed / denied) and full account deletion
- User management
- Data manager API and UI
- Video meetings (WebRTC, peer-to-peer) with screen sharing and recording

## Quick start

1. Install dependencies:
   - `npm install --prefix backend`
   - `npm install --prefix frontend`
2. Start backend:
   - `npm --prefix backend run dev`
3. Start frontend:
   - `npm --prefix frontend run dev`
4. Open:
   - Frontend: https://localhost:6173
   - API: https://localhost:4000/api/health

## Running over HTTPS

**This is how the app is meant to run, not a hardening step.** Cameras, screen
sharing and face capture are all gated on a secure context, and `localhost` is
the only address a browser grants that over plain `http://`. The moment a
colleague opens the app from another machine — which is the entire point of a
meeting — it has to be https or their camera does not exist as far as the
browser is concerned.

Put a certificate and its key at the repository root as `server.crt` and
`server.key` and both halves pick them up on their own: the API serves https,
and the Vite dev server serves https *and* proxies `/api` and `/rtc` through to
the API. Nothing else needs configuring. Other paths, or turning it off again:

| Setting | Effect |
| --- | --- |
| `SSL_CERT_PATH`, `SSL_KEY_PATH` | Where the certificate and key live. Relative paths are resolved against the backend folder, then the repository root. |
| `USE_HTTPS=false` | Serve plain http even though the files are there. |
| `HTTPS_PORT` | The https port, when it should differ from `PORT`. |
| `API_HOST`, `API_PORT` | Where the dev server's proxy looks for the API. Defaults to `127.0.0.1:4000`. |

The dev server's proxy talks to the API with certificate checking off, because
a self-signed certificate is one Node refuses. That is this machine trusting
its own backend; the browser's connection is to the dev server and is still
checked normally.

**A self-signed certificate needs one deliberate exception per browser.** The
first visit shows a warning; accepting it is enough, and the meeting socket is
covered by the same exception because it runs over the page's own origin. Two
things make that worse than it needs to be:

- **A certificate with no `subjectAltName` is rejected outright by name.**
  Browsers have ignored the `CN` field for hostname matching since 2017, so a
  certificate that names its host only there always fails, on every address.
  It can still be clicked through, but it can never be trusted properly.
- **Each origin is separate.** `localhost` and `192.168.1.10` are two
  exceptions, so put every address you will actually use in the certificate:

```
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout server.key -out server.crt -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:192.168.1.10"
```

For colleagues to join, only the dev server has to be reachable — it already
listens on every interface, and it is what forwards `/api` and `/rtc` onward,
so the API can stay on loopback and out of reach. What does need saying is the
origin: the proxy passes the browser's `Origin` header through, and the API
only trusts loopback and private-range origins by default. Served from a public
address, list it — `ALLOWED_ORIGINS=https://95.217.56.218:6173`. Pointing
`VITE_API_URL` straight at the API instead is what makes `HOST=0.0.0.0`
necessary, along with a second certificate exception.

## Default admin login

- Username: `admin`
- Password: `admin123`

## Signing in, and account approval

**Two ways in, and they are alternatives** — not two steps:

1. `POST /auth/login` — username and password.
2. `POST /auth/login/face` — a descriptor, and nothing else.

The previous build required the password *and*, for any account with a face on
file, the face as well. Since registration enrolled a face for everybody, that
meant all users answered two challenges and "Login with Face" was unusable by
anyone who did not already know their password. The face button no longer
validates the login form first and sends no username at all.

**Enrolling a face is optional.** It is one of two ways in, not a second
factor, so an account without one is complete — it signs in with its password.
Requiring it at sign-up turned an alternative into a toll gate and shut out
anyone with no camera to hand, or unwilling to hand a photograph to an account
they had not been approved for yet. A face offered at sign-up is still
validated: both the descriptor and the photo must arrive and be readable, or
the registration is refused rather than half-stored.

An administrator can enrol a face afterwards from the Users page, which already
filters on who has one and who does not. There is no way for users to add their
own face after signing up — the same is true of their name and email, which
that page also owns.

### What face sign-in now costs

It identifies rather than verifies: with no username to start from, the server
searches every approved account for the closest descriptor. The risk that grows
with the number of accounts is not "is this close enough" but "is this closer
to the right person than to somebody else", so two rules apply — the distance
must be under `FACE_MATCH_MAX` (0.5, down from the 0.6 used for verification),
**and** the best match must beat the runner-up by `FACE_MATCH_MARGIN` (0.05).
If two accounts are near-equally close the server refuses rather than taking
the smaller number. Every refusal returns one message, so the form cannot be
used to enumerate who is enrolled.

Be clear-eyed about the trade: a descriptor is now a credential on its own, it
can be produced from a photograph, and nothing here tests liveness. This
establishes what someone looks like, not what they know. If that is not good
enough for your installation, do not use method 2.

### Pending / Allowed / Denied

Registration creates the account as **pending** and returns **no token** — a
session whose every request is refused is worse than being told plainly to
wait. An administrator sets Allowed or Denied from the Users page.

`pending` and `denied` are deliberately distinct. One means nobody has looked;
the other means somebody looked and said no. Telling a waiting applicant they
have been rejected sends them to ask an administrator about a decision nobody
made.

`requireAuth` now reads the account from the database on every request rather
than trusting the token, so denying or deleting an account takes effect on that
person's next click instead of whenever their eight-hour token happens to
expire. The lookup deliberately excludes the face photo, which is a base64 data
URL of up to 2MB and would otherwise be the most expensive part of most
requests.

### The upgrade hazard

Mongoose applies a schema default to a path missing from a document it loads.
The moment `status` existed, every account already in the database began
reading as `pending` — an upgrade that locks out the entire installation,
administrators included. `helpers/accountStatusBackfill.js` sets them all to
`allowed` once, marker-guarded, before the port opens. `ensureSeedAdmin` and
`ensureSuperuser` write `allowed` explicitly, because an administrator who
needs approving by an administrator is a locked door with the key inside.

## Deleting an account

`DELETE /users/:id` removes the account and everything behind it — see
`backend/src/helpers/userPurge.js`. Records and their files, wallet, contacts,
schedule, posts, chat threads and their files, mail, hosted meetings and their
recordings, in-call messages, activity log entries, the face photo.

**Shared project work is unlinked rather than destroyed.** A project is not one
person's information, and deleting it would take other people's tasks and
history with it. Ownership passes to the administrator running the deletion —
an `ownerId` nobody holds leaves a project nobody can manage — membership is
dropped, tasks are unassigned, their comments go, and their entries in a task's
history are anonymised so the trail of how a bug reached "verified" keeps all
its steps.

Two cases needed a judgement rather than a rule:

- A **chat thread** is destroyed outright, taking the other participant's copy.
  There is no half of a conversation that is not also theirs.
- **Mail they received** loses only their recipient row. A message is destroyed
  only when the sender has also deleted it — the same condition `deleteMail`
  uses. Dropping every message left with no recipients would destroy the
  *sender's* copy in Sent: someone else's data, deleted because the person they
  wrote to was removed.

`GET /users/:id/deletion-preview` runs the same counting function `purgeUser`
calls first, so the confirmation dialog cannot describe one thing while the
deletion does another.

Not a transaction — standalone `mongod` has none. The order is chosen so an
interrupted run leaves data incomplete rather than inconsistent and can simply
be repeated.

Guards: nobody can delete their own account, and neither Deny nor Delete may
take the last administrator able to sign in.

## Confirming destructive actions

Every delete in the application asks first, and the question names what is at
stake rather than asking "are you sure?".

Two places did not ask at all and now do — deleting a **category** and removing
a **task attachment**, both of which deleted on the click. One asked too much:
the records toolbar confirmed the selection and then called the single-record
handler, which opened its own dialog per record, so confirming "delete 8
records" produced eight more questions. `handleDeleteRecords` gives the bulk
path one confirmation and one reload.

## Mail

Mail was a private notepad: every message carried a single `ownerId`, `to` was
free text, and everything it created was filed as 'Draft', so sending produced
a document no recipient could ever receive. Replaced rather than extended, for
the same reason chat was — none of those fields describe a message with two
ends.

One document per message with a row per recipient, not a copy per mailbox:

```
mail_messages: { senderId, subject, body, attachment,
                 recipients: [{ userId, name, readAt, deletedAt }], recipientIds: [] }
```

That is what makes **open tracking** answerable. The sender's copy *is* the
recipients' copy, so the `readAt` stamped when a recipient first opens the
message is the same fact the sender reads back as "opened at 14:12" — a
separate receipt record could drift from the mailbox it describes; this
cannot. The stamp is written once, so re-reading never moves it.

Inbox is `recipients` matching `{ userId, deletedAt: null }`, Sent is
`senderId` with `deletedBySender` false, and deleting is per person: your row
is stamped and the document goes only when nobody holds it — which also keeps
its attachment alive while someone can still open it. `getMailFor` is the one
privacy gate and, like chat's, has no administrator bypass.

## Meetings

Video calls between people in this workspace, on the `Meetings` page. Create a
room, invite everyone or a named few, and join. **`npm install --prefix
backend` is required** — this is the first feature with a new dependency (`ws`).

**The media never touches this server.** Two browsers exchange an offer, an
answer and some ICE candidates and then talk directly. All the backend does is
carry that handshake, over a WebSocket at `/rtc` sharing the API's port.

### Why a socket here when everything else polls

Chat, mail and posts can afford to be a few seconds stale. A handshake cannot:
an offer that arrives a poll interval late is a call that connects that much
later, and a candidate that arrives after its peer has given up is a call that
never connects. This is the one place where latency is correctness. `server.js`
therefore builds an explicit `http.Server`, because `app.listen()` never hands
back the object `ws` needs.

### Full mesh, and what that costs

Everyone holds a connection to everyone else. No media server is needed — which
is the only reason this fits in a plain Express app — but each person uploads
their camera once per other participant. `MEETING_MAX_PEERS` (default 8) caps
it; 4–6 is comfortable. Going beyond that means an SFU, which is separate
infrastructure rather than a change to this code.

Whoever is already in the room offers to whoever arrives, and the newcomer
never offers. One initiator per pair means two peers can never offer each other
at once — "glare", the classic cause of a call that connects one way only. Both
audio and video m-lines are reserved when a connection opens, so starting a
screen share is a `replaceTrack` with no renegotiation at all.

**Screen sharing has two halves and needs both.** `replaceTrack` swaps the
track for the peers connected at that moment; `ensurePeer` reads the screen
track when building a *new* connection. Missing the second one made the
feature look broken outright — connections built during a share carried the
camera, and since a presenter normally starts before anyone arrives, every
connection was built that way and nobody ever saw the screen. A shared track
is also given `contentHint = 'detail'` (sharpness over frame rate, the right
way round for text) and is rendered `contain` rather than `cover`, on the tile
and in recordings: cropping a face to fill a cell is fine, cropping a
presentation removes its edges and the presenter cannot tell.

### Occupancy is not stored

Who is in a room lives in the signalling process's memory, not in MongoDB.
Storing it looks tidier right up until a crash leaves a room permanently
occupied by nobody, with nothing to correct it. Derived from live sockets, it
cannot go stale — a 30-second ping reaps browsers that were suspended rather
than closed. The price: the backend must run as a single process.

Identity is per connection, not per person, so a second tab cannot tear down
the first one's call. The roster, the room cap and the attendance log all
de-duplicate by account.

### Recording

Done by the browser: every tile is painted onto a canvas, everyone's audio is
mixed through a `MediaStreamAudioDestinationNode`, and `MediaRecorder` captures
the result. It uploads to the meeting when it stops.

Everyone in the call is told for as long as it runs, and the indicator is not
separately controllable — a recording light the recorder can switch off is not
consent. Audio comes from the camera stream rather than the displayed one, so a
presenter's voice is not dropped for the length of their screen share.

### Two things that will bite you

**Camera access needs a secure context.** Browsers only expose
`navigator.mediaDevices` over HTTPS or on `localhost`; on a plain `http://` LAN
address it is not merely refused but *undefined*. The Meetings page detects
this and says so under the page header rather than letting it surface as a
crash at the moment of joining.

**The API binds to `127.0.0.1` by default,** which means nobody else can reach
it and a call cannot have a second participant. Set `HOST=0.0.0.0` and list the
origins you serve the frontend from in `ALLOWED_ORIGINS`. In development, Vite
must also proxy `/rtc` with `ws: true` — without the flag it answers the
upgrade itself and nothing connects.

Across the internet, STUN handles most routers; symmetric NAT needs a TURN
server (`MEETING_TURN_URL` and friends), which relays media and so has to be
one you run or pay for. Without it a minority of participants simply cannot
connect, and nothing in this app can compensate.

See `backend/.env.example` for every meeting setting.

## Posts

### Permissions added after accounts exist

`DEFAULT_USER_PERMISSIONS` is read when an account is created, so adding
`posts:view` to it did nothing for anyone who had registered earlier: the page
was hidden from their sidebar and their notification poll answered 403, which
the poll swallowed. A post published for everyone reached nobody, and nothing
said so.

`helpers/permissionBackfill.js` grants such a key to existing accounts once,
against a marker in `app_migrations`, and never again — re-running it on every
boot would undo a revocation an administrator made on purpose. Adding another
late default is one entry in that list. The notification polls now log a 403
rather than swallowing it, so the next gap of this kind is visible.

### How a post is stored

Administrators publish announcements; everyone reads them. A post stores its
readers rather than a counter, because the page has to show not just how many
have read it but exactly who:

```
posts: { title, body, authorId, pinned,
         views: [{ userId, userName, viewedAt }], viewerIds: [] }
```

`recordPostView` filters on `viewerIds: { $ne: userId }` and both `$addToSet`s
the id and `$push`es the row, so a second reading cannot add a second row —
the count is a number of people, not of page loads.

The bell counts posts whose `viewerIds` does not contain you, which is why
reading one makes the number fall. Recording a view is its own request
(`POST /posts/:id/view`) rather than a side effect of a GET: a list that
prefetched bodies would otherwise mark everything read without anyone reading
it. The Posts page calls back into the shell after recording one, so the bell
recounts immediately rather than at the next minute's poll.

## Record sharing

A record carries `visibility` (`everyone` or `selected`) and `sharedWith`. The
author picks one when adding or editing it; `everyone` is the default, and a
record written before this existed has no field at all — which is why the
access clause tests `visibility != 'selected'` rather than `== 'everyone'`, so
a missing value reads as the default rather than as "nobody". **Existing
records therefore become readable by everyone**, where before they were
visible only to their owner.

Two things in `recordModel.js` are load-bearing:

- `allOf` composes every condition under `$and`. The access clause and a text
  search are both `$or` expressions, and spreading one over the other at the
  top level of a query would drop the access check — a search would return
  records the caller cannot read.
- `recordAccessFilter` is the only place the rule lives; `getRecords` and
  `searchRecords` both go through it.

The administrator bypass now comes from `req.currentUser.role`, loaded by the
permission middleware, rather than `req.user.role` from the token — with
records shared selectively, a demoted administrator keeping the bypass for the
rest of their eight-hour session would be a leak.

Sharing grants reading. `updateData` and `deleteData` still demand ownership
or administrator, and the Data table hides those buttons on a record you do
not own instead of offering one that answers 403. The picker is filled by
`GET /users/directory` — id, name and username, behind `requireAuth` only,
because addressing a share is not an administrative act.

## Documentation

Written against this build, in `docs/`:

| Document | What it answers |
| --- | --- |
| [Requirements Specification](docs/requirements-specification.md) | What the system must do, as numbered requirements with actors and constraints |
| [System Design Document](docs/system-design.md) | Architecture, data model, authorisation, the workflow/currency/retention/meeting mechanisms, API surface |
| [Screen Design Document](docs/screen-design.md) | Navigation map, the grammar every page follows, and each screen's regions and controls |
| [Test Case Specification](docs/test-case-specification.md) | Cases traced to requirement IDs, with a regression set for the current release |
| [User Manual](docs/user-manual.md) | How to use the application, written for the people using it |

## Database Management

**Database Management** (admin, or the `database:view` / `database:manage`
permissions) is four tabs over the same MongoDB connection the app already
uses. Everything it does is a driver command — nothing shells out to
`mongo`, `mongodump` or `mongorestore`, so it works wherever the API runs.

### Initialization

Syncs the indexes the models declare, seeds the root categories when none
exist, and creates a superuser. An account matching the username or email is
promoted to `admin` and re-keyed rather than duplicated, so running it twice
leaves one usable administrator either way.

*Reset and initialize* additionally drops every collection. It demands the
typed confirmation `RESET` and a superuser — without one, nobody could sign
back in — and always writes a backup first, so a mistaken reset is recoverable
from the Restoration tab. Because it drops `users`, the session that made the
request is dead on arrival; the page says so and signs you out.

### Restoration

A backup is one extended-JSON dump of every collection, written to
`backend/backups` (git-ignored). Canonical EJSON is what keeps `Date` and
`ObjectId` values round-trippable — plain `JSON.stringify` would turn both into
strings and the restore would quietly change every document's types.

Restores come in two modes. *Replace* empties each collection first, making the
backup the whole truth, and takes its own safety backup beforehand. *Merge*
keeps what is there and skips documents whose `_id` or unique key already
exists. Backups can be downloaded, uploaded and deleted from the same tab.

The dump is assembled in memory before it is written, which suits a store of
this size. A database large enough to strain that wants `mongodump`, not a web
page.

### Replication

`rs.initiate()`, `rs.add()` and `rs.remove()`, driven through
`replSetInitiate` / `replSetReconfig`, plus a live `replSetGetStatus` view of
the members. Replication is a server-level feature: a `mongod` started without
`--replSet` has none, and the tab says exactly that rather than showing an
empty member list. Starting the server with `--replSet` is the one step that
cannot be done from here.

### Optimization

System maintenance, each task reported separately so one refusal does not hide
another task's success:

| Task | What it does |
| --- | --- |
| Delete unlinked uploaded files | Removes files under `uploads/` that no record, mail or task attachment references |
| Clear activity logs | Deletes the stored maintenance log, optionally keeping the last *n* days |
| Compact collections | `compact` per collection, to release space deleted documents left behind |
| Sync indexes | Recreates the declared indexes and drops the ones the models no longer declare |

Orphan detection compares the files on disk against every `attachment` /
`attachments` value in `records`, `mail_inbox` and `project_tasks`. Any
collection that can hold an upload has to be listed in `getReferencedUploads`:
one left out has its live files reported as orphans and deleted.

Files modified in the last hour are listed but never deleted: an upload is
written by multer *before* the record that will reference it is saved, and a
half-finished compose still holds its file.

The log the third task clears is the `activity_logs` collection, written by
these maintenance actions themselves — it lives in the database rather than in
a file so it can be read and cleared without shell access.

## Chat

**Chat** is direct messages between accounts on this app: search for someone,
pick them, and write to them.

### The mail and message icons in the header

`GET /chat/recent?limit=5` returns the newest messages addressed to you and
the unread total in one response, because the header polls it every 15 seconds
and a second round trip for the badge would double that for nothing. It
replaced `GET /chat/unread`, which only ever served the badge.
`GET /mail/recent?limit=5` is its counterpart for the inbox, and the two
header menus are built the same way on purpose.

Choosing a message hands its `threadId` up to DashboardPage, which switches to
Chat and passes it down as `initialThreadId`; ChatPage opens that conversation
once the thread list has arrived, then clears the request so returning later
does not reopen it.

### File transfer

A file goes as a message of its own — `POST /chat/threads/:id/attachments`,
multipart, with whatever was in the composer as its note — so it sits in the
conversation in the order it was sent rather than hanging off another message.
Limit: one file, 25 MB, stored under `uploads/chat/` with a generated name.

**Uploads live for a week.** `helpers/chatRetention.js` sweeps at boot and
hourly: it deletes the file, appends `(deleted)` to the stored name and stamps
`deletedAt`. The message itself is never removed — the record that a file was
sent outlives the file, and the tagged name is what tells the UI to stop
offering a download. The sweep refuses any stored path that resolves outside
`uploads/chat`, because that path comes back out of the database.

`getReferencedUploads` counts chat attachments whose file has not yet been
swept, so the Database Management orphan cleanup never deletes a live one.

It used to be something else. A conversation carried a single `ownerId`, every
message was stored as `sender: 'me'`, and no message named a recipient — so a
"chat" was a private notepad that nobody else could ever receive. The model was
replaced rather than extended, because none of those fields describe a message
with two ends.

### How it is stored

| Collection | Holds |
| --- | --- |
| `chat_threads` | one document per pair: `participantIds` (two ids, always sorted), plus the last message's time, preview and sender |
| `chat_messages` | one document per message: `threadId`, `senderId`, `recipientId`, `body`, `readAt` |

Sorting the pair means two people opening each other at the same moment still
land on one thread, and `findOrCreateThread` matches on `$all` + `$size` rather
than array equality so stored order can never matter. Messages are their own
collection because a busy thread would otherwise grow a single document without
bound and rewrite the whole history on every send.

A thread is private to its two participants, **administrators included**. Every
read and write goes through `getThreadFor(userId, threadId)`, so there is one
place where that rule lives and no route can forget it.

The previous `chat_conversations` collection is left untouched rather than
migrated or dropped: those notes-to-self have no recipient to migrate them to.
Nothing reads it any more, and the Database Management cleanup does not remove
collections, so the old documents remain until someone deletes them.

### Searching and sending

One search box does both jobs, the way a messenger's does: it filters the
conversations you already have, and at the same time looks up people you have
not written to yet (`GET /chat/users?q=`, debounced, excluding yourself and
anyone already in the list). Picking a person calls `POST /chat/threads`, which
is idempotent — selecting the same person twice does not make a second thread.

### Delivery

There is no socket in this stack, so delivery is polled. The open thread asks
for anything newer than its last message every 4 seconds
(`GET /chat/threads/:id/messages?after=<ISO>`), the conversation list refreshes
previews and unread counts every 6, and the sidebar badge every 15. A quiet
chat therefore costs one small empty array per poll. Opening a thread marks its
incoming messages read — you are looking at them — which is what clears the
badge and turns the sender's single tick into two.

## My Page

**My Page** holds everything that belongs to the signed-in account rather than
to the organisation. It is reached from the menu under the user avatar, not
from the sidebar, and needs no page permission — it is always your own account.
The tabs inside it still respect the wallet and contacts permissions, which the
API enforces regardless.

### Account

Alongside the password form, **Personal details** edits the five optional
fields an account carries — gender, birthday, phone, address and job — through
`PUT /user/profile`. That route is deliberately narrower than `PUT /users/:id`:
name, email, role, permissions and the face photo stay with an administrator,
because they are what the rest of the app identifies and authorises you by.
`birthday` is a `YYYY-MM-DD` string, must be a real date, and is refused if it
is in the future.

Your profile, and the form for changing your own password. That form used to
sit at the bottom of the Users page, which only administrators can open — so
the one setting every account has was behind a permission almost nobody had.
Name, email and face photo remain an administrator's job, and the panel says
so rather than showing fields that would fail.

### Wallet

The wallet records income and expenses and reports on them. It is personal,
like the schedule: every query is scoped by `ownerId`, so one account never
sees another's figures, administrators included.

Amounts are stored positive and `type` (`income` / `expense`) carries the sign,
which keeps each series a plain sum. Dates are `YYYY-MM-DD` strings rather than
`Date` values for the same reason schedules are — an entry belongs to a
calendar day in the owner's timezone, and an instant would drift across the
month boundary in the charts.

#### Two currencies, never merged

The currency is a property of the **entry**, chosen when it is recorded, and
is one of `USD` or `REM` (`USD` for rows written before the field existed).

`GET /wallet/summary` adds up the totals, the monthly series and the category
breakdown on the server, against the same filters the entry list uses, so the
stat cards, the charts and the table can never disagree. It does that once per
currency and returns `byCurrency: { USD: {…}, REM: {…} }`, summarising a
currency even when it has no rows, so the page can always show both side by
side.

Nothing converts between them. There is no exchange rate anywhere in this app,
and a combined balance would be a figure nobody could act on — so there is no
combined balance, and no currency selector to hide one behind. `REM` is not an
ISO 4217 code, so `money.js` formats it as a number followed by the code while
`USD` goes through `Intl`.

#### Chart colours

Income and expense are two series that have to be told apart, so they take two
categorical hues: the design system's primary blue and its amber. Green and red
is the conventional pairing and precisely the reason it is avoided here — it is
the pair red-green colour blindness collapses. Blue and amber stay separable
under every common form of CVD, and each chart carries a legend or a direct
label so identity never rests on colour alone. The running-balance line is a
single series, so it takes one hue and no legend; only its endpoint is
labelled.

### Contacts

A personal address book — name, email, phone, company, role, group, tags and
notes — scoped by `ownerId` like the wallet. Favourites sort to the top, and
starring one goes through `PATCH /contacts/:id/favourite` rather than the
update route, so a star pressed in the list cannot overwrite the fields the
card is not showing.

## Project Management

**Project Management** is a project list and, behind each project, a board that
walks bugs through **report → resolve → verify**.

### Projects

Each project carries a name, a short **key** (`KS`), a status, dates, a colour,
and its members. Owner, members and administrators see a project; nobody else
does, and the same rule covers its tasks.

The key prefixes every task id (`KS-14`). Task numbers are handed out with an
atomic `$inc` on the project, so two people filing a bug at the same moment
cannot be given the same one — and the key is fixed once tasks exist, since
renaming it would orphan every reference already written in a comment.

Progress is counted from the board: verified and closed tasks over all tasks.
A project can override it with a manual percentage when the work it tracks is
not all on the board, and the card says which of the two it is showing rather
than quietly swapping one for the other.

### The workflow

`backend/src/helpers/taskWorkflow.js` is the single definition of the
lifecycle. `frontend/src/components/project/workflow.js` mirrors it to shape
the UI; the API is what decides.

| From | May move to |
| --- | --- |
| Open | In progress, Resolved, Closed |
| In progress | Resolved, Open, Closed |
| **Resolved** | **Verified, Reopened** |
| Verified | Closed, Reopened |
| Reopened | In progress, Resolved, Closed |
| Closed | Reopened |

Nothing goes straight from *Resolved* to *Closed*. It is verified, or it is
sent back — that single missing edge is what makes the verification step real
rather than decorative.

Two moves carry a requirement, enforced server-side and asked for up front by
the UI:

- **Resolve** needs a resolution (fixed, done, won't fix, duplicate, cannot
  reproduce).
- **Reopen** needs a reason, which is stored as a comment as well as on the
  history entry. Reopening also clears the resolution and the verification,
  because the fix did not hold, and increments the task's reopen count.

An illegal move is refused with `409` and the list of moves that *are* legal,
so a board left open on a stale tab corrects itself instead of guessing.

### The board

Six columns, one per status, with cards dragged between them using the
browser's own drag and drop — no extra dependency. While a card is held, the
columns it cannot legally reach stop accepting the drop and dim, so the
workflow is visible *before* the drop rather than arriving as an error after
it. A card's type is carried by its left edge as well as its icon, so a board
full of bugs reads at a glance and the cue is never colour alone.

Opening a card shows the report (steps to reproduce, expected, actual,
environment — only for bugs, where they earn their place), the moves available
from its current status, its comments, and the history of who moved it and
when. There is no free status dropdown anywhere on the page: every status
change goes through the same gate.

A task's description is written in the same TinyMCE editor a record's content
uses (`components/HtmlEditor.jsx`), so a report can carry a table, a list or a
pasted screenshot, and the drawer renders it as the markup it is. The
reproduction fields stay plain text: they are steps, not documents.

Files attach from either the edit dialog or the drawer. They upload against a
task that already exists rather than travelling with the form — a report being
typed has no id to hang them on yet — so the list is live rather than a pending
upload, and both views share one component. Removing an attachment drops the
reference and leaves the file for the Database Management cleanup to collect;
that cleanup reads `project_tasks` as well, so a live task file is never
mistaken for an orphan.

### Permissions

`projects:view` sees projects and boards, `projects:create` files tasks and
comments, `projects:edit` moves and edits them, `projects:delete` removes
them. Commenting deliberately needs only *create*, so a tester can hand a bug
back without the right to rewrite it. New accounts get view, create and edit.

## Camera object detection

The camera view (**Cameras -> View -> Detect Objects**) outlines people and
vehicles on a live stream, entirely in the browser. Detection runs on
YOLOX-Nano via onnxruntime-web; `frontend/src/lib/objectDetector.js` keeps the
engine behind a two-method interface (`load`, `detectObjects`) so it can be
swapped without touching the view.

### Vendored assets

Both are committed under `frontend/public/`, matching how `face-api.js` and its
models are already handled — no build step and no extra npm dependency:

| Path | Size | Source |
| --- | --- | --- |
| `public/yolox-model/yolox_nano.onnx` | 3.6 MB | [YOLOX 0.1.1rc0 release](https://github.com/Megvii-BaseDetection/YOLOX/releases/tag/0.1.1rc0) |
| `public/ort/` | 11 MB | [onnxruntime-web 1.19.2](https://www.npmjs.com/package/onnxruntime-web) dist files |

The runtime is loaded as a plain script in `index.html`, so it is fetched once
and cached rather than bundled. It is pinned to a single WASM thread because
threading requires `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`
headers this app does not send.

### Which streams can be detected on

Detection needs pixel access, which a cross-origin `<iframe>` never grants. With
detection on, the view therefore swaps the iframe for a `<video>` or `<img>`:

- **Works:** MJPEG endpoints and MP4/WebM URLs that send
  `Access-Control-Allow-Origin`.
- **Stream plays, no boxes:** the same URLs without that header. The canvas is
  tainted, and the view reports "Stream blocked by CORS" rather than silently
  showing nothing.
- **Not supported:** `rtsp://` addresses and camera viewer *pages*. Neither
  gives the browser frames to read. Reaching these would need a server-side
  decoder (ffmpeg plus an inference sidecar) pushing boxes to the UI.

### Model licensing

YOLOX is **Apache-2.0**, which is why it is used here in preference to
Ultralytics YOLO26. The YOLO26 line is **AGPL-3.0**: shipping it in this product
would oblige you to release the app's own source or buy an Ultralytics
Enterprise licence. If that licence is acquired, `yolo26n.onnx` drops in behind
the same interface — note it exports NMS-free, so such an engine skips the
`decodeYolox()` / `nonMaxSuppression()` steps entirely.

## PTZ control and automatic attendance

**Cameras -> View -> Automatic Attendance** turns a PTZ camera through an arc,
recognises every face it finds, and writes an attendance list. Faces that match
nobody are kept so the same person is recognised next time and can be given a
name.

### Why the camera is driven from the server

None of the control path can run in the browser, and it is worth being explicit
about why, because the obvious implementation does not work:

- Cameras send no `Access-Control-Allow-Origin`, so `fetch` cannot read their
  responses and a canvas drawn from their stream is tainted — the same wall the
  object-detection overlay already hits.
- They authenticate with **HTTP Digest**, which `fetch` does not implement.
  `backend/src/helpers/ptz/httpAuth.js` implements it, in about sixty lines,
  because there is no dependency installed that would.
- Doing it client-side would hand the camera's administrative password to every
  operator's browser.

So the server owns the camera: it moves the head, it fetches frames, and it
holds the credentials. `GET /api/cameras/:id/frame` proxies a still through this
origin, which is what makes the pixels readable to the page at all.

The page still does the *recognition*, because face-api runs there and there is
no equivalent on the server. It submits descriptors; the server decides whose
they are. The browser never sees the roster and never decides who was present.

### ONVIF, spoken directly

`backend/src/helpers/ptz/onvif.js` writes the SOAP envelopes itself rather than
pulling in a SOAP client for six calls. Two details in it are the difference
between working and a permanent, mystifying `NotAuthorized`:

- The WS-Security password digest is SHA1 over the raw nonce **bytes** followed
  by the created timestamp and the password. Hashing the base64 text of the
  nonce instead is the classic way to fail with entirely correct credentials.
- A camera's `GetCapabilities` reports service URLs containing the IP address it
  *believes* it has. Behind a NAT, a port forward or on a second subnet that is
  wrong, so only the path is kept and it is reached at the address that
  demonstrably answers.

Responses are read with regular expressions rather than an XML parser. That is
normally a bad idea; it is tolerable here because every field read is one
well-known element or attribute in a machine-generated document.

### Planning the sweep

`backend/src/helpers/ptz/sweep.js` decides where the camera stops. The naive
plan — divide 180 by the field of view and turn that many times — misses people
*silently*, which is the worst property an attendance system can have. Two
corrections:

1. A camera at pan angle P sees from `P - fov/2` to `P + fov/2`, so the
   outermost stops sit **half a frame inside** the arc's edges. The stops span
   `arc - fov`, not `arc`. Planning across the full arc leaves two blind wedges
   just inside its edges.
2. Frames **overlap** by a quarter of their width. A face on the seam between
   two abutting frames is cut in half in both and recognised in neither, so the
   sweep would report everyone except the person standing at the join.

If the requested zoom makes the field of view so narrow that the arc needs more
stops than the budget allows, the sweep covers a **smaller arc properly** rather
than scattering the same few stops across the full one. A narrower arc is
reported and can be argued with; a hole between frames cannot.

This maths needs the optics, which ONVIF does not report usefully, so the camera
form carries them. **Field of view is the one to get right** — it is precisely
what decides whether the frames overlap or leave gaps.

### Waiting for the head to stop

`AbsoluteMove` returns when the camera *accepts* the command, not when the lens
arrives. Grabbing a frame immediately afterwards photographs the previous angle,
consistently enough that the result looks like a working sweep with a
mysteriously poor hit rate. The server polls ONVIF `GetStatus` for `MoveStatus`
and then waits a fixed settle time as well, because plenty of cameras report
`IDLE` while the head is still visibly ringing.

### Who the faces belong to

Matching uses the same function and the same thresholds as face sign-in —
`backend/src/helpers/faceMatch.js`, extracted from `authController` for exactly
this reason. If attendance called two people the same at a distance sign-in
would reject, the list would name people the system refuses to let in.

Every submitted face ends in one of five outcomes, and the page is told which,
because "we saw eleven faces and recorded nine people" is only answerable if the
other two are accounted for:

| Outcome | Meaning |
| --- | --- |
| `user` | matched an enrolled account |
| `visitor` | matched a face seen before that has no name yet |
| `registered` | nobody has seen this face before; it is now on file |
| `ambiguous` | too close to two enrolled people to say which |
| `rejected` | too small or too uncertain to be worth matching |

`ambiguous` deliberately does **not** fall through to registering a visitor. The
person is on the roster; creating a nameless record for them would lose the
attendance row *and* add a duplicate biometric record for somebody already
enrolled.

### A face is never a credential

Registering an unknown face creates a row in `visitorFaces`, **not a user
account**. Face sign-in identifies against every enrolled account with no
password at all, so minting an account from a face that walked past a camera
would let anyone who stands in front of it become a user of this system.

Linking a visitor to an account, on the Attendance page, records the association
for attendance and nothing else. The descriptor is never copied into the
account's `faceDescriptor`, and `getFaceCandidates` never reads this collection.

### Retention

Unidentified faces are deleted after **30 days** without a sighting
(`VISITOR_FACE_RETENTION_DAYS`, swept every six hours by
`helpers/visitorRetention.js`). Faces that have been named or linked are kept.

This is not housekeeping. A face descriptor is biometric data about an
identifiable person, and this collection holds descriptors for people who were
never asked — anyone who walked in front of a camera. Without an expiry it grows
into a permanent biometric record of every passer-by, which is a liability to
hold and, in a good many jurisdictions, unlawful to hold indefinitely without a
reason. Setting the variable to `0` keeps them forever, and should be a
deliberate decision.

### Permissions

`attendance:*` is **deliberately absent from the defaults**, exactly as
`cameras:*` is. A sweep turns a camera by remote control and writes a biometric
record of everyone in front of it, and the lists it produces say where named
people were and when. An administrator grants it per account — which also means
there is nothing in `permissionBackfill.js` to hand out.

Moving a camera needs `cameras:edit` rather than `cameras:view`: it is not a way
of looking at a camera, it changes where the camera points for everybody
watching it, and it can be used to point one away from whatever it was installed
to watch.

### Setting a camera up

1. **Cameras -> Edit -> PTZ and automatic attendance**.
2. Enter the ONVIF service address — usually
   `http://camera-address/onvif/device_service`. This is the control channel,
   not the video stream.
3. Enter the PTZ username and password, and **Save**.
4. Reopen the camera and press **Detect**. Probing asks the *server* to contact
   the camera, so it needs a saved camera to hang the request on; a camera being
   created has no id yet.
5. Pick a movable profile, check the optics, and enable PTZ.

| Variable | Default | What it does |
| --- | --- | --- |
| `FACE_MATCH_MAX` | `0.5` | distance below which two descriptors are the same person |
| `FACE_MATCH_MARGIN` | `0.05` | how much closer the best match must be than the runner-up |
| `FACE_SAME_SIGHTING` | `0.38` | distance at which two detections in one frame are one face |
| `VISITOR_FACE_RETENTION_DAYS` | `30` | how long an unidentified face is kept |

### Limitations

- **ONVIF only.** Vendor CGI APIs (Hikvision ISAPI, Dahua, Axis VAPIX) are not
  implemented. The driver sits behind one interface in `helpers/ptz/index.js`,
  so adding one is a new module rather than a change to the sweep.
- **A still image source is required.** The ONVIF snapshot URI is used when the
  camera offers one, an MJPEG stream is read for a single frame otherwise, and
  an `rtsp://` address alone cannot be read at all — set a snapshot URL.
- **No liveness check.** A sweep recognises a photograph of a face as readily as
  a face, and nothing here detects the difference.

## Converting images to SVG

**Tools -> Converting** outputs PNG, JPG, ICO, GIF and SVG. The first four are
pixels; SVG is not, and that difference is the whole feature.

Plenty of "convert to SVG" tools hand back a PNG wrapped in an `<svg>` element.
The file has the right extension and none of the properties anyone wanted one
for: it does not scale, it cannot be recoloured, and it is bigger than what
went in. `frontend/src/lib/imageTrace.js` traces outlines instead:

1. reduce the image to a small palette (gifenc, already vendored for GIF),
2. for each colour, walk the boundary between its pixels and everything else,
   which gives closed polygons on the pixel grid,
3. drop the points that do not change the shape (Ramer-Douglas-Peucker),
4. emit one `<path>` per colour.

Two controls: **Colours** (2-32) and **Detail** (0-100, the simplification
tolerance inverted). The result is previewed beside the source, because those
two settings have no right value in the abstract — only for the picture in
front of you, and tuning them by downloading each attempt is not tuning them.

**It suits flat artwork and not photographs.** Tracing follows areas of one
colour, so logos, icons, screenshots and line art come out well. A photograph
has no flat areas; it traces into thousands of blotches, larger than the file
it came from and worse to look at. The panel says so before the conversion
rather than after it.

Three details that are easy to get wrong:

- **The winding does the holes.** Each pixel contributes the sides facing a
  different colour, wound clockwise, so chaining them gives outer boundaries
  clockwise and holes anticlockwise — which is exactly what `fill-rule="evenodd"`
  needs. The letter O comes out with a hole in it and no special case.
- **The dominant colour becomes a `<rect>`,** when nothing is transparent. It
  is the single biggest saving in the file, and it removes the hairline seams:
  neighbouring paths share an edge exactly, but each is anti-aliased
  independently, so the two halves of a boundary pixel blend to less than full
  coverage and a pale line shows through. A solid layer underneath leaves
  nothing to show through.
- **Tracing is capped at 800px** regardless of the output size. Past that,
  extra pixels stop adding shape and start adding noise along every edge: more
  points, a bigger file, no more detail. The SVG carries a `viewBox`, so the
  result still scales to whatever size was asked for.

An SVG converted *to* SVG is resized, not traced. Rasterising a drawing that is
already made of shapes and then guessing those shapes back would lose every one
of them.

## Converting audio and video

**Tools -> Converting** has Video and Audio tabs next to Image. Both run ffmpeg
on the server (`backend/src/helpers/mediaConvert.js`), from `ffmpeg-static` or
the binary in `FFMPEG_PATH`.

- **Video**: MP4, MKV, MOV, WebM, AVI or animated GIF; H.264, H.265, VP9, VP8,
  AV1 or MPEG-4; constant quality (CRF) or a target bitrate; encoding speed;
  resolution (presets or custom, proportions kept); frame rate; rotate and
  flip; the sound's codec, bitrate, channels, sample rate and volume, or no
  sound; trim.
- **Audio**: MP3, M4A (AAC), OGG (Vorbis), Opus, WAV (16/24-bit, 32-bit float)
  or FLAC; bitrate, bit depth, FLAC compression level, sample rate, channels,
  volume, loudness normalisation (EBU R128), fade in/out, trim. A video file
  works as the source: its sound is extracted.

Only codecs the installed ffmpeg can encode are offered — `GET
/tools/convert/capabilities` reads `ffmpeg -encoders`.

A conversion is a job, not one long request. `POST /tools/convert/jobs` stores
the upload and answers at once; ffmpeg runs with `-progress pipe:1`, and the
page polls `GET /tools/convert/jobs` every second to show upload → queue →
convert → done with the percentage, speed, fps, size so far and time left.
At most `CONVERT_MAX_JOBS` run at once and the rest wait in line. A job can be
cancelled (ffmpeg is killed). The finished file is played in the page and
downloaded from `/tools/convert/files/<token>`, which needs no Authorization
header so a `<video>` element can use it; the token is 48 random hex
characters given only to the job's owner, and the file is deleted after
`CONVERT_KEEP_MINUTES`. Jobs are kept in memory: a restart forgets them and
clears the temp folder.

Every ffmpeg argument is built from whitelisted choices and clamped numbers
and passed to `spawn` without a shell.

## TTS speech datasets

**Tools -> AI -> TTS** transcribes a folder of speech into a training dataset.
Same arrangement as the YOLO labelling tab: the folder is read where it already
is, nothing is uploaded, and the transcripts — which are small — are mirrored
into `localStorage` and matched back by file name when the folder is reopened.

**Only 16 kHz mono PCM WAV is accepted**, and the folder is checked rather than
trusted: a corpus whose clips disagree about sample rate or channel count
trains badly and says nothing about why. `frontend/src/lib/wavInspect.js` walks
the RIFF chunks and stops at `data`, so the check is one 64 KB read per file
however large the file is — decoding each one to find out would mean pulling an
entire dataset through the browser's audio decoder to learn something the first
few dozen bytes already state.

Anything rejected is listed with its reason — "44100 Hz; 16000 Hz is required",
"Stereo; mono is required" — and never silently dropped. The reason is the
useful part: it says what to run over the folder, where a bare rejection sends
somebody through it one file at a time.

Two header details that are easy to get wrong, and both produce a wrongly
rejected folder rather than an obvious failure:

- **`WAVE_FORMAT_EXTENSIBLE` (0xFFFE) is a container**, not a format. The
  format that matters is the first two bytes of the SubFormat GUID, 24 bytes
  into the `fmt ` chunk. Read naively, ordinary 16-bit PCM from several common
  recorders reads as "compressed" and the whole folder is refused.
- **RIFF chunks are word-aligned.** An odd-length chunk is followed by a pad
  byte the declared size does not count, and walking without it lands
  one byte off and finds no `data` chunk at all. Real files hit this: a `LIST`
  chunk holding an odd-length title is the usual way.

A streaming writer that never went back to fix its header leaves the data size
at 0 or 0xFFFFFFFF. The duration then comes from the bytes actually on disk,
and the clip is tagged as estimated rather than reported as 0:00 or 13 hours.

### What comes out

Two files, because the same clips and transcripts feed two ecosystems that read
different ones:

| File | Format | Read by |
| --- | --- | --- |
| `metadata.csv` | `id\|transcript\|normalised`, pipe separated | LJSpeech-style TTS training scripts |
| `manifest.jsonl` | One JSON object per line: `audio_filepath`, `duration`, `text` | Speech-recognition toolkits |

The duration in the manifest is why the WAV header is parsed at all rather than
the format merely being validated.

Only clips that have a transcript are written. An untranscribed clip is work
not yet done, and including it with an empty string teaches a model to answer
silence — a corpus is better short than quietly wrong. A transcript containing
a pipe or a newline is flattened, since either would split a record into
columns or rows that were never meant to exist; the substitution is preferred
to rejecting somebody's typing over its punctuation.

### Working through a folder

The middle column plays the current clip and takes its transcript; the right
column is the text history — every clip, its length, and what has been typed so
far, with a tick against the ones that are done. It follows the clip being
worked on rather than sitting on page one, and any entry can be clicked to jump
to it.

Typing is committed on a short delay rather than on each keystroke: writing
every character into the clip list re-renders the history beside it, and at a
few thousand clips that is felt in the typing. Anything that reads the dataset
sees the draft, not the last commit, so an export never misses the sentence
being typed when the button was pressed.

Ctrl+Enter moves to the next clip — the one shortcut that works while typing,
because it is the one needed while typing. With the text box unfocused, Space
plays and the arrow keys move.

## YOLO labelling

The Labelling tab on the YOLO page turns a folder of images into a YOLO
dataset. It runs entirely in the browser: the images are read from a folder you
pick and are never uploaded, which is the only sane arrangement when a dataset
is routinely thousands of files and many gigabytes.

Two tasks, matching the two models asked for:

| Task | Shape | Label line |
| --- | --- | --- |
| Detection — YOLO26n | Rectangle, dragged | `class cx cy w h` |
| Segmentation — YOLO26-seg | Polygon, clicked point by point | `class x1 y1 x2 y2 …` |

**Pose (`YOLO26n-pos`) and its line/keypoint shape are not implemented.** The
brief listed lines alongside the other two and then said only YOLO26n and
YOLO26-seg are supported, so the shape that belongs solely to the third model
was left out rather than half-built.

Drawing: drag for a rectangle; for a polygon, click each point and close it by
clicking the first point again or pressing Enter, with Backspace undoing a
point. Click a shape to select it, drag it to move it, drag a corner of a box
to resize it, Delete to remove it. Arrow keys move between images and the
number keys pick a class. Per-vertex editing of an existing polygon is the one
obvious omission — a polygon is moved or redrawn, not reshaped.

Every coordinate is stored normalised to the image (0..1), never in pixels. The
canvas is whatever size the window allows and the same image may be labelled at
two different zooms in one session, so a pixel value would depend on the
monitor it was drawn on. It is also what both YOLO formats want, which makes
the export a formatting step rather than a conversion.

### What comes out

`dataset.csv` is the complete record — one row per shape, both shape kinds
written exactly as drawn whatever the task is selected:

```
image,image_width,image_height,class_id,class_name,shape,points
bus.jpg,810,1080,0,person,box,0.481481 0.508333 0.187654 0.201852
bus.jpg,810,1080,1,bus,polygon,0.1 0.2 0.3 0.4 0.5 0.6
empty.jpg,640,480,,,none,
```

An image you opened and deliberately left empty gets a `none` row. That is not
padding: an empty image is a legitimate background sample, and the row is the
only thing distinguishing it from an image nobody has reached yet.

The second button writes `labels/<image>.txt` plus `data.yaml` as a `.zip`,
which is the layout Ultralytics trains from. The images are deliberately not in
the archive — they are already in a folder on your machine, and copying them
through the browser to hand them straight back is not a service. `data.yaml`
points `train` and `val` at the same folder and says so in a comment; split
them before training or the numbers will flatter you.

A shape that does not match the chosen task is converted rather than dropped: a
polygon exported for detection becomes its bounding box, and a box exported for
segmentation becomes its four corners. Silently losing labels at export is the
worst thing a labelling tool can do.

### Two things worth knowing

**Labels survive a reload, images do not.** The labels are mirrored into
`localStorage` and matched back by path when you reopen the same folder. A
browser cannot hold a directory handle across a reload without the File System
Access API, so you do have to pick the folder again.

**The path inside the folder is the identity, not the file name.** A dataset
split into `train/` and `val/` subfolders very often holds the same file name
in both, and keying on the name alone would merge their labels and then write
two entries to the same path in the archive.

The zip is assembled by `frontend/src/lib/zipWriter.js`, a stored-only
(uncompressed) ZIP writer — there is no zip dependency in this project and
label files are a few hundred bytes of digits each, so a deflate
implementation would be carried for nothing. Every unzip tool reads method 0.

## LVGL converters

**Tools -> LVGL** turns fonts and images into LVGL-ready C source and downloads
the `.c` file. The two halves run in different places, for different reasons.

### Font converter (server side)

`POST /api/tools/lvgl/font` (multipart) runs the real
[lv_font_conv](https://github.com/lvgl/lv_font_conv) — the same library behind
[lvgl.io/tools/fontconverter](https://lvgl.io/tools/fontconverter) — and returns
the generated C source as JSON, which the page saves as a file.

It runs on the API rather than in the browser because the package is CommonJS
built around a FreeType WASM build and Node Buffers. Bundling it for the browser
is what the upstream project's own webpack build exists to do, and reproducing
that here would add a build step for one page.

Fields map onto the CLI flags: `size`, `bpp` (1/2/3/4/8), `range`
(`0x20-0x7F`, `32-127`, `0x1F450=>0xF005`), `symbols`, plus `--no-compress`,
`--no-kerning` and `--lcd`. Either a range or a symbol list is required, exactly
as upstream requires.

### Image converter (client side)

Targets **LVGL v9 only**.

`frontend/src/lib/lvglImage.js` is a port of `scripts/LVGLImage.py` from the
lvgl repository, which is the official converter for v9 and what
[lvgl.io/tools/imageconverter](https://lvgl.io/tools/imageconverter) runs. The
pixel packing, the ordered RGB565 dither, the background pre-multiply and the
emitted C text all follow it.

It is ported rather than imported because LVGLImage.py is Python, and because
a browser already has a canvas to decode with.

> The older [lv_img_conv](https://github.com/lvgl/lv_img_conv) project is **v8**
> and is deliberately not used. It emits `lv_img_dsc_t` with `LV_IMG_CF_*`
> constants, a `header.always_zero` field, and the pixel data repeated four
> times behind `#if LV_COLOR_DEPTH` guards. None of that compiles against v9.

v9 output declares `lv_image_dsc_t` with an explicit `LV_COLOR_FORMAT_*`, a
stride, and a single copy of the data:

```c
const lv_image_dsc_t my_image = {
  .header = {
    .magic = LV_IMAGE_HEADER_MAGIC,
    .cf = LV_COLOR_FORMAT_RGB565A8,
    ...
```

Supported colour formats:

| Group | Formats |
| --- | --- |
| True colour | `ARGB8888`, `XRGB8888`, `RGB888`, `RGB565`, `RGB565_SWAPPED`, `RGB565A8`, `ARGB8565` |
| Greyscale | `L8`, `AL88` |
| Alpha only | `A1`, `A2`, `A4`, `A8` |
| Indexed | `I1`, `I2`, `I4`, `I8` |

Formats with no alpha channel (`XRGB8888`, `RGB888`, `RGB565`,
`RGB565_SWAPPED`, `L8`) blend onto a chosen background colour, using upstream's
`(c * a + (255 - a) * bg) >> 8` rather than a divide by 255, so output matches
byte for byte. Ordered dithering is offered for the RGB565 family, using the
same 8×8 threshold tables.

One deliberate difference: LVGLImage.py only accepts an already-palettised PNG
for `I1`/`I2`/`I4`/`I8`. A browser tool gets handed arbitrary images, so the
palette is built here with gifenc (MIT, vendored at `public/gifenc`, imported
lazily). The emitted bytes still follow the v9 layout — a padded palette of
little-endian `(a<<24)|(r<<16)|(g<<8)|b` entries, then row-aligned indices.

Not implemented: `RAW`/`RAW_ALPHA` passthrough, RLE and LZ4 compression
(`LV_IMAGE_FLAGS_COMPRESSED`), premultiplied alpha, and custom stride
alignment. `.flags` is always `0`.

**Vector input.** An SVG is not decoded once and then scaled: it is re-rendered
from the markup at whatever output size is asked for, so a 32×32 icon and a
128×128 one are each drawn at their own resolution. The size is read from the
markup too — from `width`/`height` when those are absolute, and from the
`viewBox` otherwise, which is the case a browser declines to measure and
reports as nothing at all. The figures shown for a vector are therefore a
starting point rather than a limit.

The one thing that does not work is an SVG that pulls a picture in from another
site. That taints the canvas and the pixels cannot be read back at all, so the
converter says so rather than emitting an empty array.

**Why the output card says "LVGL v9".** It used to be labelled "Generated
lv_img_conv output", which named the v8 tool this deliberately does not use —
the file underneath was always v9, but anyone reading the heading had every
reason to believe otherwise.

### Font converter and LVGL v9

`lv_font_conv` output is version-guarded rather than v8-only: the generated C
carries `#if LVGL_VERSION_MAJOR >= 9` around the fields that moved, emits
`.fallback` for v8.2+/v9, and confines the `.cache` member to v8. The same file
compiles on both, so no v9-specific handling is needed on the font side.
