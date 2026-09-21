# Knowledge Store — Test Case Specification

Version 1.0 · 21 September 2026 · Traces to the Requirements Specification

## 1. How to run these

**Environment.** A running API (`npm --prefix backend run dev`), a running
frontend (`npm --prefix frontend run dev`), and a MongoDB the tester may
modify. Cases marked *destructive* change or delete data; run them last, or
against a scratch database.

**Accounts.** Three are assumed:

| Alias | Role | Permissions |
|---|---|---|
| ADMIN | admin | everything (bypass) |
| USER1 | user | defaults, plus `users:view` where a case says so |
| USER2 | user | defaults |

All three need a face photo, since registration requires one.

**Result column.** Pass / Fail / Blocked, with the build identifier.

## 2. Authentication

| ID | Requirement | Steps | Expected |
|---|---|---|---|
| TC-AUTH-01 | FR-AUTH-01, FR-AUTH-09 | Register with all mandatory fields and a face photo. | Account created. **Not** signed in: the card returns to Login with a message that an administrator must approve it. |
| TC-AUTH-02 | FR-AUTH-02 | Register reusing an existing username. | 409 and "That username is already registered." No account created. |
| TC-AUTH-03 | FR-AUTH-02 | Register with a 5-character password. | Rejected before submission by the form; if forced via the API, 400. |
| TC-AUTH-04 | FR-AUTH-03 | Attempt to register without capturing a face photo. | Submission refused with a message about the face photo. |
| TC-AUTH-05 | FR-AUTH-04 | Register filling gender, birthday, phone, address and job. | Account created; the same values appear on My Page. |
| TC-AUTH-06 | FR-AUTH-04 | Register leaving all five personal fields empty. | Account created; My Page shows "—" for each. |
| TC-AUTH-07 | FR-AUTH-06 | Set a birthday in the future through the API. | 400 "Birthday cannot be in the future." |
| TC-AUTH-08 | FR-AUTH-06 | Send `birthday=2001-02-30` through the API. | 400 "That birthday is not a real date." |
| TC-AUTH-09 | FR-AUTH-09, FR-AUTH-10 | Immediately try to sign in as that new account with the correct password. | 403, "waiting for an administrator to approve it". The wording must not say access was denied. |
| TC-AUTH-10 | FR-AUTH-07 | Register and inspect the new account. | Role is `user`. Sending `role: "admin"` in the registration body changes nothing. |
| TC-AUTH-11 | FR-AUTH-05 | As ADMIN, approve the account. Sign in with username and password only, no face. | Signed in. **Regression guard:** the previous build demanded a face as well, which made method 1 impossible for anyone enrolled. |
| TC-AUTH-12 | FR-AUTH-05, FR-AUTH-05a | On the login screen press **Login with Face** with both fields empty, and present the enrolled face. | The camera opens without complaining about the empty fields, and the correct account is signed in. |
| TC-AUTH-13 | FR-AUTH-05a | Present a face belonging to nobody enrolled. | Refused with "That face was not recognised…"; no account is signed in. |
| TC-AUTH-14 | FR-AUTH-05a | Enrol two accounts with very similar faces (or set `FACE_MATCH_MARGIN=0.5` to force it) and present one of them. | Refused rather than guessing. The server logs which two were too close; the browser is told only that it was not recognised. |
| TC-AUTH-15 | FR-AUTH-05b | Compare the message from TC-AUTH-13 with the one from TC-AUTH-14. | Identical. Nothing distinguishes "no match" from "ambiguous match" to the person at the screen. |
| TC-AUTH-16 | FR-AUTH-10 | Deny an account, then try both sign-in methods. | Both refused with the denied message, not the pending one. |
| TC-AUTH-17 | FR-AUTH-05a | Deny an account that has a face enrolled, then present that face. | Not recognised — denied accounts are not candidates for identification at all. |
| TC-AUTH-18 | FR-AUTH-11 | While USER1 is using the application, have ADMIN deny their account. Have USER1 click anything. | USER1 is signed out with the reason shown, without waiting for the token to expire. |
| TC-AUTH-19 | FR-AUTH-11 | While USER1 is signed in, delete their account. Have USER1 click anything. | Signed out with "This account no longer exists." |
| TC-AUTH-20 | FR-USR-16 | Start the API against a database whose accounts predate the status field. | Every account is Allowed and everyone can still sign in. **Regression guard:** without the backfill, adding the field locks out the entire installation, administrators included. |
| TC-AUTH-21 | FR-USR-16 | Deny an account, restart the API, and check it. | Still denied. The backfill is marker-guarded and does not run twice. |
| TC-AUTH-22 | FR-USR-16 | Run a database **reset** from Database Management with a new superuser, then sign in as that superuser. | Signed in. **Regression guard:** a superuser created as Pending would be an administrator nobody could approve. |

