import { randomUUID } from 'node:crypto';
import { ChatConversation } from '../models/chatModel.js';

const normalizeConversation = (conversation) => {
  const messages = conversation.messages || [];
  const latest = messages[messages.length - 1];

  return {
    id: conversation.id,
    name: conversation.name,
    role: conversation.role,
    avatar: conversation.avatar,
    accent: conversation.accent,
    unread: conversation.unread || 0,
    preview: latest ? latest.text : 'Start a new conversation',
    lastSeen: latest ? latest.time : 'Just now',
    messages,
  };
};

export const listConversations = async (req, res) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { ownerId: req.user.sub };
    const conversations = await ChatConversation.find(filter).sort({ createdAt: -1 });
    return res.json({ conversations: conversations.map(normalizeConversation) });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load conversations.' });
  }
};

export const createConversation = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim() || `New chat ${Date.now()}`;
    const initial = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || 'NC';
    const palette = ['#4f8ef7', '#1ab394', '#8a73ff', '#ff9f43', '#f25f7c'];

    const conversation = await ChatConversation.create({
      id: `thread-${randomUUID()}`,
      ownerId: req.user.sub,
      name,
      role: 'New conversation',
      avatar: initial,
      accent: palette[(Date.now() + Math.random()) % palette.length],
      unread: 0,
      messages: [],
    });

    return res.status(201).json({ conversation: normalizeConversation(conversation.toObject()) });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to create a conversation.' });
  }
};

export const getConversationMessages = async (req, res) => {
  const { conversationId } = req.params;
  const filter = req.user.role === 'admin' ? { id: conversationId } : { id: conversationId, ownerId: req.user.sub };

  try {
    const conversation = await ChatConversation.findOne(filter);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found.' });
    }

    return res.json({ conversation: normalizeConversation(conversation.toObject()) });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load conversation.' });
  }
};

export const sendConversationMessage = async (req, res) => {
  const { conversationId } = req.params;
  const text = String(req.body?.text || '').trim();

  if (!text) {
    return res.status(400).json({ message: 'Message text is required.' });
  }

  const filter = req.user.role === 'admin' ? { id: conversationId } : { id: conversationId, ownerId: req.user.sub };

  try {
    const conversation = await ChatConversation.findOne(filter);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found.' });
    }

    const message = {
      id: randomUUID(),
      sender: 'me',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: new Date(),
    };

    conversation.messages.push(message);
    conversation.unread = 0;
    await conversation.save();

    return res.status(201).json({
      message,
      conversation: normalizeConversation(conversation.toObject()),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to send message.' });
  }
};
