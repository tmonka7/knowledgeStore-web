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
| TC-AUTH-01 | FR-AUTH-01 | Register with all mandatory fields and a face photo. | Account created, signed in, name shown in the header. |
| TC-AUTH-02 | FR-AUTH-02 | Register reusing an existing username. | 409 and "That username is already registered." No account created. |
| TC-AUTH-03 | FR-AUTH-02 | Register with a 5-character password. | Rejected before submission by the form; if forced via the API, 400. |
| TC-AUTH-04 | FR-AUTH-03 | Attempt to register without capturing a face photo. | Submission refused with a message about the face photo. |
| TC-AUTH-05 | FR-AUTH-04 | Register filling gender, birthday, phone, address and job. | Account created; the same values appear on My Page. |
| TC-AUTH-06 | FR-AUTH-04 | Register leaving all five personal fields empty. | Account created; My Page shows "—" for each. |
| TC-AUTH-07 | FR-AUTH-06 | Set a birthday in the future through the API. | 400 "Birthday cannot be in the future." |
| TC-AUTH-08 | FR-AUTH-06 | Send `birthday=2001-02-30` through the API. | 400 "That birthday is not a real date." |
| TC-AUTH-09 | FR-AUTH-05 | Sign in with a correct password on a face-enrolled account, without a descriptor. | 401 with `faceRequired`, prompting face login. |
| TC-AUTH-10 | FR-AUTH-07 | Register and inspect the new account. | Role is `user`. Sending `role: "admin"` in the registration body changes nothing. |

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
| TC-MSG-01 | FR-MSG-01 | Send internal mail with an attachment, read it, delete it. | Each step succeeds; the attachment downloads before deletion. |
| TC-MSG-02 | FR-MSG-02 | Create a repeating schedule entry. | It appears on the expected days and in the upcoming list. |
| TC-CON-01 | FR-CON-01 | Create a contact, favourite it, edit, delete. | Each succeeds; favourites sort to the top. |
| TC-CON-02 | FR-CON-02 | As USER2, list contacts. | USER1's contacts are absent. |
| TC-CAM-01 | FR-CAM-01 | Register a camera and open the wall. | The camera appears with its status. |
| TC-SYS-01 | FR-SYS-01 | Watch System Monitoring for a minute. | Latency varies with real requests; no series sits at a constant zero. |
| TC-I18N-01 | FR-I18N-01 | Switch the language to each of Spanish, Chinese and Japanese. | Interface text changes; no key appears raw on the new screens (Gender, Birthday, Phone number, Address, Job). |
| TC-I18N-02 | FR-I18N-02 | Rename `translations.xml` and reload. | The application still renders, falling back to keys rather than showing a blank page. |

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

## 10. Regression set for this release

Run at minimum: TC-USR-01 … 04 (user list), TC-AUTH-05 … 08 and TC-USR-06 …
09 (personal details), TC-WAL-01 … 09 (two currencies), TC-CHT-06 … 13 (file
transfer and retention), TC-DBA-08 (retained chat files survive cleanup),
TC-REC-05 … 15 (record sharing — TC-REC-09 and TC-REC-15 are the two that
would let data leak if they regressed) and TC-CHT-14 … 18 (header messages).