## 3. Users and permissions

| ID | Requirement | Steps | Expected |
|---|---|---|---|
| TC-USR-01 | FR-USR-01 | As ADMIN, open Users after USER1 and USER2 exist. | Every account is listed, including ones ADMIN did not create. |
| TC-USR-02 | FR-USR-01 | Grant USER1 `users:view` only. Sign in as USER1, open Users. | USER1 sees **all** accounts, not only their own row. Edit actions are absent. |
| TC-USR-03 | FR-USR-02 | Stay signed in as ADMIN on any page. Register a new account in another browser. Return and open Users. | The new account is in the list without reloading the application. |
| TC-USR-04 | FR-USR-02 | Stay on the Users page while another account registers, then press Refresh. | The new account appears. |
| TC-USR-05 | FR-USR-08 | While USER1 is signed in, have ADMIN promote them to admin. Have USER1 reload the page. | USER1 now reaches admin-only pages without signing out and in. |
| TC-USR-06 | FR-USR-03, FR-USR-04 | As ADMIN, edit an account: change name, role, gender, birthday, phone, address, job. Save and reopen. | Every value persisted; the table reflects the new name and role. |
| TC-USR-07 | FR-USR-04 | As ADMIN, clear a phone number and save. | The field is stored empty, not left at its old value. |
| TC-USR-08 | FR-USR-05 | As USER1 on My Page, change gender, birthday, phone, address, job; save. | "Profile updated."; the Profile panel shows the new values immediately. |
| TC-USR-09 | FR-USR-05 | As USER1, attempt `PUT /user/profile` with `role: "admin"` and a new email. | 200, but role and email are unchanged. |
| TC-USR-10 | FR-USR-07 | As ADMIN, edit your own account and try to set the role to User. | 400 "You cannot remove your own administrator role." |
| TC-USR-11 | FR-USR-09 | Revoke `records:view` from USER1. | Data disappears from USER1's sidebar and `GET /data` returns 403. |
| TC-USR-12 | FR-AUTH-08 | As USER1 on My Page, change the password with the wrong current password. | 401 "Current password is incorrect."; the old password still works. |
| TC-USR-13 | FR-USR-13 | As ADMIN open Users after a new registration. | The account's Status pill reads Pending in amber, and the "Waiting for approval" card is amber with that count. |
| TC-USR-14 | FR-USR-13 | Press **Allow** on that row. | The pill turns green without opening a dialog, and the person can now sign in. |
| TC-USR-15 | FR-USR-13 | Press **Deny** on an allowed account, then **Allow** again. | The pill follows each change; the account is refused in between and usable afterwards. |
| TC-USR-16 | FR-USR-13 | Filter the list by each of Pending, Allowed and Denied. | Only accounts in that state are listed; Reset restores the whole list. |
| TC-USR-17 | FR-USR-14 | Compare the sign-in message for a Pending account with one for a Denied account. | They differ. Pending says it is waiting for approval; Denied says access has been denied. |
| TC-USR-18 | FR-USR-15 | As ADMIN, look at your own row. | Neither **Deny** nor the delete button is offered on it. |
| TC-USR-19 | FR-USR-15 | Call `PUT /users/:id/status` with `denied` for your own account. | 400 "You cannot deny or suspend your own account." |
| TC-USR-20 | FR-USR-15 | With exactly one allowed administrator, try to deny them from another administrator that has been denied. | 400 naming the last-administrator rule; the account stays allowed. |
| TC-USR-21 | FR-USR-19 | As ADMIN, press delete on USER1, who owns records, a wallet, chats and a hosted meeting. | A dialog lists the counts of each, separately lists what is kept and unlinked, and warns it cannot be undone. Nothing is deleted yet. |
| TC-USR-22 | FR-USR-19 | Cancel that dialog and check USER1. | The account and all of its data are intact. |
| TC-USR-23 | FR-USR-17 | Confirm the deletion, then inspect the database and `uploads/`. | The account, its records, wallet entries, contacts, schedules, posts, chat threads and messages, mail it sent, hosted meetings and their recordings are gone, along with the files those pointed at. |
| TC-USR-24 | FR-USR-17 | After TC-USR-23, sign in as the person USER1 had been chatting with and open Chat. | The conversation is gone for them too — there is no half of it that was not also USER1's. |
| TC-USR-25 | FR-USR-17 | Before deleting, have USER2 send USER1 mail and keep it in Sent. Delete USER1, then check USER2's Sent folder. | The message is still there with no recipients. **Regression guard:** deleting every message left with no recipients would destroy USER2's own copy. |
| TC-USR-26 | FR-USR-18 | Delete a user who owned a project containing other people's tasks. | The project survives, is owned by the administrator who ran the deletion, and its tasks and comments by other people are untouched. |
| TC-USR-27 | FR-USR-18 | Open a task the deleted user had been assigned and had moved through the workflow. | Assignee is empty rather than blank-and-broken; their comments are gone; their history entries remain, attributed to "Deleted user". |
| TC-USR-28 | FR-USR-20 | Try to delete your own account, from the UI and then from the API. | No delete button on your own row; the API answers 400. |
| TC-USR-29 | FR-USR-17 | After deleting an account, run the orphan report on Database Management. | No new orphan files — the purge removed them rather than leaving them for the sweep. |

