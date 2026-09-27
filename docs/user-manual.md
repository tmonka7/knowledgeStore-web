# Knowledge Store — User Manual

Version 1.0 · 21 September 2026

## 1. Before you start

You need the address of your Knowledge Store installation and a browser
(Chrome, Edge, Firefox or Safari). To sign in by face or by voice you need a
**webcam** and a **microphone**: faces and voices are taken live, never from a
photo or a recording file.

## 2. Creating your account

1. Open the application and choose **Register**.
2. Fill in your full name, a username, your email address and a password of at
   least 6 characters, then repeat the password.
3. Fill in as much of the personal section as you wish — **gender, birthday,
   phone number, job and address**. All of it is optional, and you can add or
   change it later on My Page.
4. Capture a face photo with your webcam if you want one (a photo file cannot
   be used). This step is **optional**.
   A face is a second way to sign in, not an extra check on top of your
   password, so an account without one works exactly the same — it just signs
   in with the password. If you skip it and change your mind, an administrator
   adds it for you on the Users page.
5. Record your voice if you want to sign in by speaking — also **optional**.
   Under **Voice sign-in**, press **Record** and read the sentence shown in your
   normal voice; it stops by itself. Do this three times (a new sentence each
   time). Use the microphone you will sign in with, in a quiet room. You can
   play each clip back and delete one to record it again. Record all three or
   none: with only one or two, registering asks you to finish or delete them.
   (This section appears only when the server has the speaker model.)
6. Choose **Register**.

**You are not signed in yet.** A new account is created with the status
*Pending* and waits for an administrator to approve it. Until then, signing in
is refused with a message saying so. Once an administrator allows it, you can
sign in with no further steps — nothing is sent to you, so if you are waiting a
while, ask them.

New accounts are ordinary user accounts. Only an administrator can make an
account an administrator.

## 3. Signing in

There are three ways in, and you only need **one** of them.

**Username and password.** Type them and choose **Sign in**.

**Your face.** Choose **Login with Face** and look at the camera. You do not
need to type a username first — the system works out who you are from your
face. If it cannot tell for certain, it refuses rather than guessing, and you
can always fall back to your password.

**Your voice.** Choose **Login with Voice**, press **Record** and read the
sentence shown; it stops by itself after a few seconds. As with the face, no
username is needed, and a voice it cannot place with confidence is refused.
This needs a voice enrolled at registration (or by an administrator). After
ten attempts in ten minutes it asks you to wait. A recording of your voice may
be enough to sign in as you, so treat voice sign-in as a convenience rather
than strong security.

Sessions last 8 hours. After that you are asked to sign in again.

If an administrator denies or deletes your account while you are using the
application, you are signed out at once and told which it was.

## 4. Finding your way around

The sidebar on the left lists the pages you are allowed to use. If a page you
expect is missing, your account does not have permission for it — ask an
administrator.

Your own area, **My Page**, is not in the sidebar: click your avatar in the
top right corner and choose it from the menu.

Most pages follow the same shape: summary cards at the top, a row of filters
below them, then the content. A **Refresh** button re-reads the page's data
whenever you want the latest.

## 5. My Page

Three tabs: **Account**, **Wallet** and **Contacts** (the last two appear only
if you have permission for them).

### Your details

The Profile panel shows your name, username, email, gender, birthday, phone,
job, address, and the date you joined.

Below it, **Personal details** lets you change your gender, birthday, phone
number, job and address. Fill them in and choose **Save details**. A birthday
must be a real date and cannot be in the future.

Your name and email address are changed by an administrator on the Users
page — ask them if one of those is wrong.

### Your face and voice

The **Face and voice** panel shows whether you can sign in with your face and
with your voice, and lets you change either:

- **Change face photo** (or **Register face**) opens the camera, as at sign-up.
  **Remove face** turns face sign-in off.
- **Record voice** (or **Record again**) asks you to read three sentences aloud.
  **Remove voice** turns voice sign-in off. The voice part appears only when the
  server has the speaker model installed.

Nothing changes until you type your **current password** and choose **Save face
and voice**; **Cancel** or **Undo** discards the draft. The password is asked
for so that someone using a computer you left signed in cannot put their own
face or voice on your account. Every change is written to the activity log.

### Your password

The **User settings** panel changes your password: type your current password,
then the new one twice, and choose Update password.

## 6. Wallet

Your wallet is private. Nobody else can see it, administrators included.

### Recording income and expenses

1. Choose **Add entry**.
2. Pick **Income** or **Expense**.
3. Enter the amount, and choose the **currency**: **USD** or **REM**. The
   currency belongs to that one entry — you can keep both in the same wallet.
4. Pick the date and a category (type your own if the suggestions do not fit).
5. Optionally add the payment method and a note, then save.

The currency box starts on whichever you used last, so a run of entries in one
currency is quick to enter.

### Reading the statistics

Everything is shown **once per currency, side by side**: one row of cards for
USD and one for REM, and each chart is drawn twice, labelled with its currency
code.

USD and REM are never added together and never converted — the system does not
know a rate between them, and inventing one would give you a number you could
not act on. A currency you have not used yet simply reads zero.

The filters above the charts — date range, type, category and the number of
months — apply to everything on the page at once, including the entries table
at the bottom.

### Changing an entry

Use the pencil on its row to edit it, including its currency, or the red bin
to delete it. Deleting asks for confirmation first.

## 6a. Sharing what you save in Data

When you add or edit a record, the last thing in the dialog asks who it is
for:

- **Everyone** — anyone who can open the Data page can read it. This is the
  default, and what you get if you never touch the control.
- **Selected people** — only the people you choose. Start typing a name and
  pick from the list; choose as many as you like.

Choosing **Selected people** and picking nobody keeps the record to yourself.
The dialog says so underneath, so you are never left guessing.

Sharing lets people **read** your record. Only you (and an administrator) can
change or delete it — on someone else's record you will see the preview
button and nothing else.

To check who can see something, open it: the tag beside the category says
*Shared with everyone*, *Shared with…* and the names, or *Private to you*. To
change it, edit the record and pick again.

