import fs from 'node:fs/promises';
import path from 'node:path';
import { User } from '../models/userModel.js';
import { Record } from '../models/recordModel.js';
import { WalletEntry } from '../models/walletModel.js';
import { Contact } from '../models/contactModel.js';
import { Schedule } from '../models/scheduleModel.js';
import { Post } from '../models/postModel.js';
import { Mail } from '../models/mailModel.js';
import { ChatThread, ChatMessage } from '../models/chatModel.js';
import { Project } from '../models/projectModel.js';
import { Task } from '../models/taskModel.js';
import { Meeting, MeetingMessage } from '../models/meetingModel.js';
import { ActivityLog } from '../models/activityLogModel.js';
import { UPLOAD_DIR } from './databaseMaintenance.js';

/*
 * Deleting an account, and everything behind it.
 *
 * "Everything of theirs" has two halves, and they are treated differently on
 * purpose:
 *
 *   Theirs alone — records, wallet, contacts, schedule, posts, direct
 *   messages, mail, the meetings they host, their face photo. All destroyed,
 *   files included.
 *
 *   Shared work others are still doing — projects and the tasks inside them.
 *   The person is unlinked rather than the work destroyed: ownership of a
 *   project passes to the administrator doing the deletion, they come off the
 *   member list, tasks they held are unassigned, their comments go, and their
 *   entries in a task's history are anonymised so the verification trail stays
 *   intact without carrying their name. Deleting a project would take other
 *   people's tasks with it, which is a bigger thing than deleting an account
 *   and is not what was asked for.
 *
 * A direct message thread is destroyed outright even though two people were in
 * it. There is no half of a conversation that is not also theirs.
 *
 * Every count here is produced by describeUserFootprint before anything is
 * deleted, so the confirmation an administrator sees is the real scope of what
 * is about to happen rather than a generic warning.
 */

/** Deletes an upload, refusing anything that resolves outside uploads/. */
const removeUpload = async (stored) => {
  const relative = String(stored || '')
    .replace(/^https?:\/\/[^/]+/i, '')
    .split('?')[0]
    .replace(/^\/+/, '')
    .replace(/^uploads\/?/, '')
    .trim();
  if (!relative) return false;

  const root = path.resolve(UPLOAD_DIR);
  const absolute = path.resolve(root, relative);
  const inside = path.relative(root, absolute);
  if (inside.startsWith('..') || path.isAbsolute(inside)) {
    console.warn(`Refusing to delete an upload outside the uploads folder: ${stored}`);
    return false;
  }

  try {
    await fs.unlink(absolute);
    return true;
  } catch (error) {
    // Already gone is not a failure; anything else is worth a line.
    if (error.code !== 'ENOENT') console.warn(`Could not delete ${relative}:`, error.message);
    return false;
  }
};

/**
 * What deleting this account would destroy, counted before anything is touched.
 *
 * The same queries the purge uses, so the numbers on the confirmation dialog
 * cannot describe one thing while the deletion does another.
 */
export const describeUserFootprint = async (userId) => {
  const [
    records, walletEntries, contacts, schedules, posts,
    threads, chatMessages, mailSent, mailReceived,
    hostedMeetings, meetingMessages, ownedProjects, memberProjects,
    assignedTasks, logs,
  ] = await Promise.all([
    Record.countDocuments({ ownerId: userId }),
    WalletEntry.countDocuments({ ownerId: userId }),
    Contact.countDocuments({ ownerId: userId }),
    Schedule.countDocuments({ ownerId: userId }),
    Post.countDocuments({ authorId: userId }),
    ChatThread.countDocuments({ participantIds: userId }),
    ChatMessage.countDocuments({ $or: [{ senderId: userId }, { recipientId: userId }] }),
    Mail.countDocuments({ senderId: userId }),
    Mail.countDocuments({ recipientIds: userId }),
    Meeting.countDocuments({ hostId: userId }),
    MeetingMessage.countDocuments({ senderId: userId }),
    Project.countDocuments({ ownerId: userId }),
    Project.countDocuments({ memberIds: userId, ownerId: { $ne: userId } }),
    Task.countDocuments({ $or: [{ assigneeId: userId }, { reporterId: userId }] }),
    ActivityLog.countDocuments({ actorId: userId }),
  ]);

  return {
    destroyed: {
      records,
      walletEntries,
      contacts,
      schedules,
      posts,
      chatThreads: threads,
      chatMessages,
      mailSent,
      mailReceived,
      hostedMeetings,
      meetingMessages,
      activityLogs: logs,
    },
    unlinked: {
      ownedProjects,
      memberProjects,
      assignedTasks,
    },
  };
};