## 4. Wallet

Pre-condition for this section: USER1 holds the wallet permissions (they are
granted by default).

| ID | Requirement | Steps | Expected |
|---|---|---|---|
| TC-WAL-01 | FR-WAL-02, FR-WAL-03 | Add an income entry of 1000 with currency USD, then an expense of 250 with currency REM. | Both saved. The entries table shows a Currency column reading USD and REM respectively. |
| TC-WAL-02 | FR-WAL-05 | Look at the statistics after TC-WAL-01. | Two rows of stat cards: Income · USD 1,000 with Balance · USD 1,000, and Expense · REM 250 with Balance · REM −250. Nothing shows 750. |
| TC-WAL-03 | FR-WAL-05 | Inspect the "Income and expense" panel. | Two labelled blocks, USD and REM, each with its own bars. |
| TC-WAL-04 | FR-WAL-05 | Inspect a currency with no entries at all. | "Nothing recorded in <code>" in place of a chart; the currency's cards read zero rather than disappearing. |
| TC-WAL-05 | FR-WAL-06 | Check every total on the page. | No figure anywhere combines USD and REM. There is no currency selector and no converted value. |
| TC-WAL-06 | FR-WAL-03 | Add an entry, then reopen the dialog to add another. | The currency is preselected to the one last used. |
| TC-WAL-07 | FR-WAL-02 | Submit an entry with an amount of 0, and another with a negative amount. | 400 "Amount must be greater than zero." |
| TC-WAL-08 | FR-WAL-03 | `POST /wallet/entries` with `currency: "EUR"`. | 400 "Currency must be one of USD, REM." |
| TC-WAL-09 | FR-WAL-04 | Insert a wallet entry directly in MongoDB with no `currency` field, then reload the page. | It is listed and counted as USD. |
| TC-WAL-10 | FR-WAL-01 | As USER2, call `GET /wallet/entries`. | Only USER2's entries. USER1's are absent even for an administrator. |
| TC-WAL-11 | FR-WAL-07 | Apply a date-range filter. | The cards, the charts, the monthly table and the entries table all describe the same filtered set. |
| TC-WAL-12 | FR-WAL-05 | Edit an entry and change its currency from USD to REM; save. | It moves between the two statistics blocks; both totals change accordingly. |

## 5. Chat