> Records that already existed before sharing was added are readable by
> everyone, because that is the default. If one of your older records should
> not be, edit it and choose **Selected people**.

## 6b. Your connection status

The dot on your picture at the top right is your connection status, as others
see it beside your name in Chat and on the Users page:

| Dot | Status | Meaning |
|---|---|---|
| green | **Online** | You have the application open. |
| amber | **Away** | The application is open, but its tab is hidden or you have not touched it for five minutes. |
| red | **Busy** | You chose Busy. |
| grey | **Offline** | You are signed out or the application is closed — with when you were last seen. |

Open the menu under your name and choose the first item to change it:
**Online (automatic)** follows what you are doing, as above; **Busy** and
**Away** show that whatever you are doing; **Appear offline** shows you as
Offline, without a last-seen time, while you carry on working (administrators
can still see that you are connected). The choice is remembered for your next
sign-in.

## 7. Chat

Chat is for direct messages between two people on this installation. A
conversation is private to the two of you; administrators cannot read it.
Each person's picture carries their connection status (see 6b), and the
conversation's header says it in words.

### Starting a conversation

Type at least two letters of someone's name, username or email into the search
box on the left. Matching people appear under **People** — click one and the
conversation opens. If you already have a conversation with them, the same one
opens again; you never end up with two.

### Sending messages

Type in the box at the bottom and press Enter, or use **Send**. Shift+Enter
starts a new line instead of sending.

New messages arrive on their own within a few seconds — there is nothing to
refresh. A single tick on your own message means sent; two ticks mean the
other person has read it.

The number beside **Chat** in the sidebar is how many unread messages you
have. Opening a conversation clears its share of it.

### The mail and message icons in the header

The envelope and the speech bubble at the top right work the same way. Each
carries its own unread count from wherever you are, and opens a list of the
five newest things waiting for you — new mail, or new chat messages. Click any
row to go straight to it: the message opens in Mail (switching to your Inbox
if you were looking at Sent), the conversation opens in Chat. "Open Mail" and
"Open Chat" at the bottom take you to the page without choosing one.

### The message icon in the header

The speech-bubble icon at the top right carries the same unread count from
wherever you are in the application. Click it for your five newest messages —
who wrote it, the first line, and when — with a dot beside the ones you have
not read yet.

Click any of them to go straight to Chat with **that** conversation open.
"Open Chat" at the bottom takes you to the page without choosing one.

### Sending a file

1. Open the conversation.
2. Click the **paper-clip** button and choose a file of up to 25 MB.
3. If you had already typed something, it is sent as the note on that file.

The file appears in the conversation with its name, its size and how long it
has left. Click it to download.

> **Files are deleted one week after they are sent.** This is automatic and
> cannot be extended. When it happens the message stays where it was, and the
> file name is shown with **(deleted)** after it, so the conversation still
> records that a file was sent — but it can no longer be downloaded. If you
> need a file permanently, save your own copy, or attach it to a record or a
> task instead.

## 8. Projects and bugs

**Project Management** lists projects as cards showing status, progress and
how many tasks are open, in progress, waiting to be verified, and reopened.
The three buttons on a card are edit, delete and open.

Opening a project gives you a board with one column per status. Drag a card to
move it, or open it to see everything about it.

The lifecycle is deliberate:

```
Open → In progress → Resolved → Verified → Closed
                        └──→ Reopened ──┘
```

A **resolved** task cannot be closed directly. Someone has to **verify** it,
or send it back by **reopening** it. Columns a card is not allowed to move to
are dimmed, and the server refuses the move even if the board is out of date.

A bug also carries steps to reproduce, the expected result, the actual result
and the environment. Everything that happens to a task — who moved it, who
commented, who attached what — is kept in its history.

## 8a. Mail

Mail goes to people on this installation — you pick them from a list, not by
typing an address — and it never leaves it.

### Sending

**Compose**, then choose one or more recipients, a subject, write the message,
and attach one file if you need to (up to 10 MB). **Send**.

### Reading

**Inbox** is what was sent to you; the number beside it is how many you have
not read. Unread messages are in bold with a dot. Click one to read it, which
marks it read. **Reply** answers the sender with the original quoted below.

### Knowing whether it was read

Open a message in **Sent**. Under it you will see *Opened by 2 of 3*, and a
line for each person: either the date and time they opened it, or *Not opened
yet*. The Sent list shows the same summary as a small chip on each row.

The time is recorded when the message is first opened and never changes after
that, so what you see is when they actually read it.

### Deleting

**Delete** removes the message from *your* mailbox. Everyone else keeps their
copy — deleting from your inbox does not unsend anything.

## 8b. Posts

**Posts** are announcements. Anyone can read them; writing them is an
administrator's job.

### Reading

New posts you have not opened show up in two places: the number beside
**Posts** in the sidebar, and the bell at the top right, which lists the five
newest under "*n* new post(s)". Click one there and it opens straight away.

Opening a post is what clears it — the count falls by one as you read.

### Who has read what

The post list has a **Read by** column showing how many people have opened
each post. Click that number to see exactly who, with the time each of them
opened it. The same button is at the bottom of an open post.

### Writing one (administrators)

**New post**, then a title and the content. **Pin to the top** keeps it above
the others for everyone. Posts can be edited and deleted later; deleting one
also deletes its record of who read it.

## 8c. Meetings

Video calls with other people in this workspace. The picture and sound travel
straight between the browsers taking part — they do not pass through the
server — which keeps them quick, and means a call works best with a handful of
people rather than a crowd.

### Before your first call

Your browser will only hand over a camera and a microphone on a page served
over **HTTPS**, or on **localhost**. If you reach this application by typing an
address like `http://192.168.1.20:6173`, the browser blocks camera access
entirely, and there is nothing the application can do about it. The Meetings
page tells you so at the top when that is the case; you can still join to watch
and listen.

The first time you join, the browser asks for permission. If you refuse, or you
have no camera, you join anyway — you will see and hear everyone, and they will
see your initials in place of your picture.

### Setting one up

Press **New meeting** and give it a title. Everything else is optional:

- **Starts** — the time it is meant to begin. Leave it empty and you get a room
  that anyone can open whenever it is needed.