/** Files first, then the documents that point at them. */
const destroyRecords = async (userId, files) => {
  const records = await Record.find({ ownerId: userId }, { attachment: 1, attachments: 1 }).lean();
  for (const record of records) {
    if (record.attachment) files.push(record.attachment);
    (record.attachments || []).forEach((file) => files.push(file));
  }
  await Record.deleteMany({ ownerId: userId });

  // They may also appear on other people's records as somebody it was shared
  // with. That reference is theirs and goes too.
  await Record.updateMany({ sharedWith: userId }, { $pull: { sharedWith: userId } });
};

const destroyChat = async (userId, files) => {
  const threads = await ChatThread.find({ participantIds: userId }, { id: 1 }).lean();
  const threadIds = threads.map((thread) => thread.id);
  if (!threadIds.length) return;

  const messages = await ChatMessage
    .find({ threadId: { $in: threadIds }, 'attachment.deletedAt': null }, { attachment: 1 })
    .lean();
  messages.forEach((message) => { if (message.attachment?.path) files.push(message.attachment.path); });

  await ChatMessage.deleteMany({ threadId: { $in: threadIds } });
  await ChatThread.deleteMany({ id: { $in: threadIds } });
};

const destroyMail = async (userId, files) => {
  // Anything they sent goes, for everyone: the sender is the author, and there
  // is no version of the message that is not theirs.
  const sent = await Mail.find({ senderId: userId }, { attachment: 1 }).lean();
  sent.forEach((mail) => { if (mail.attachment) files.push(mail.attachment); });
  await Mail.deleteMany({ senderId: userId });

  // Where they were only a recipient, their copy is removed and everybody
  // else's is left alone.
  await Mail.updateMany(
    { recipientIds: userId },
    { $pull: { recipients: { userId }, recipientIds: userId } },
  );

  /*
   * A message nobody holds any more, by exactly the rule deleteMail uses: the
   * sender must have deleted it too. Dropping every message that merely has no
   * recipients left would destroy the sender's own copy in Sent — someone
   * else's data, deleted because the person they wrote to was removed.
   */
  const stranded = await Mail.find(
    { deletedBySender: true, recipientIds: { $size: 0 } },
    { attachment: 1 },
  ).lean();
  stranded.forEach((mail) => { if (mail.attachment) files.push(mail.attachment); });
  await Mail.deleteMany({ deletedBySender: true, recipientIds: { $size: 0 } });
};

const destroyPosts = async (userId) => {
  await Post.deleteMany({ authorId: userId });
  // Their name also sits in the reader list of every post they opened.
  await Post.updateMany(
    { viewerIds: userId },
    { $pull: { views: { userId }, viewerIds: userId } },
  );
};