| ID | Requirement | Steps | Expected |
|---|---|---|---|
| TC-CHT-01 | FR-CHT-01 | As USER1, type part of USER2's name in the chat search. | USER2 appears under "People". |
| TC-CHT-02 | FR-CHT-02 | Open a conversation with USER2 twice. | The same conversation both times; the list holds one row for USER2. |
| TC-CHT-03 | FR-CHT-03 | Send a message to USER2, with USER2 signed in elsewhere with the conversation open. | It appears on USER2's side within about four seconds without a reload. |
| TC-CHT-04 | FR-CHT-05 | Send two messages to USER2 while USER2 is on another page. | The sidebar Chat badge shows 2; opening the conversation clears it. |
| TC-CHT-05 | FR-CHT-04 | As ADMIN, call `GET /chat/threads/<USER1-USER2 thread>/messages`. | 404 "Conversation not found." — administrators have no access. |
| TC-CHT-06 | FR-CHT-06 | Click the paper clip, choose a 2 MB PDF, send. | The bubble shows the file name, its size and "Deleted in 7 days", and is a working download link. |
| TC-CHT-07 | FR-CHT-06 | Type a note, then attach a file without pressing Send first. | One message arrives carrying both the file and the note; the text box is cleared. |
| TC-CHT-08 | FR-CHT-06 | Attempt to send a 30 MB file. | Refused with a message naming the 25 MB limit; nothing is added to the conversation. |
| TC-CHT-09 | FR-CHT-09 | Look at the conversation list after TC-CHT-06. | The preview reads `📎 <file name>`. |
| TC-CHT-10 | FR-CHT-07, FR-CHT-08 | Set the message's `attachment.expiresAt` to yesterday in MongoDB and restart the API (or wait for the hourly sweep). | The file is gone from `uploads/chat`; the message remains; the name ends with `(deleted)`; the bubble is dimmed and no longer a link. |
| TC-CHT-11 | FR-CHT-08 | Run the sweep a second time over the same message. | The tag is not appended twice; nothing errors. |
| TC-CHT-12 | FR-DBA-06 | With a fresh chat attachment in place, run Database Management → Optimization → delete unlinked uploads. | The chat file is **not** deleted, and is counted as referenced. |
| TC-CHT-13 | FR-CHT-06 | Revoke `chat:create` from USER1 and try to send a file. | 403; the message is not created. |
| TC-CHT-14 | FR-CHT-10 | Have USER2 send USER1 three messages while USER1 is on the Overview page. | The header message icon shows 3 and its menu lists the three, newest first, each with sender, preview and time, marked unread. |
| TC-CHT-15 | FR-CHT-11 | Click one of those messages. | Chat opens with that conversation already selected and its messages loaded. |
| TC-CHT-16 | FR-CHT-10 | Send a file with no note, then open the header menu. | Its preview reads `📎 <file name>` rather than being blank. |
| TC-CHT-17 | FR-CHT-11 | Revoke `chat:view` from USER1 and reload. | The message icon is absent from the header, and `GET /chat/recent` returns 403. |
| TC-CHT-18 | FR-CHT-10 | Leave the app open with the header menu never touched. | `/chat/recent` is polled about every 15 seconds; the badge and the menu stay in step without a reload. |

## 6. Projects

| ID | Requirement | Steps | Expected |
|---|---|---|---|
| TC-PRJ-01 | FR-PRJ-01 | Create a project, edit its name, then delete it. | Each succeeds; deletion warns how many tasks it will take with it. |
| TC-PRJ-02 | FR-PRJ-09 | Open the project dialog, and separately the task dialog, after a new account has registered. | The new account is offered in the member and assignee pickers without reloading the app. |
| TC-PRJ-03 | FR-PRJ-06 | Move a task to Resolved, then try to close it. | Close is not offered; forcing `transition` to `closed` returns 409 listing `verified` and `reopened`. |
| TC-PRJ-04 | FR-PRJ-05 | Verify a resolved task. | Status becomes Verified and the verifier and time are recorded. |
| TC-PRJ-05 | FR-PRJ-08 | Open the drawer of a task that has been moved, assigned, commented on and had a file attached. | The history lists every one of those events with actor and time, newest first. |
| TC-PRJ-06 | FR-PRJ-02 | Add tasks and complete some. | Project progress follows the tasks until a manual progress value is set, after which the card says "Progress (manual)". |
| TC-PRJ-07 | FR-PRJ-01 | Inspect a project card's footer. | Three icon-only buttons; each shows a tooltip on hover and exposes a label naming the project. |

## 7. Records, categories and the remaining modules

