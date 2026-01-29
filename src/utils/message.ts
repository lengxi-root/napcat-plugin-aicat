// 消息发送工具函数
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message, OB11PostSendMsg } from 'napcat-types/napcat-onebot/types/index';
import { pluginState } from '../core/state';

// 消息去重缓存（防止短时间内发送相同消息）
const recentMessages = new Map<string, number>();
const DEDUP_WINDOW = 3000; // 3秒内相同消息去重

// 清理过期缓存
function cleanupRecentMessages (): void {
  const now = Date.now();
  for (const [key, time] of recentMessages) {
    if (now - time > DEDUP_WINDOW) recentMessages.delete(key);
  }
}

// 检查是否重复消息
function isDuplicateMessage (targetId: string, content: string): boolean {
  cleanupRecentMessages();
  const key = `${targetId}:${content.slice(0, 100)}`;
  const lastTime = recentMessages.get(key);
  if (lastTime && Date.now() - lastTime < DEDUP_WINDOW) {
    pluginState.debug(`消息去重: ${content.slice(0, 30)}...`);
    return true;
  }
  recentMessages.set(key, Date.now());
  return false;
}

// 发送回复消息
export async function sendReply (
  event: OB11Message,
  content: string,
  ctx: NapCatPluginContext
): Promise<void> {
  if (!ctx.actions) return;

  // 去重检查
  const targetId = event.group_id ? String(event.group_id) : String(event.user_id);
  if (isDuplicateMessage(targetId, content)) return;

  const params: OB11PostSendMsg = {
    message: content,
    message_type: event.message_type,
    ...(event.message_type === 'group' && event.group_id
      ? { group_id: String(event.group_id) }
      : {}),
    ...(event.message_type === 'private' && event.user_id
      ? { user_id: String(event.user_id) }
      : {}),
  };

  try {
    await ctx.actions.call('send_msg', params, ctx.adapterName, ctx.pluginManager.config);
  } catch (error) {
    pluginState.log('error', '发送消息失败:', error);
  }
}

// 发送长消息（超过阈值使用合并转发）
export async function sendLongMessage (
  event: OB11Message,
  content: string,
  ctx: NapCatPluginContext,
  threshold: number = 300
): Promise<void> {
  if (!ctx.actions) return;

  // 未超过阈值，直接发送
  if (content.length <= threshold) {
    await sendReply(event, content, ctx);
    return;
  }

  // 超过阈值，使用合并转发
  try {
    const groupId = event.group_id ? String(event.group_id) : null;

    // 分割文本
    const chunks = splitTextToChunks(content, 600);

    if (chunks.length <= 1) {
      await sendReply(event, content, ctx);
      return;
    }

    // 构建合并转发消息
    const botName = pluginState.config.botName || 'AI Cat';
    const forwardNodes = chunks.map(chunk => ({
      type: 'node',
      data: {
        user_id: '66600000',
        nickname: botName,
        content: [{ type: 'text', data: { text: chunk } }],
      },
    }));

    if (groupId) {
      await ctx.actions.call(
        'send_group_forward_msg',
        { group_id: groupId, messages: forwardNodes } as never,
        ctx.adapterName,
        ctx.pluginManager.config
      );
    } else {
      await ctx.actions.call(
        'send_private_forward_msg',
        { user_id: String(event.user_id), messages: forwardNodes } as never,
        ctx.adapterName,
        ctx.pluginManager.config
      );
    }
  } catch (error) {
    pluginState.log('error', '发送合并转发失败:', error);
    // 失败时直接发送原文
    await sendReply(event, content, ctx);
  }
}

// 分割文本为多个片段
export function splitTextToChunks (content: string, maxLength: number): string[] {
  const chunks: string[] = [];
  const lines = content.split('\n');
  let currentChunk = '';

  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > maxLength) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = line;
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
  }

  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
}

// 处理消息内容：去除 CQ 码前缀
export function processMessageContent (rawMessage: string): {
  content: string;
  replyMessageId?: string;
} {
  let replyMessageId: string | undefined;

  // 提取引用的消息 ID
  const replyMatch = rawMessage.match(/\[CQ:reply,id=(-?\d+)\]/);
  if (replyMatch) {
    replyMessageId = replyMatch[1];
  }

  // 去除引用和艾特前缀
  const content = rawMessage
    .replace(/\[CQ:reply,id=-?\d+\]/g, '')
    .replace(/\[CQ:at,qq=\d+\]/g, '')
    .trim();

  return { content, replyMessageId };
}

// 提取消息中的 @ 用户列表
export function extractAtUsers (message: unknown): string[] {
  const atUsers: string[] = [];

  if (!Array.isArray(message)) return atUsers;

  for (const seg of message) {
    const segment = seg as { type?: string; data?: { qq?: string | number; }; };
    if (segment.type === 'at' && segment.data?.qq && segment.data.qq !== 'all') {
      atUsers.push(String(segment.data.qq));
    }
  }

  return atUsers;
}