- **Open to everyone** — on by default. Turn it off and choose the people who
  may join; nobody else will even see the meeting in their list. You can always
  join your own.

### Joining

Press **Join** on any meeting that has not ended. Meetings with somebody in
them are outlined in green, badged **Live**, and list who is already in the
call — so you can see whether the person you are waiting for has arrived.

### While you are in the call

Along the bottom:

| Button | What it does |
|---|---|
| Microphone | Mutes and unmutes you. Everyone else sees a microphone icon on your tile while you are muted. |
| Camera | Turns your picture off and on. Your tile shows your initials instead. |
| Screen | Shares a window or a screen in place of your camera. Press it again, or use your browser's own "Stop sharing" bar, to go back to the camera. |
| Record | Starts and stops recording. |
| Messages | Opens the side panel for typing to everyone in the call. |
| Leave | Leaves. |

A button turns amber when that thing is **off**, blue when it is active, and
red while a recording is running, so a glance at the bar tells you the state.

Messages sent in the panel stay with the meeting, so somebody who joins late
can read what has already been said. While the panel is closed, the button
carries a count of what you have not seen.

### Recording

Press **Record**. What is captured is the meeting as you are seeing and hearing
it — every tile, with names, and everyone's voice — and it saves to the meeting
when you stop. A timer runs in the header while it records.

**Everyone in the call is told.** A warning appears across the top of their
screen and a red REC badge appears on your tile, for as long as you are
recording. This is not something you can turn off separately.

A few things worth knowing:

- The recording is made by your browser, so it stops if you close the tab, and
  leaving the call asks you first and saves what you have.
- Minimising the window makes your browser slow the recording down and drop
  frames. Leave it visible.
- Recordings can be large. A long call can run to hundreds of megabytes.

Afterwards, the meeting's card shows how many recordings it has; click that to
open, download or delete them. You can delete a recording you made; the host
and administrators can delete any of them.

### Ending and deleting

The host — and any administrator — can **End** a meeting. Anyone still in the
call is disconnected and told it has ended. The recordings, the messages and
the record of who attended are all kept.

**Delete** removes the meeting and its recordings for good.

Clicking the attendance count on a card shows everyone who joined, when they
arrived and when they left. Leaving and coming back shows as two visits.

## 8d. Transformers: translation datasets

**Tools → AI → Transformers** builds parallel-text datasets for training or
evaluating translation models.

- **New dataset**, give it a name, and list its languages. The first language
  is the source and the rest are targets. Codes such as `en`, `pt-BR` or
  `eng_Latn` are accepted.
- Pairs are edited in two large boxes side by side, one language each,
  lined up like an OCR correction screen: **line N on the left and line N on
  the right are one pair**. Paste a whole column of sentences into each box,
  or type them line by line.
  - Putting the cursor on a line, or selecting several, highlights the same
    lines in both boxes, and the two boxes scroll together.
  - **Tab** jumps to the same line in the other box and selects it, adding
    empty lines to that box if it is shorter.
  - A line that is empty on one side but filled on the other is tinted
    yellow, and its line number is too.
  - Lines never wrap, so that line N stays level on both sides; long ones
    scroll sideways. Inserting or deleting a line on one side only shifts
    every pair below it, so fix alignment by adding or removing the matching
    line on the other side.
  - **Find** jumps to the next line containing some text. **Ctrl+S** saves.
  - With more than two languages, the selectors above the boxes choose which
    two are shown, and ⇄ swaps them.
- **Import** takes CSV, TSV or JSONL, pasted or from a file. A header row of
  language codes says which column is which.
- **Save** stores the dataset under your account; nobody else sees it.
  **Export** downloads it as JSONL in the Hugging Face translation layout
  (`{"translation": {"en": ..., "es": ...}}`), or as CSV or TSV.

### Training a model (offline)

With the **Train** permission on Transformers, save the dataset and press
**Train**. In the training panel, choose the source and target language and
the model to start from. That is normally the Opus-MT model for the same pair,
or one you trained earlier. Then press **Train** again.

Training runs on the server and needs no internet connection. The panel shows
the progress, the loss after each epoch, and a few held-back sentences
translated before and after training. **Cancel** stops the run and discards
it. The finished model appears in the list below, where you can:

- **Test** it by translating a few sentences, in the **Test a model** section
  under the panel (the row's Test button picks the model there and scrolls to
  it; you can also pick any model from its list). A fine-tuned model is
  compared with the model it was trained from: each line's two translations
  appear side by side, so you can see what training changed. **Compare with**
  picks another model to compare with, or none.
- **Export ONNX**, then download the zip. It holds `encoder_model.onnx`,
  `decoder_model.onnx` (and, when the server has Optimum installed, the faster
  decoder variants), the tokenizer and a README showing how to load it.
- Delete it.

Only one training or export job runs on the server at a time. On a CPU, a few
hundred pairs for three epochs takes minutes, and tens of thousands take
hours.

### Running Python against a dataset

With the **Execute** permission on Transformers, which an administrator has to
grant, the **Run Python** panel runs a script on the server. The dataset you
pick is written next to the script as `dataset.jsonl`, and the `ks_dataset`
module reads it:

```python
from ks_dataset import LANGUAGES, load, pairs, to_hf
```

`pairs("en", "es")` gives the (source, target) sentence pairs, and `to_hf()` a
Hugging Face `Dataset`. The script sees the dataset as last saved, not unsaved
edits. Output is shown when the script finishes. A script that runs past the
server's time limit (5 minutes unless changed) is stopped.

## 8d-2. Voice recognition

**Tools → AI → Speech to Text → Voice recognition** turns speech into text
with whisper.cpp on the server.

1. Choose the **Model**. `ggml-tiny` is the fastest and `ggml-base` is more
   accurate. The ones marked **English only** (`ggml-tiny.en`, `ggml-base.en`)
   are a little better at English and know no other language.
2. Choose the **Spoken language**, or leave it on **Detect automatically**.
   **Translate to English** writes the English translation instead of the
   original words.