| ID | Requirement | Steps | Expected |
|---|---|---|---|
| TC-REC-01 | FR-REC-01 | Create a record with content and two attachments; reopen it. | Content renders as written; both files download. |
| TC-REC-02 | FR-REC-02 | Search by text, then by category, then by date range. | Each filter narrows the list; clearing restores it. |
| TC-REC-03 | FR-REC-03 | Export a record to Word. | A `.docx` downloads and opens with the record's title and content. |
| TC-REC-04 | FR-REC-04 | Create a child category and delete it. | The tree updates without a reload. |
| TC-REC-05 | FR-REC-05, FR-REC-06 | As USER1, create a record without touching the sharing control. | Saved with "Everyone"; USER2 sees it in their Data list. |
| TC-REC-06 | FR-REC-05 | As USER1, create a record shared with USER2 only. Check as USER2, then as a third account. | USER2 sees it; the third account does not; USER1 still does. |
| TC-REC-07 | FR-REC-07 | As USER1, create a record with "Selected people" and nobody chosen. | The hint says only you can see it. USER2 does not see it; USER1 does. |
| TC-REC-08 | FR-REC-05 | Edit that record and switch it back to Everyone. | USER2 sees it on their next load. |
| TC-REC-09 | FR-REC-10 | With a record shared only with USER2, search as a third account for a word in its title. | It is not in the results. **Regression guard:** a text search must not widen access. |
| TC-REC-10 | FR-REC-08 | As USER2, open a record USER1 shared with them. | It opens and reads. No edit or delete button is offered; `PUT /data/:id` returns 403 if called directly. |
| TC-REC-11 | FR-REC-08 | As USER2, select a shared record and a record of their own and press Delete in the toolbar. | Only their own is deleted; the shared one is skipped with a message rather than erroring mid-run. |
| TC-REC-12 | FR-REC-09 | Open the detail dialog of an everyone record, a selectively shared one, and a private one. | The tag reads "Shared with everyone", "Shared with <names>" and "Private to you" respectively. |
| TC-REC-13 | FR-REC-06 | Insert a record directly in MongoDB with no `visibility` field. Look as another account. | It is visible — a legacy record reads as shared with everyone. |
| TC-REC-14 | FR-USR-10 | As USER1, who lacks `users:view`, open the add-record dialog and choose "Selected people". | The picker lists every account by name and username. `GET /users` still returns 403. |
| TC-REC-15 | FR-USR-11 | Sign in as an administrator, have another administrator demote them, then list records without signing out. | Only records they own or that are shared with them come back — the bypass is gone immediately. |
| TC-MSG-01 | FR-MSG-01, FR-MSG-02 | As USER1, compose to USER2 with a subject, content and a 1 MB attachment, and send. | It appears in USER1's Sent folder and in USER2's Inbox, marked unread, with the attachment. |
| TC-MSG-02 | FR-MSG-01 | Open the compose dialog. | Recipients are chosen from a list of accounts; there is no free-text address field. |
| TC-MSG-03 | FR-MSG-04 | As USER2, look at the Inbox before and after opening that message. | The Inbox count drops by one; the row stops being bold. |
| TC-MSG-04 | FR-MSG-05 | As USER1, open the message in Sent after USER2 has read it. | "Opened by 1 of 1", with USER2's name and the time they opened it. |
| TC-MSG-05 | FR-MSG-05 | Send to two people; have one open it. | Sent shows "Opened 1/2"; the unopened recipient reads "Not opened yet". |
| TC-MSG-06 | FR-MSG-06 | Have USER2 open the same message again an hour later. | The time shown to the sender is unchanged. |
| TC-MSG-07 | FR-MSG-07 | As USER2, reply. | The reply is addressed to USER1, the subject is prefixed "Re:", and the original is quoted below. |
| TC-MSG-08 | FR-MSG-08 | As USER2, delete a message; check USER1's Sent folder. | It is gone from USER2's inbox and still in USER1's Sent. |
| TC-MSG-09 | FR-MSG-08 | Delete the same message from both sides, then inspect `mail_messages`. | The document is gone once nobody holds it. |
| TC-MSG-10 | FR-MSG-09 | As ADMIN, call `GET /mail/:id` for a message between USER1 and USER2. | 404 — administrators have no access to a mailbox. |
| TC-MSG-11 | FR-MSG-03 | Attempt to send with no recipient, then with no subject, then a 30 MB attachment. | Each is refused with a message naming what is missing or too large. |
| TC-MSG-12 | FR-MSG-10 | Search the Inbox for a word in a subject, then in a sender's name. | Both narrow the list; clearing restores it. |
| TC-MSG-13 | FR-MSG-11 | Have USER2 send USER1 two messages while USER1 is on the Overview page. | The header mail icon shows 2 and its menu lists both, newest first, with sender, subject and time, marked unread. |
| TC-MSG-14 | FR-MSG-12 | With the Sent folder open, choose a message from the mail menu. | Mail switches to the Inbox and opens that message; the badge falls by one. |
| TC-MSG-15 | FR-MSG-12 | Revoke `mail:view` from USER1 and reload. | The mail icon is absent from the header, and `GET /mail/recent` returns 403. |
| TC-SCH-01 | FR-SCH-01 | Create a repeating schedule entry. | It appears on the expected days and in the upcoming list. |
| TC-CON-01 | FR-CON-01 | Create a contact, favourite it, edit, delete. | Each succeeds; favourites sort to the top. |
| TC-CON-02 | FR-CON-02 | As USER2, list contacts. | USER1's contacts are absent. |
| TC-CAM-01 | FR-CAM-01 | Register a camera and open the wall. | The camera appears with its status. (More camera cases in §6b.) |
| TC-SYS-01 | FR-SYS-01 | Watch System Monitoring for a minute. | Latency varies with real requests; no series sits at a constant zero. |
| TC-I18N-01 | FR-I18N-01 | Switch the language to each of Spanish, Chinese and Japanese. | Interface text changes; no key appears raw on the new screens (Gender, Birthday, Phone number, Address, Job). |
| TC-I18N-02 | FR-I18N-02 | Rename `translations.xml` and reload. | The application still renders, falling back to keys rather than showing a blank page. |

