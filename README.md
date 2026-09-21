# Knowledge Store

A full-stack starter app with:
- React + Vite + Ant Design frontend
- Node.js 20 + Express backend
- Login / registration
- User management
- Data manager API and UI

## Quick start

1. Install dependencies:
   - `npm install --prefix backend`
   - `npm install --prefix frontend`
2. Start backend:
   - `npm --prefix backend run dev`
3. Start frontend:
   - `npm --prefix frontend run dev`
4. Open:
   - Frontend: http://localhost:5173
   - API: http://localhost:4000/api/health

## Default admin login

- Username: `admin`
- Password: `admin123`

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
| [System Design Document](docs/system-design.md) | Architecture, data model, authorisation, the workflow/currency/retention mechanisms, API surface |
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

### The message icon in the header

`GET /chat/recent?limit=5` returns the newest messages addressed to you and
the unread total in one response, because the header polls it every 15 seconds
and a second round trip for the badge would double that for nothing. It
replaced `GET /chat/unread`, which only ever served the badge.

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

### Font converter and LVGL v9

`lv_font_conv` output is version-guarded rather than v8-only: the generated C
carries `#if LVGL_VERSION_MAJOR >= 9` around the fields that moved, emits
`.fallback` for v8.2+/v9, and confines the `.cache` member to v8. The same file
compiles on both, so no v9-specific handling is needed on the font side.
