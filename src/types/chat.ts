import { z } from 'zod';

export const MessageRoleSchema = z.enum(['user', 'manager', 'system', 'agent']);

export const MessageSourceSchema = z.enum(['text', 'voice']);

export const ConversationStatusSchema = z.enum(['active', 'archived', 'closed']);

export const MessageAttachmentSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['file', 'image', 'audio']),
  url: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
});

export const MessageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  role: MessageRoleSchema,
  authorId: z.string().min(1),
  content: z.string(),
  source: MessageSourceSchema,
  createdAt: z.string().datetime(),
  attachments: z.array(MessageAttachmentSchema).optional(),
});

export const ConversationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  participants: z.array(z.string().min(1)).min(1),
  messages: z.array(MessageSchema),
  status: ConversationStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type MessageRole = z.infer<typeof MessageRoleSchema>;
export type MessageSource = z.infer<typeof MessageSourceSchema>;
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;
export type MessageAttachment = z.infer<typeof MessageAttachmentSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