## 6a. Posts

| ID | Requirement | Steps | Expected |
|---|---|---|---|
| TC-PST-01 | FR-PST-01 | As ADMIN, publish a post with a title and content. | It appears at the top of the list, authored by ADMIN. |
| TC-PST-02 | FR-PST-01 | Publish a second post and pin it. | The pinned post sorts above the newer unpinned one and carries a pin. |
| TC-PST-03 | FR-PST-03, FR-PST-04 | As USER1, who has not read either post, look at the bell and the sidebar. | Both show 2; the bell lists the posts under "2 new post(s)" above the schedule reminders. |
| TC-PST-04 | FR-PST-04 | Choose one of them from the bell. | The Posts page opens with that post open. The count falls to 1 without a reload. |
| TC-PST-05 | FR-PST-05 | As USER1, close and reopen the same post; then check the reader list. | USER1 appears once, with the time of the first opening. |
| TC-PST-06 | FR-PST-06 | As ADMIN, look at the list after three people have read a post. | The "Read by" cell reads 3. |
| TC-PST-07 | FR-PST-07 | Click that count. | A dialog lists all three readers by name with the time each opened it. |
| TC-PST-08 | FR-PST-02 | As USER1, who holds only `posts:view`. | No New post, Edit or Delete control is offered; `POST /posts` returns 403. |
| TC-PST-09 | FR-PST-02 | As ADMIN, edit a post's content, then delete it. | The change is visible to a reader; deletion removes it and its reader list. |
| TC-PST-10 | FR-PST-05 | Open a post, then look at the list. | Its **New** badge is gone and the row is no longer bold. |
| TC-PST-11 | FR-PST-03, FR-USR-12 | On a database whose accounts predate Posts, start the API and sign in as a **non-administrator**. Publish a post as ADMIN and wait a minute. | Posts is in their sidebar and the new post is in their bell. **Regression guard:** these accounts had no `posts:view`, so a post published for everyone reached nobody. |
| TC-PST-12 | FR-USR-12 | Revoke `posts:view` from USER1, restart the API, sign in as USER1. | It stays revoked — the backfill does not run a second time. |
| TC-PST-13 | FR-USR-12 | Inspect `app_migrations` after the first start. | One marker row for the posts backfill, with the time it was applied. |

## 6b. Cameras

| ID | Requirement | Steps | Expected |
|---|---|---|---|
| TC-CAM-02 | FR-CAM-03 | Open the edit dialog for an existing camera. | Every field is filled in with that camera's current values. **Regression guard:** this dialog opened empty in the previous build. |
| TC-CAM-03 | FR-CAM-02 | Grant USER1 `cameras:view` only. | The page lists cameras; no Add, Edit or Delete control appears anywhere on it. |
| TC-CAM-04 | FR-CAM-02 | Grant USER1 `cameras:view` and `cameras:edit`. | Edit appears on each card; Delete does not. |
| TC-CAM-05 | FR-CAM-04 | Register one camera with an `http://` address marked online, and one with `rtsp://`. | The first previews in the card; the second says no preview is available and still offers its details. |
| TC-CAM-06 | FR-CAM-01 | Open a camera, use fullscreen, and start object detection on an http stream. | The stream fills the screen; detection outlines people and vehicles. |

## 6c. Meetings

These need two browsers signed in as different accounts. On one machine, use a
normal window and a private window, both on `http://localhost` — on any other
address the browser will not release a camera. USER1 and USER2 below are those
two sessions.

