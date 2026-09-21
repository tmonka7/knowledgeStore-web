# Knowledge Store — User Manual

Version 1.0 · 21 September 2026

## 1. Before you start

You need the address of your Knowledge Store installation and a browser
(Chrome, Edge, Firefox or Safari). Creating an account requires a **photo of
your face**, taken with your webcam or uploaded, because the system can use it
to verify you at sign-in.

## 2. Creating your account

1. Open the application and choose **Register**.
2. Fill in your full name, a username, your email address and a password of at
   least 6 characters, then repeat the password.
3. Fill in as much of the personal section as you wish — **gender, birthday,
   phone number, job and address**. All of it is optional, and you can add or
   change it later on My Page.
4. Capture or upload your face photo.
5. Choose **Register**. You are signed in straight away.

New accounts are ordinary user accounts. Only an administrator can make an
account an administrator.

## 3. Signing in

Enter your username and password. If your account has a face photo you will
also be asked to verify with your camera — choose **Login with Face** and look
at the camera.

Sessions last 8 hours. After that you are asked to sign in again.

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

Your name, email address and face photo are changed by an administrator on the
Users page — ask them if one of those is wrong.

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

## 7. Chat

Chat is for direct messages between two people on this installation. A
conversation is private to the two of you; administrators cannot read it.

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

## 9. Other pages

| Page | What it does |
|---|---|
| Overview | Counts and recent activity across the installation. |
| Data | Knowledge records: create, search by text, category or date, attach files, export to Word. |
| Category | The tree that records are filed under. |
| Camera Management | Register cameras and watch them, singly or as a wall. |
| Schedule | Your own calendar entries, including repeating ones. |
| Mail | Internal mail with one attachment. It does not leave this installation. |
| Contacts | Your own address book, on My Page. |
| Tools | LVGL, Converting, YOLO, Transformers and Keras helpers. |
| Users | For administrators: accounts, roles and permissions. |
| Database Management | For administrators: backups, restores, replication and cleanup. |
| System Monitoring | Measured API latency and browser memory. |

## 10. For administrators

### Managing accounts

Open **Users**. The list holds every registered account. It is re-read each
time you open the page, and **Refresh** brings in anyone who has registered
while you were looking at it.

Click the pencil on a row to edit that account:

- **Basic Info** — face photo, full name, email, gender, birthday, phone
  number, address, job, and the role. You cannot remove your own
  administrator role.
- **Permissions** — tick the pages and actions the account may use.
  Administrators bypass this list entirely, so it is shown as read-only for
  them.
- **Logs** — recent activity for that account.

A permission change takes effect on that user's next request; they do not need
to sign out and in again.

### Accounts are created by registration

There is no "create user" form. Ask the person to register themselves, so they
enrol their own face photo, and then set their role and permissions here.

## 11. Troubleshooting

| Symptom | What to do |
|---|---|
| A page is missing from the sidebar | Your account lacks permission for it. Ask an administrator. |
| Someone who just registered is not in the Users list | Press **Refresh** on the Users page. |
| Someone is missing from a project member or assignee list | Close the dialog and open it again; the list is re-read each time it opens. |
| A chat file will not download | If its name ends in **(deleted)** it is past its week and has been removed. |
| A record you expected is not in the Data list | Its owner shared it with named people and you are not one of them. Ask them to add you. |
| You cannot edit a record you can see | It belongs to someone else. Sharing lets you read it, not change it. |
| "Invalid or expired token" | Your 8-hour session ended. Sign in again. |
| A wallet total looks wrong | Check which currency block you are reading. USD and REM are reported separately and are never added together. |
| Registration says the username or email is taken | That account already exists. Sign in instead, or use a different one. |