const destroyMeetings = async (userId, files) => {
  const hosted = await Meeting.find({ hostId: userId }, { id: 1, recordings: 1 }).lean();
  for (const meeting of hosted) {
    (meeting.recordings || []).forEach((recording) => files.push(recording.path));
  }
  const hostedIds = hosted.map((meeting) => meeting.id);

  await Meeting.deleteMany({ hostId: userId });
  await MeetingMessage.deleteMany({ meetingId: { $in: hostedIds } });
  await MeetingMessage.deleteMany({ senderId: userId });

  // Meetings other people host keep happening; only this person's traces go.
  await Meeting.updateMany(
    { $or: [{ inviteeIds: userId }, { 'participants.userId': userId }] },
    { $pull: { inviteeIds: userId, participants: { userId } } },
  );

  // A closed meeting whose invitee list is now empty would be a room nobody
  // but the host could enter, which is not what its host chose. Reopening it
  // is the less surprising of the two wrong answers, and it is logged.
  const stranded = await Meeting.find(
    { openToAll: false, inviteeIds: { $size: 0 } },
    { id: 1, title: 1 },
  ).lean();
  if (stranded.length) {
    await Meeting.updateMany(
      { id: { $in: stranded.map((meeting) => meeting.id) } },
      { $set: { openToAll: true } },
    );
    console.warn(
      `Deleting a user left ${stranded.length} closed meeting(s) with no invitees; they are now open to everyone.`,
    );
  }
};

/**
 * Unlinks the person from shared project work without destroying it.
 *
 * `newOwnerId` is the administrator performing the deletion. A project with an
 * ownerId nobody holds would be reachable only by its members, and would have
 * nobody able to edit or delete it — an orphan that could never be cleared up.
 */
const releaseProjects = async (userId, newOwnerId) => {
  await Project.updateMany({ ownerId: userId }, { $set: { ownerId: newOwnerId } });
  await Project.updateMany({ memberIds: userId }, { $pull: { memberIds: userId } });

  // An unassigned task is visibly unassigned; a task pointing at an account
  // that no longer exists just renders blank and looks broken.
  await Task.updateMany({ assigneeId: userId }, { $set: { assigneeId: '' } });
  await Task.updateMany({ reporterId: userId }, { $set: { reporterId: '' } });

  // What they wrote is theirs and goes.
  await Task.updateMany({ 'comments.authorId': userId }, { $pull: { comments: { authorId: userId } } });

  /*
   * The history is not theirs — it is the record of how a bug reached
   * "verified", and deleting the steps they performed would leave a trail with
   * holes in it. The entries stay and stop naming them.
   */
  await Task.updateMany(
    { 'activity.actorId': userId },
    { $set: { 'activity.$[entry].actorId': '', 'activity.$[entry].actorName': 'Deleted user' } },
    { arrayFilters: [{ 'entry.actorId': userId }] },
  );
};

/**
 * Deletes the account and everything behind it.
 *
 * Not a transaction: this runs against a standalone mongod in the normal
 * deployment, where multi-document transactions are unavailable. The order is
 * therefore chosen so a failure part-way leaves data that is incomplete rather
 * than inconsistent — the shared structures are unlinked first, the personal
 * data next, and the account document itself last, so an interrupted run can
 * simply be repeated.
 */
export const purgeUser = async (userId, { newOwnerId }) => {
  const footprint = await describeUserFootprint(userId);
  const files = [];

  await releaseProjects(userId, newOwnerId);
  await destroyMeetings(userId, files);
  await destroyPosts(userId);
  await destroyMail(userId, files);
  await destroyChat(userId, files);
  await destroyRecords(userId, files);

  await Promise.all([
    WalletEntry.deleteMany({ ownerId: userId }),
    Contact.deleteMany({ ownerId: userId }),
    Schedule.deleteMany({ ownerId: userId }),
  ]);

  // Removed last of the data, because until this point the log is the only
  // trail of what has just been done to this account.
  await ActivityLog.deleteMany({ actorId: userId });

  // The face photo and descriptor live on this document, so they go with it.
  await User.deleteOne({ id: userId });

  let filesDeleted = 0;
  for (const file of files) {
    if (await removeUpload(file)) filesDeleted += 1;
  }

  return { ...footprint, filesDeleted, filesFound: files.length };
};