| ID | Requirement | Steps | Expected |
|---|---|---|---|
| TC-MTG-01 | FR-MTG-01 | As USER1, create a meeting titled "Standup" with no start time. | It appears in the list as Scheduled, hosted by USER1, described as open. |
| TC-MTG-02 | FR-MTG-03 | USER1 joins, then USER2 joins. | Each sees two tiles and hears the other. USER2's tile appears for USER1 within a few seconds without a reload. |
| TC-MTG-03 | FR-MTG-09 | While both are in the call, look at the list in a third session. | The card is outlined green, badged Live, and names both participants. |
| TC-MTG-04 | FR-MTG-04 | USER1 mutes, then turns the camera off. | USER2 sees a microphone icon, then USER1's initials in place of the picture, and hears nothing. Unmuting restores both. |
| TC-MTG-05 | FR-MTG-05 | USER1 shares a screen, then stops. | USER2 sees the screen in USER1's tile and a screen icon on it; stopping returns to the camera. Ending it from the browser's own "Stop sharing" bar behaves identically. |
| TC-MTG-06 | FR-MTG-05, FR-MTG-04 | USER1 shares a screen while muted, and speaks. | Nothing is heard — sharing does not silently unmute. |
| TC-MTG-07 | FR-MTG-06 | USER1 sends a message in the in-call chat; USER2 opens the panel. | The message is there with USER1's name and time. USER2's closed chat button carried an unread count. |
| TC-MTG-08 | FR-MTG-06 | A third account joins after the messages were sent. | The history is there from the moment they join. |
| TC-MTG-09 | FR-MTG-07, FR-MTG-08 | USER1 starts recording. | USER2 immediately sees a warning that the meeting is being recorded, and a REC badge on USER1's tile. USER1 sees a running timer. |
| TC-MTG-10 | FR-MTG-07 | USER1 stops recording, then opens the meeting's recordings. | One entry, with the duration, size and USER1 as the recorder. Playing it shows both tiles with names and plays both voices. |
| TC-MTG-11 | FR-MTG-07 | USER1 records while sharing a screen, and talks throughout. | USER1's voice is on the recording for the whole of it, not only before and after the share. |
| TC-MTG-12 | FR-MTG-10 | USER2 leaves and rejoins, then USER1 opens the attendance list. | Two visits for USER2 — the first with a leaving time, the second still open. |
| TC-MTG-13 | FR-MTG-11 | USER1 ends the meeting while USER2 is still in it. | USER2 is disconnected and told the meeting ended. The card reads Ended; the recordings and attendance list are intact. |
| TC-MTG-14 | FR-MTG-02 | USER1 creates a meeting limited to USER3. | USER2 does not see it at all, and `GET /meetings/:id` returns 404 for them. |
| TC-MTG-15 | FR-MTG-02, FR-MTG-11 | While USER2 is in an open meeting, USER1 edits it to admit only USER3. | USER2 is disconnected. **Regression guard:** the person just excluded must not be the one left in the call. |
| TC-MTG-16 | FR-MTG-12 | Delete a meeting that has a recording, then look in `uploads/meetings/`. | Both the document and the file are gone, and no orphan is reported on the Database page. |
| TC-MTG-17 | FR-MTG-12 | As USER2, who recorded it, delete that recording. Then try as an unrelated account. | USER2 succeeds; the unrelated account gets 403. |
| TC-MTG-18 | FR-MTG-13 | Set `MEETING_MAX_PEERS=2`, restart, and have a third account try to join a call of two. | It is refused with "this meeting is full"; the two in the call are undisturbed. |
| TC-MTG-19 | FR-MTG-13 | USER1 opens the same meeting in a second tab while `MEETING_MAX_PEERS=2`. | It is allowed — the cap counts people, not tabs — and USER1 appears once in the roster. |
| TC-MTG-20 | FR-MTG-03 | Refuse the camera permission when the browser asks, then join. | The call is joined to watch and listen, with a notice saying so, rather than failing. |
| TC-MTG-21 | FR-MTG-03 | Load the app over `http://` on a LAN address and open Meetings. | The warning panel appears under the page header, before any attempt to join. |
| TC-MTG-22 | FR-MTG-09 | While USER2 is in a call, kill their browser (do not leave cleanly). Wait a minute. | USER2 disappears from the roster and the list. **Regression guard:** occupancy must not survive a socket that was never closed politely. |
| TC-MTG-23 | FR-MTG-09 | Restart the API while a meeting shows as live, then reload the list. | No meeting claims to be in progress; nothing is left occupied by nobody. |
| TC-MTG-24 | FR-USR-12 | On a database whose accounts predate Meetings, restart the API and sign in as a non-administrator. | Meetings is in their sidebar, and `app_migrations` has a marker for the meetings backfill. |

## 8. Database management *(destructive)*

| ID | Requirement | Steps | Expected |
|---|---|---|---|
| TC-DBA-01 | FR-DBA-01 | Run a safe initialisation. | Indexes synchronised and seed data ensured; no data lost. |
| TC-DBA-02 | FR-DBA-02 | Run a reset without typing RESET. | Refused. |
| TC-DBA-03 | FR-DBA-02 | Run a reset with RESET and superuser details. | A backup is taken first; collections are dropped; the response says the session is invalid; the app returns to sign-in; the new superuser can sign in. |
| TC-DBA-04 | FR-DBA-03 | Create a backup, delete a record, restore with "replace". | The record is back; a safety backup was taken before the restore. |
| TC-DBA-05 | FR-DBA-03 | Download a backup and upload it again. | It appears in the list and can be inspected. |
| TC-DBA-06 | FR-DBA-04 | Open Replication against a standalone mongod. | It reports a standalone server and explains it, rather than showing an empty member list. |
| TC-DBA-07 | FR-DBA-05, FR-DBA-06 | Upload a file, delete the record that referenced it, wait an hour, run the orphan cleanup. | The file is deleted. A file uploaded minutes ago is listed as recent and kept. |
| TC-DBA-08 | FR-DBA-06 | With live record, mail, task and chat attachments present, run the orphan cleanup. | None of them is deleted. |

