import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

/*
 * Posts: announcements written by administrators and read by everyone.
 *
 * A view is a stored row rather than a counter, because the page has to show
 * not just how many people have read a post but exactly who — a number alone
 * cannot answer "has the late shift seen this yet?". The name is denormalised
 * onto the view so the list needs no join, and so a view still reads properly
 * after the account behind it is deleted.
 */
const viewSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  userName: { type: String, default: '' },
  viewedAt: { type: Date, default: Date.now },
}, { _id: false });

const postSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  title: { type: String, required: true, trim: true },
  body: { type: String, default: '' },
  authorId: { type: String, required: true, index: true },
  authorName: { type: String, default: '' },
  // Pinned posts sort above the rest; everything else is newest first.
  pinned: { type: Boolean, default: false },
  views: { type: [viewSchema], default: [] },
  // Denormalised alongside `views` so "have I seen this?" is an indexed test
  // rather than a scan of the subdocuments on every notification poll.
  viewerIds: { type: [String], default: [], index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'posts' });

export const Post = mongoose.models.Post || mongoose.model('Post', postSchema);

export const getPosts = () => Post.find().sort({ pinned: -1, createdAt: -1 });

export const getPostById = (id) => Post.findOne({ id });

export const createPost = (data) => Post.create({ id: randomUUID(), ...data });

/** The newest posts this account has not opened yet, and how many there are. */
export const getUnseenPosts = async (userId, limit = 5) => {
  const filter = { viewerIds: { $ne: userId } };
  const [posts, unseen] = await Promise.all([
    Post.find(filter).sort({ createdAt: -1 }).limit(limit),
    Post.countDocuments(filter),
  ]);
  return { posts, unseen };
};

/**
 * Records that someone opened a post, once.
 *
 * `$addToSet` on the id and a guard on the array mean a second read does not
 * add a second row, so the viewer list stays one line per person and the
 * count on the list page is the number of people rather than the number of
 * times the page was opened.
 */
export const recordPostView = (id, userId, userName) => Post.updateOne(
  { id, viewerIds: { $ne: userId } },
  {
    $addToSet: { viewerIds: userId },
    $push: { views: { userId, userName, viewedAt: new Date() } },
  },
);