3. Pick how to listen:
   - **Live**: press **Start speaking** and talk. Each phrase is recognised as
     soon as you pause and added to the transcript while you carry on.
   - **Record, then recognise**: everything you say until **Stop** is
     recognised in one go.
   - **Recognise a file**: an audio file (or the sound of a video) from your
     computer.

The browser asks for the microphone the first time; the page has to be opened
over https (or on the server itself) for the microphone to work.

The **Transcript** collects everything and can be edited. **Copy** it, or save
it as **.txt**, or as **.srt** subtitles with the times of each sentence.
**Recognised clips** lists each piece of audio with its text, the model and
language, how long it took, and a player to listen to it again.

If the page says no models are installed, an administrator runs, on the
server:

```
pip install pywhispercpp
python backend/python/download_models.py ggml-tiny ggml-base ggml-tiny.en
```

## 8d-3. Speaker recognition

**Tools → AI → Speaker recognition** recognises people by their voice, with
the ECAPA-TDNN model. It needs the **Speaker recognition** permission, which
an administrator grants: a voiceprint is biometric data, so no account has it
by default. The speakers you enroll are yours alone; nobody else sees them.

**Speakers.** Press **New speaker**, give a name, and record the person
talking normally for 5 to 15 seconds (reading a paragraph works well), with
the microphone — recording files are not accepted for enrolling. Add three or more samples,
ideally on different days and with the microphone you will use later; the
bar shows how much speech is enrolled, and about 20 seconds is a good start.
Each sample can be played back or deleted.

**Identify / verify.** *Identify* records (or takes a file of) someone
speaking and says who it is, with a similarity score for every enrolled
speaker. *Verify one person* checks whether a clip is the person you choose.
The **match threshold** decides how similar a voice must be to count: raise it
if strangers are being matched, lower it if enrolled people come out as
"Unknown speaker". Scores depend on the microphone and the room, so set it
with your own equipment. If the server has more than one speaker model (for
example a fine-tuned one), **Model** picks which one to test and **Compare
with** runs a second one on the same clip, the answers side by side. Samples
enrolled with another model are re-analysed from their saved audio the first
time, which takes a moment. Enrolling and the Live tab always use the first
model.

**Live.** Press **Start listening**. Each stretch of speech is identified as
soon as there is a pause, building a list of who spoke when, and the totals
show how long each person talked.

**Models.** Lists the speaker models on the server. **Export ONNX** turns one
into a single ONNX file, `ecapa.onnx`, that takes 16 kHz mono audio and
returns its 192-number voiceprint, for use outside the app with onnxruntime
in any language. The export takes about half a minute; the export's card
shows how it compares with the original on one of your voice samples (or a
test sound if you have none). Then **ONNX** downloads a zip with the model
and a README that explains the silence trimming and how to compare
voiceprints. If the server's PyTorch is too old to put the filterbank inside
the graph, the file is `ecapa_fbank.onnx` instead, and takes filterbank
features; the README says how to compute them.

Silences are ignored, so pauses in a recording do not matter; a clip with
less than a second of speech is refused. If the page says the model is not
installed, an administrator runs, on the server:

```
pip install speechbrain
python backend/python/download_models.py ecapa
```

## 8d-4. OCR (reading text in images)

**Tools → AI → OCR** reads the text in an image or a PDF with PaddleOCR
(PP-OCRv5): English, Chinese, Korean, Japanese or Russian. The model is chosen
by the language.

1. In the bar at the top, pick the **language** of the text. A language the
   server has no model for is greyed out.
2. **Choose an image or PDF**, drop one on the left side, or paste a
   screenshot with Ctrl+V anywhere on the page (PNG, JPEG, BMP, WebP or PDF,
   up to 50 MB). It is read straight away; **Read text** reads it again after
   you change a setting.
3. The bar shows the **progress** — which page is being read, and how many
   are done. Pages appear as soon as they are read, so you can start with the
   first while the rest are read. **Cancel** stops after the page in hand.

**Original** (left) is the file, with a box round each line read and dashed
boxes round the tables and figures found. A PDF has a column of page thumbnails; click one to
go to that page.

**Recognised** (right) shows what was read:

- **Layout** draws each page as the original was laid out: every line where
  it stood, at its size, in its colour, and bold where the original is bold;
  tables rebuilt as tables in their place, with the original's column widths,
  row heights and merged cells; and pictures and charts in their place, cut
  from the page.
- **Text** lists the lines, each in its colour and weight, with its size (in
  points for a PDF, in pixels for an image).

If the server lacks the layout models, a warning says so: the text is still
laid out where it stood, but tables and figures cannot be found until an
administrator installs them.

The two sides move together: scrolling one scrolls the other to the same
place on the same page, and pointing at a line, a table or a figure on either
side highlights it on both, bringing it into view on the other.

The **font** box sets the font the recognised text is drawn in. *Automatic*
picks one with the letters of the language chosen; the list also has common
Latin fonts and Chinese, Korean and Japanese ones, each shown in itself. The
font of the original is not detected — choose the closest.

**Copy** copies the text of every page, in reading order, with each table as
tab-separated rows (it pastes into a spreadsheet as a table). **Export** saves:

- **Word (.docx)** — a Word page for each page, of the original's size, with
  its paragraphs in reading order (two columns are read one after the other)
  at their size, weight, colour, indent and spacing; its tables as Word tables
  with their column widths, row heights and merged cells; and its pictures at
  their size. Everything can be edited. The font is the one chosen.
- **Excel (.xlsx)** — a sheet for each page: each table in cells, merged
  cells kept, numbers and percentages as numbers you can calculate with
  (1,200 is 1200, 30% is 0.3), and the text between the tables a paragraph a
  row. Pictures are not carried over; a note marks where each was.
- **Web page (.html)** — the pages exactly as the Layout view draws them.
- **Plain text (.txt)**.

**Keep layout** finds the titles, tables and figures; it adds about two
seconds a page. Turn it off to read only the lines, which is fastest (about
two seconds for a full A4 page, less for a sparse one). **Rotated text** also reads lines
that are upside down. Lines the model could not really read (specks and stray
marks) are left out. Photos from a phone are turned the way the phone shows
them.

