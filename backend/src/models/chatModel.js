import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

const chatMessageSchema = new mongoose.Schema({
  id: { type: String, required: true, default: () => randomUUID() },
  sender: { type: String, enum: ['me', 'other'], default: 'me' },
  text: { type: String, default: '' },
  time: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true, default: () => randomUUID() },
  ownerId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  role: { type: String, default: 'New conversation' },
  avatar: { type: String, default: 'NC' },
  accent: { type: String, default: '#4f8ef7' },
  unread: { type: Number, default: 0 },
  messages: [chatMessageSchema],
  createdAt: { type: Date, default: Date.now },
}, { collection: 'chat_conversations' });

export const ChatConversation = mongoose.models.ChatConversation || mongoose.model('ChatConversation', conversationSchema);