## 9. Non-functional checks

| ID | Requirement | Steps | Expected |
|---|---|---|---|
| TC-NFR-01 | NFR-01 | For each page permission, revoke it and call the matching API directly. | 403 every time; hiding the menu entry is never the only protection. |
| TC-NFR-02 | NFR-02 | Inspect every response that carries a user. | No `passwordHash` and no `faceDescriptor`. |
| TC-NFR-03 | NFR-03 | Sign in, wait past the 8-hour expiry, act. | 401 "Invalid or expired token." and a return to sign-in. |
| TC-NFR-04 | NFR-06 | Post a JSON body over 3 MB. | 413 with a readable message, not an HTML error page. |
| TC-NFR-05 | NFR-07 | Tab through a project card's actions and a wallet row's actions with a screen reader. | Every icon button announces what it does and to what. |
| TC-NFR-06 | NFR-05 | Leave Chat open and idle for five minutes with the network panel recording. | Polling continues at roughly 4–6 second intervals with small empty responses. |

## 9a. Confirmation on destructive actions

Requirement FR-USR-21 is a property of the whole application, so this section
walks every delete rather than sampling.

| ID | Requirement | Steps | Expected |
|---|---|---|---|
| TC-CNF-01 | FR-USR-21 | Delete a **category** that has sub-categories. | A dialog names the category and how many sub-categories go with it. **Regression guard:** this deleted on the click, with nothing in between. |
| TC-CNF-02 | FR-USR-21 | Remove a **task attachment**. | A dialog names the file and says it is deleted from the server. **Regression guard:** this also deleted on the click. |
| TC-CNF-03 | FR-USR-21 | Select 8 records in Data and press Delete in the toolbar. | **One** dialog naming 8 records. Confirming deletes all 8 and reloads the list once. **Regression guard:** this previously asked once for the selection and then once more per record. |
| TC-CNF-04 | FR-USR-21 | Delete a single record from its row. | One dialog, then the record goes. |
| TC-CNF-05 | FR-USR-21 | Walk the remaining deletes: contact, schedule entry, wallet entry, camera, post, project, task, mail, meeting, meeting recording, database backup, replication member. | Every one asks first, the dangerous button is red, and its label names the act rather than reading "OK". |
| TC-CNF-06 | FR-USR-21 | Cancel each dialog from TC-CNF-01 … 05 instead of confirming. | Nothing is deleted in any case. |
| TC-CNF-07 | FR-USR-21 | Run **Optimize** with orphan-file deletion selected, and a database **reset**. | Both confirm first; the reset additionally requires the word RESET to be typed. |

## 10. Regression set for this release

Run at minimum: TC-USR-01 … 04 (user list), TC-AUTH-05 … 08 and TC-USR-06 …
09 (personal details), TC-WAL-01 … 09 (two currencies), TC-CHT-06 … 13 (file
transfer and retention), TC-DBA-08 (retained chat files survive cleanup),
TC-REC-05 … 15 (record sharing — TC-REC-09 and TC-REC-15 are the two that
would let data leak if they regressed), TC-CHT-14 … 18 (header messages),
TC-MSG-01 … 15 (mail delivery, open tracking and the header icon — TC-MSG-10
is the privacy guard), TC-PST-01 … 13 (posts, the notification count and the
permission backfill — TC-PST-11 is the one that failed in the field),
TC-CAM-02 … 05 (camera permissions and the edit dialog), TC-MTG-01 … 24
(meetings — TC-MTG-15 is the access guard, TC-MTG-22 and TC-MTG-23 are the two
that would leave a room occupied by nobody, and TC-MTG-09 is the one that keeps
recording visible to the people being recorded), TC-AUTH-01 … 22 (the two
sign-in methods and account approval — **TC-AUTH-20 and TC-AUTH-22 come first**,
because both describe ways an upgrade can lock every account out of the
installation), TC-USR-13 … 29 (approval and account deletion — TC-USR-25 and
TC-USR-26 are the two that would destroy somebody else's data) and
TC-CNF-01 … 07 (every destructive action asks, and asks once).