**PDFs** are read page by page, and only the first 30 pages (the
administrator can change this with `OCR_MAX_PAGES`). Every page is read in the
one language chosen, so a PDF that mixes languages page by page is best read
once per language. A password-protected PDF cannot be read. The first file
after the server starts OCR can take a minute or more while the models load.

The file is read on the server and deleted when it has been read (or the
reading is cancelled); nothing is kept. If the page says the OCR models are
not installed, an administrator runs, on the server:

```
pip install paddlepaddle paddleocr
python backend/python/download_models.py paddleocr
```

The same command also fetches faster (ONNX) copies of the models; with them,
reading is several times faster, with the same result. Running it again on a
server that already has the models adds just those copies.

## 8d-5. Text to Speech (reading text aloud)

**Tools > AI > Text to Speech** reads text aloud with Supertonic 3, a speech
model that runs on the server. Type or paste the text, or **Open text file**
(.txt), choose the **Language of the text** and a **Voice** (five female and
five male), and press **Read aloud** (or Ctrl+Enter).

Long text is read a part at a time: the first words play within a second or
two while the rest is being made, and the page shows how many parts are
ready. **Stop** stops both the reading and the playback; what was made so far
is kept.

**Speed** makes the voice faster or slower. **Quality** trades time for
clarity: *Fast* takes about half the time of *Standard*, *Best* about twice.

Each reading is kept below the text, in the order made (the last ten), to play
again or **Save as WAV** (44.1 kHz). They are kept only in the browser: they
are gone when the page is closed. Nothing is kept on the server.

Supertonic reads 31 languages: English, Korean, Japanese, Arabic, Bulgarian,
Czech, Danish, German, Greek, Spanish, Estonian, Finnish, French, Hindi,
Croatian, Hungarian, Indonesian, Italian, Lithuanian, Latvian, Dutch, Polish,
Portuguese, Romanian, Russian, Slovak, Slovenian, Swedish, Turkish, Ukrainian
and Vietnamese. It does not read Chinese. Choose the language the text is
written in: text read as another language sounds wrong. Characters the voice
cannot say (another script, symbols, emoji) are left out, and the page says
which.

If the page says no model is installed, an administrator runs, on the server:

```
pip install onnxruntime
python backend/python/download_models.py supertonic-3
```

### Recording a voice dataset

A voice is trained from recordings of one person reading sentences aloud. The
**Datasets** tab records them. Anyone who can open Text to Speech can use it,
and datasets are private to whoever made them.

1. Choose **New dataset**. Give it a name and the speaker's name, and choose
   the language. The **Script** is filled with built-in sentences for English,
   조선어, 日本語, Español, Deutsch, Français and Русский. Edit them, or paste
   your own, one sentence per line (for other languages you must paste your
   own).
2. Choose **Create and start recording**. The dataset opens on line 1: press
   **Record**, read the sentence at your usual pace, and press **Stop** (it
   stops by itself after 30 seconds). The recording is saved on the server at
   once, and the next unrecorded line comes up. **Choose a recording** uses an
   audio file instead of the microphone.
3. Click any line in the list to listen to it, **Record again**, **Delete
   recording**, change its text, or **Remove this line**. **Add line** and
   **Edit script** add or change sentences. Editing keeps the recordings of
   lines whose text you did not change, and warns before deleting the others.

The bar shows how many lines are recorded and how much speech there is. Three
minutes or more gives a good likeness; training works with less. A line whose
recording looks too short (cut off) or too long (long pauses) for its sentence
is marked in yellow. Record in a quiet room, with the same microphone
throughout.

### Training a voice

The **Train voice** tab (it needs the *Text to Speech: train* permission,
which an administrator grants) makes a new voice that sounds like a real
person, from recordings of them. The Supertonic model itself cannot be
retrained, but a voice can: training starts from the built-in voice most like
the person and adjusts it until it sounds like the recordings. The new voice
then appears in the **Voice** list on Read aloud, under *Trained voices*, and
speaks every language Supertonic reads, best in the one it was trained in.

1. Record a voice dataset of **one person** on the **Datasets** tab (above).
   A Speech to Text dataset works too: on **Speech to Text > Transcribe**,
   open clips of one person, transcribe them, and save the dataset to the
   server. Half a minute of clear speech is enough to start; a few minutes is
   better. The language must be one Supertonic reads.
2. On **Train voice**, choose the dataset under **Recordings**. Voice
   datasets and Speech to Text datasets are listed separately. **Start from**
   is best left on *Most similar*. **Steps**: 300 is a good start (about 15
   minutes on a server without a GPU, a minute or two with one); more steps
   give a closer likeness.
3. Tick the box confirming the person has agreed to their voice being copied,
   and press **Train voice**. You can leave the page; the job carries on.

When it finishes, the job shows, for sentences the training never used, how
much the starting voice and the trained voice sound like the recordings
(**Likeness**, measured by the speaker model: the same person usually scores
60–90%, different people near 0%).

**Test** (the button on a trained voice, or the card below) speaks a sentence
in the trained voice and, beside it, in another voice — the one it started
from, unless you choose another — and scores each against the recordings, so
you can both hear and read the difference. Each result can be saved as WAV.

Trained voices are private to the account that trained them. Delete one with
its bin button.

## 8d-6. Speech to Command (Moonshine)

**Tools > AI > Speech to Command** recognises spoken commands — "turn on the
lights", "stop", "volume up" — with Moonshine, a small, fast speech model. It
writes down what was said and picks the command whose phrase is closest, so
"please turn on the lights" and "turn on the light" still count as *Lights
on*. It has three tabs: **Recognize**, **Commands** and **Train** (Train needs
the *Speech to Command: train* permission).

### Commands: command sets

A **command set** is a list of commands, each with the phrases that say it.
**New command set** asks for a name and a language, and can start with ten
example commands (lights on/off, open, close, start, stop, volume up/down,
yes, no) in English, 조선어, 日本語 or 中文, or with none.

Open a set to edit it. Choose a command on the left to change its name or its
phrases (one per line); **Add command** and **Remove this command** add and
remove commands. Recognising needs nothing more.

