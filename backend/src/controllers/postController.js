import {
  Post,
  createPost,
  getPostById,
  getPosts,
  getUnseenPosts,
  recordPostView,
} from '../models/postModel.js';
import { getUserById } from '../models/userModel.js';
import { writeLog } from '../models/activityLogModel.js';

const MAX_TITLE = 160;
const MAX_BODY = 200_000;

const asPlain = (document) => (document?.toObject ? document.toObject() : document);

/**
 * A post as the browser sees it.
 *
 * `viewers` is the whole list, newest first: the requirement is not only how
 * many people have read a post but exactly who, and the list page offers that
 * without a second request. `viewedByMe` is what the notification count is
 * built from.
 */
const describePost = (post, userId) => {
  const plain = asPlain(post);
  const viewers = [...(plain.views || [])].sort((a, b) => new Date(b.viewedAt) - new Date(a.viewedAt));

  return {
    id: plain.id,
    title: plain.title,
    body: plain.body,
    authorId: plain.authorId,
    authorName: plain.authorName,
    pinned: Boolean(plain.pinned),
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
    viewCount: viewers.length,
    viewers,
    viewedByMe: (plain.viewerIds || []).includes(userId),
  };
};

const postFields = (body = {}) => ({
  title: String(body.title || '').trim().slice(0, MAX_TITLE),
  body: String(body.body || '').slice(0, MAX_BODY),
  pinned: body.pinned === true || body.pinned === 'true',
});

const validate = (post) => {
  if (!post.title) return 'A post needs a title.';
  // The body is written in the rich editor, so an "empty" one still carries
  // markup; the tags are stripped before deciding it says nothing.
  if (!post.body.replace(/<[^>]*>/g, '').trim()) return 'A post needs some content.';
  return '';
};

export const listPosts = async (req, res) => {
  const posts = await getPosts();
  return res.json({ posts: posts.map((post) => describePost(post, req.user.sub)) });
};

/**
 * GET /posts/notifications?limit=5
 *
 * What the bell shows: the newest posts this account has not opened, and how
 * many there are in total. The count falls as posts are read, which is what
 * makes it a notification rather than a badge that only ever grows.
 */
export const listNotifications = async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 20);
  const { posts, unseen } = await getUnseenPosts(req.user.sub, limit);

  return res.json({
    unseen,
    posts: posts.map((post) => {
      const plain = asPlain(post);
      return {
        id: plain.id,
        title: plain.title,
        authorName: plain.authorName,
        createdAt: plain.createdAt,
      };
    }),
  });
};

export const getPost = async (req, res) => {
  const post = await getPostById(req.params.id);
  if (!post) return res.status(404).json({ message: 'Post not found.' });

  return res.json({ post: describePost(post, req.user.sub) });
};

/**
 * POST /posts/:id/view
 *
 * Opening a post is what marks it read, and it is a write, so it is its own
 * request rather than a side effect of the GET: a list page that prefetched
 * bodies would otherwise mark everything read without anyone reading it.
 */
export const markPostViewed = async (req, res) => {
  const post = await getPostById(req.params.id);
  if (!post) return res.status(404).json({ message: 'Post not found.' });

  const me = await getUserById(req.user.sub);
  await recordPostView(post.id, req.user.sub, me?.fullName || req.user.username || '');

  const updated = await getPostById(post.id);
  return res.json({ post: describePost(updated, req.user.sub) });
};

export const createPostRecord = async (req, res) => {
  const fields = postFields(req.body);
  const error = validate(fields);
  if (error) return res.status(400).json({ message: error });

  const me = await getUserById(req.user.sub);
  const created = await createPost({
    ...fields,
    authorId: req.user.sub,
    authorName: me?.fullName || req.user.username || '',
  });

  await writeLog({
    source: 'posts',
    action: 'post:create',
    message: `Published "${fields.title}"`,
    actor: { id: req.user.sub, username: req.user.username },
  });

  return res.status(201).json({ post: describePost(created, req.user.sub) });
};

export const updatePost = async (req, res) => {
  const post = await getPostById(req.params.id);
  if (!post) return res.status(404).json({ message: 'Post not found.' });

  const fields = postFields(req.body);
  const error = validate(fields);
  if (error) return res.status(400).json({ message: error });

  Object.assign(post, fields, { updatedAt: new Date() });
  await post.save();

  return res.json({ post: describePost(post, req.user.sub) });
};

export const deletePost = async (req, res) => {
  const post = await getPostById(req.params.id);
  if (!post) return res.status(404).json({ message: 'Post not found.' });

  await post.deleteOne();

  await writeLog({
    source: 'posts',
    action: 'post:delete',
    message: `Deleted "${post.title}"`,
    actor: { id: req.user.sub, username: req.user.username },
  });

  return res.json({ ok: true });
};