To train a model, record people saying the commands: under the command, the
phrase to say is shown in large type; press **Record**, say it, and press
**Stop** (it stops by itself after 8 seconds). The recording is saved at once
and the next phrase comes up, so each gets said. **Choose a recording** uses
an audio file instead. The count beside each command turns green at 10
recordings; several people, in the room and with the microphone the commands
will be used with, give the best results.

### Recognize

Choose a **Model** and a **Command set**. A trained model knows the commands
it was trained on (*Its own commands*); a base Moonshine model needs a set in
its language. **Strictness** is how close what was said must be to a phrase:
higher means fewer wrong commands and more *No command*.

- **Listen** hears one command after another until **Stop listening**: say a
  command, then pause.
- **Record one** takes a single command; **Choose a recording** reads a file.

Each result shows the command (green), *No command*, or *Unsure* — when what
was said is about as close to two commands (for example "lights are", between
*Lights on* and *Lights off*), it chooses neither rather than guess — with
what Moonshine heard and how long it took. The first command after the
server starts takes a second or so longer; the page starts the recogniser when
the tab opens.

### Train

Choose a command set with recordings, the Moonshine model to start from (one
for the set's language), and press **Train**. Ten epochs of a few dozen
recordings take about a minute on a server without a GPU. The job holds back
one recording of each command that has three or more, and shows how many of
those were recognised as the right command before and after, with what
Moonshine heard. **Test** (on a model, or the card below) records or reads a
command and shows the trained model's answer beside the model it came from.

Trained models are private. Delete one with its bin button.

Installing Moonshine (an administrator, once):

```
pip install -r backend/python/requirements.txt
python backend/python/download_models.py moonshine-tiny
```

`moonshine-base` is larger and more accurate. For Korean, Japanese, Chinese,
Arabic, Ukrainian and Vietnamese, add `-ko`, `-ja`, `-zh`, `-ar`, `-uk` or
`-vi` (e.g. `moonshine-tiny-ko`). The English models are MIT-licensed; the
others are under the Moonshine AI Community License — free for research,
personal use and organisations with under US$1M a year in revenue; commercial
users must register with Moonshine AI.

## 8e. YOLO and Speech to Text: training on the server

Both pages label data in the browser, as before: YOLO draws boxes or outlines
on a folder of images, and Speech to Text types a transcript for each clip in
a folder of 16 kHz mono WAV files. To train a model, the data has to be on the
server.

### Saving a dataset to the server

In the labelling or transcription view, press **Save to server**. Choose
**New dataset** (it is named after the folder) or **Update existing**, and for
speech pick the language spoken in the clips. The files are uploaded with a
progress bar. Saving the same folder again later sends only what changed —
new or edited files, and the labels or transcripts — and removes files the
folder no longer has, so the server copy mirrors your folder. Datasets are
private to your account.

For YOLO, an image counts as labelled once you have looked at it; an image
with no boxes is kept as a background example. For speech, clips without a
transcript are uploaded but not trained on.

### Training, testing and ONNX

With the **Train** permission on the page (an administrator grants it), open
the **Train** tab:

- Pick the dataset and the model to start from — for YOLO a detection or
  segmentation model matching the dataset's task, for speech a Whisper model —
  and press **Train**. The panel shows progress and each epoch's figures:
  loss, and for YOLO the mAP score; for speech, the error rate on held-back
  clips before and after training. **Cancel** stops a run and discards it.
- **Test** runs a finished model in the **Test a model** section under the
  Train panel: for YOLO on an image you choose, drawing what it finds; for
  speech on WAV files you choose, showing the transcript. Pick the model there,
  or press a row's Test button to jump to it with that model chosen. A
  fine-tuned model is run next to the model it was trained from on the same
  image or files, the two results side by side; **Compare with** picks another
  model to compare with, or none.
- **Export ONNX**, then download the zip: `model.onnx` and `classes.txt` for
  YOLO; `encoder_model.onnx`, `decoder_model.onnx` and the processor files for
  Whisper. Each export is checked against the original model on a file from
  its dataset, and the result is shown.
- **GGML** (Speech to Text only) converts the model to a whisper.cpp
  `ggml-*.bin` file. The converted model appears straight away in the
  **Voice recognition** tab's model list, named after the original with
  "(ggml)", and the row gets a **GGML** download button (and a second
  **GGML** button with a bin icon to delete the copy). Like ONNX export, it
  transcribes a clip from the model's dataset with both the original and the
  new file, and shows the two results. Converting again replaces the copy,
  and deleting a model deletes its copy too. Base models such as
  `whisper-tiny` can be converted as well; they have no dataset, so that test
  is skipped. The file is half precision (f16), like whisper.cpp's own models.

### TFLite export (phones and small devices)

Every model table on Tools > AI — YOLO, Speech to Text, Transformers, Speaker
recognition and Speech to Command — has a **TFLite** button (a phone icon)
beside **Export ONNX**. It converts the model to TensorFlow Lite (LiteRT), the
format Android, iOS and devices such as a Raspberry Pi run. It is a job like
the other exports: the panel shows it, and when it finishes the row gets a
**TFLite** download button; the phone icon exports again.

The zip holds the `.tflite` files, the tokenizer or processor files the model
needs, and a README saying exactly how to feed it:

| Model | Files | Fixed sizes |
|---|---|---|
| YOLO | `model.tflite`, `classes.txt` | The training image size, e.g. 640×640. Ultralytics' `YOLO("model.tflite")` loads it with its class names. |
| Whisper (Speech to Text) | `encoder.tflite`, `decoder.tflite` | 30 s of audio; up to 224 tokens of text |
| Translation (Transformers) | `encoder.tflite`, `decoder.tflite` | Up to 128 tokens in and out |
| Speaker recognition | `ecapa.tflite` | 3 s windows of filterbank features; average the windows of a longer clip |
| Speech to Command (Moonshine) | `encoder.tflite`, `decoder.tflite` (+ `commands.json` for a trained model) | Up to 8 s of audio |

TFLite needs fixed shapes, so shorter inputs are padded; the README says how.
The speech and translation decoders take a padded block of tokens and the
position to read, so they run in a simple loop.

Each export is checked: the TFLite model and the original run on the same
input — a file from the model's dataset when there is one — and the job shows
both results, whether they match, and for text models how many next tokens
agree step by step and how long a token takes on the server.

The files are 32-bit floating point. Smaller 16-bit or 8-bit versions are not
offered: the converter's versions of those either do not run on phones'
standard CPU kernels or give wrong answers, which the check caught on every
model tried.

TFLite export needs extra software on the server, once:

```
pip install -r backend/python/requirements-tflite.txt
```

Without it the button says so. Exporting takes from about 20 seconds (YOLO) to
two minutes (Whisper, translation) on a server without a GPU.

**Train on** chooses the device, on all three Train panels (Transformers
too): **Automatic** uses the server's first NVIDIA GPU when there is one and
the CPU otherwise; **CPU** or a listed **GPU** forces that choice. If no GPU
is listed, the reason is shown under the list — usually that PyTorch was
installed without GPU support. Asking for a GPU that is not there stops the
job straight away rather than training slowly on the CPU.

Only one training or export job runs on the server at a time, across the
Transformers, YOLO and Speech to Text pages. YOLO training uses Ultralytics,
which is licensed AGPL-3.0 — see the note on the Train tab.

## 8f. Converting audio and video

**Tools → Converting** has three tabs: Image, Video and Audio. Video and
Audio are converted on the server.

1. Choose a file. It plays in the page, and its length and size are shown.
   The Audio tab also takes a video, and keeps only its sound.
2. Set the options. Only what the server can produce is listed.
   - **Video**: format and codec; **Constant quality** (a CRF slider — lower
     is better and larger) or a **Target bitrate** in kb/s, with an estimate
     of the file size; **Encoding speed** (slower gives a smaller file at the
     same quality); resolution; frame rate; rotate and flip; and under
     **Sound**, the audio codec, bitrate, channels, sample rate and volume,
     or switch the sound off. GIFs have no sound and are made 480 px wide at
     12 fps unless you choose otherwise.
   - **Audio**: format; bitrate (MP3, M4A, OGG, Opus) or bit depth (WAV,
     FLAC); FLAC compression level; sample rate; mono or stereo; volume;
     **Normalise loudness**; fade in and fade out.
   - **Trim**: drag the range or type the start and end in seconds.
3. Press **Convert**. The conversion appears on the right and goes through
   **Upload → Queue → Convert → Done**. While it converts you see the
   percentage, the position in the file, the speed (2× means twice real
   time), the size so far and about how long is left. **Cancel** stops it.
4. When it is done, play the result in the page, then **Download** it. The
   sizes before and after are shown.

Your settings are remembered in this browser; **Reset settings** goes back to
the defaults. Converted files are deleted from the server after an hour, and
the bin button removes one straight away.

## 9. Other pages

| Page | What it does |
|---|---|
| Overview | Counts and recent activity across the installation. |
| Data | Knowledge records: create, search by text, category or date, attach files, export to Word. |
| Category | The tree that records are filed under. |
| Camera Management | Register cameras and watch them, singly or as a wall. On the wall, **Control** on a tile shows that camera's PTZ pad (pan, tilt, zoom) beside it. **Record** (on a camera's view, or in the wall's panel) records the camera on the server until you stop it, also across restarts; **Recordings** lists the footage by camera and date to play (the next part follows on by itself), download or delete. Recording needs the camera edit permission, deleting footage the delete permission. |
| Schedule | Your own calendar entries, including repeating ones. |
| Mail | Internal mail with one attachment, and the open status of everything you send. It does not leave this installation. |
| Posts | Announcements, and who has read them. |
| Meetings | Video calls with other people here, with screen sharing, in-call messages and recording. See §8c. |
| Contacts | Your own address book, on My Page. A contact can have several phone numbers, each with a label (Mobile, Work …): **Add phone number** in the contact form. |
| Tools | LVGL, Converting, YOLO and Transformers helpers. |
| Users | For administrators: accounts, roles and permissions. |
| Database Management | For administrators: backups, restores, replication and cleanup. |
| System Monitoring | Measured API latency and browser memory. |

## 10. For administrators

### Installing the translation models

Training and translation use Opus-MT models stored in
`backend/python/models` and never download anything while running. Install
them once, on a machine with internet access:

```
pip install -r backend/python/requirements.txt
python backend/python/download_models.py en-es en-zh m2m100
python backend/python/download_models.py yolo26n yolo26n-seg whisper-tiny
```

Name each Opus-MT language pair you need (about 300 MB each). `m2m100` adds
one multilingual model (about 1.9 GB) that covers any direction between 100
languages, including en→ko, which has no working Opus-MT model. The Train
panel offers it for any pair it supports. If training or ONNX export says a model is damaged, a download or a copy of
the models folder was cut short. Run
`python backend/python/download_models.py --verify --repair`, which re-downloads
only the damaged files, or copy the folder again. For a server with no internet access, copy
the `models` folder across; `backend/python/models/README.md` describes how to
move the pip packages as well. Set `PYTHON_BIN` in `backend/.env` if the
packages are installed in a virtual environment.

### Managing accounts

Open **Users**. The list holds every registered account. It is re-read each
time you open the page, and **Refresh** brings in anyone who has registered
while you were looking at it.

Click the pencil on a row to edit that account:

- **Basic Info** — face photo (taken with the camera, with the person in front
  of it; photo files are not accepted), full name, email, gender, birthday, phone
  number, address, job, and the role. You cannot remove your own
  administrator role. **Voice sign-in** shows whether the account has a voice
  enrolled: **Record voice** (or **Record again**) takes three new clips of the
  person reading, and **Remove voice** clears it; either happens when you save.
- **Permissions** — tick the pages and actions the account may use.
  Administrators bypass this list entirely, so it is shown as read-only for
  them.
  **Execute** on Transformers lets the account run Python on the server as the
  API's own OS user. It is not granted by default; give it only to people you
  would trust with a shell on that machine. **Train** (on Transformers, YOLO
  and Speech To Text) lets the account fine-tune and export models. That is safe, but it occupies the server's CPU
  or GPU for as long as training runs.
- **Logs** — recent activity for that account.

A permission change takes effect on that user's next request; they do not need
to sign out and in again.

### Approving, denying and deleting accounts

Every account is in one of three states, shown as a pill in the **Status**
column and filterable from the bar above the table:

| Status | Meaning |
|---|---|
| **Pending** | Somebody registered and nobody has decided yet. They cannot sign in. |
| **Allowed** | The account works normally. |
| **Denied** | Somebody decided no. They cannot sign in, and an open session stops working immediately. |

The **Waiting for approval** card at the top of the page counts the Pending
accounts. It is amber whenever it is not zero, because it is the one number on
this page that is a job rather than a statistic.

**Allow** and **Deny** are buttons on the row — no dialog, because approving a
morning's registrations should not mean opening five of them. Denying is not
permanent: press **Allow** to let the account back in.

**Blocking an account in use.** On an Allowed account the button is **Block**.
It asks first, and takes an optional reason, which the person is shown. If
they are connected (the dialog says so), they are signed out within seconds
wherever they are signed in, and taken out of any meeting they are in. They
cannot sign in again until the account is unblocked; when they try, they are
shown the reason. A blocked account shows **Blocked** in the Status column;
hover it to see who blocked it, when and why. **Unblock** lets it back in and
clears the reason.

**Connection.** The Connection column shows whether each person has the
application open now — **Online**, **Away**, **Busy** — or **Offline**, with
when they were last seen. Someone who chose to appear offline shows to you as
**Online (appears offline)**: as an administrator you see whether they are
really there.

Two things you cannot do, because they would leave the installation with no way
back in: deny your own account, and deny or delete the last administrator who
can still sign in. Only an administrator can approve or promote anybody, so an
installation without one cannot be repaired from inside the application.

**Deleting an account removes everything behind it.** Before it happens you are
shown exactly what that means for this particular person — how many data
records and files, how many chat conversations, how many meetings and
recordings, and so on — so read it rather than clicking through.

Destroyed outright:

- their data records and the files attached to them
- their wallet entries, contacts and schedule
- posts they wrote
- their chat conversations — **including the other person's copy**, because
  there is no half of a conversation that is not also theirs
- mail they sent, which is withdrawn from everyone who received it, and their
  own copy of mail they received
- meetings they host, together with those meetings' recordings
- their face photo

Kept, with the person removed from it:

- **projects they owned** pass to you, so the work and other people's tasks
  survive and somebody can still manage the project
- projects they were a member of simply lose them
- tasks they held become unassigned, their comments are deleted, and their
  steps in a task's history stay but are attributed to "Deleted user" — so the
  record of how a bug reached "verified" keeps all its steps

You cannot delete your own account.

### Accounts are created by registration

There is no "create user" form. Ask the person to register themselves, then set
their role and permissions here. Registering no longer obliges them to enrol a
face, so some accounts will have none; the list filters on who has one, and you
can add a photo for them from the same dialog you edit them in.

## 11. Troubleshooting

| Symptom | What to do |
|---|---|
| A page is missing from the sidebar | Your account lacks permission for it. Ask an administrator. |
| Someone who just registered is not in the Users list | Press **Refresh** on the Users page. |
| Someone is missing from a project member or assignee list | Close the dialog and open it again; the list is re-read each time it opens. |
| A chat file will not download | If its name ends in **(deleted)** it is past its week and has been removed. |
| A record you expected is not in the Data list | Its owner shared it with named people and you are not one of them. Ask them to add you. |
| A message you sent still says "Not opened yet" | They have not opened it. The time appears by itself once they do — there is nothing to refresh. |
| The Posts count will not go down | It counts posts you have not opened. Open each one; the count falls as you read. |
| Posts is missing from your sidebar, and new posts never reach you | Your account does not have permission to read posts. Accounts created before Posts existed are granted it automatically the first time the server restarts; if it is still missing, ask an administrator to grant "Posts — view". |
| A new post takes a moment to appear | The bell rechecks about once a minute, and whenever you change page. |
| No Add or Edit button on the Cameras page | Your account can watch cameras but not change them. Ask an administrator. |
| The Meetings page warns that the camera is unavailable | The browser only releases a camera on an HTTPS page or on `localhost`. On a plain `http://` network address it refuses, and no setting in this application changes that. You can still join to watch and listen. |
| You joined a meeting but nobody can see or hear you | Check the microphone and camera buttons — amber means off. If the browser asked for permission and you refused, reload the page and allow it. |
| Someone's tile stays blank and says "Connecting…" | Their camera may be off, or the two browsers could not open a direct connection. Networks that block peer-to-peer traffic need a TURN server, which an administrator has to configure. |
| A meeting shows as full | Every person sends their camera to every other person, so meetings are capped. An administrator can raise the limit, but large calls are heavy on everyone's connection. |
| Your recording is jerky or too short | A minimised or background tab is slowed down by the browser. Keep the window visible while recording, and do not close the tab — closing it stops the recording. |
| You cannot delete a recording | You can delete recordings you made. Any other one belongs to the host or an administrator. |
| You cannot edit a record you can see | It belongs to someone else. Sharing lets you read it, not change it. |
| "Invalid or expired token" | Your 8-hour session ended. Sign in again. |
| "Your account is waiting for an administrator to approve it" | Nobody has reviewed your registration yet. Nothing is sent to you when it happens, so ask an administrator. |
| "Access to this account has been denied" | An administrator refused the account. That is a decision, not a delay — ask them why. |
| You were signed out in the middle of working | Your account was denied or deleted. The message that appeared says which. |
| **Login with Face** does not recognise you | Try better, even light and face the camera squarely. If two enrolled people look very alike the system refuses rather than guessing which — use your username and password instead. |
| Face sign-in used to ask for your password as well | It no longer does. The two methods are now alternatives: either your password **or** your face. |
| A wallet total looks wrong | Check which currency block you are reading. USD and REM are reported separately and are never added together. |
| Registration says the username or email is taken | That account already exists. Sign in instead, or use a different one. |
