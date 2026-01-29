// 消息发送工具函数
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message, OB11PostSendMsg } from 'napcat-types/napcat-onebot/types/index';
import { pluginState } from '../core/state';

const recentMsgs = new Map<string, number>();

// 发送回复消息
export async function sendReply (event: OB11Message, content: string, ctx: NapCatPluginContext): Promise<void> {
  if (!ctx.actions) return;
  const key = `${event.group_id || event.user_id}:${content.slice(0, 100)}`;
  if (recentMsgs.has(key) && Date.now() - recentMsgs.get(key)! < 3000) return;
  recentMsgs.set(key, Date.now());

  const params: OB11PostSendMsg = {
    message: content, message_type: event.message_type,
    ...(event.message_type === 'group' ? { group_id: String(event.group_id) } : { user_id: String(event.user_id) }),
  };
  await ctx.actions.call('send_msg', params, ctx.adapterName, ctx.pluginManager.config).catch(() => { });
}

// 发送长消息
export async function sendLongMessage (event: OB11Message, content: string, ctx: NapCatPluginContext, threshold = 300): Promise<void> {
  if (!ctx.actions || content.length <= threshold) { await sendReply(event, content, ctx); return; }
  const chunks = splitTextToChunks(content, 600);
  if (chunks.length <= 1) { await sendReply(event, content, ctx); return; }

  const nodes = chunks.map(c => ({ type: 'node', data: { user_id: '66600000', nickname: pluginState.config.botName || 'AI Cat', content: [{ type: 'text', data: { text: c } }] } }));
  const action = event.group_id ? 'send_group_forward_msg' : 'send_private_forward_msg';
  const param = event.group_id ? { group_id: String(event.group_id), messages: nodes } : { user_id: String(event.user_id), messages: nodes };
  await ctx.actions.call(action, param as never, ctx.adapterName, ctx.pluginManager.config).catch(() => sendReply(event, content, ctx));
}

// 分割文本
export function splitTextToChunks (content: string, maxLen: number): string[] {
  const chunks: string[] = [], lines = content.split('\n');
  let cur = '';
  for (const l of lines) {
    if (cur.length + l.length + 1 > maxLen) { if (cur) chunks.push(cur.trim()); cur = l; }
    else cur += (cur ? '\n' : '') + l;
  }
  if (cur) chunks.push(cur.trim());
  return chunks;
}

// 处理消息内容
export function processMessageContent (raw: string): { content: string; replyMessageId?: string; } {
  const match = raw.match(/\[CQ:reply,id=(-?\d+)\]/);
  return { content: raw.replace(/\[CQ:reply,id=-?\d+\]/g, '').replace(/\[CQ:at,qq=\d+\]/g, '').trim(), replyMessageId: match?.[1] };
}

// 提取@用户
export function extractAtUsers (message: unknown): string[] {
  if (!Array.isArray(message)) return [];
  return message.filter((s: { type?: string; data?: { qq?: string | number; }; }) => s.type === 'at' && s.data?.qq && s.data.qq !== 'all').map((s: { data?: { qq?: string | number; }; }) => String(s.data?.qq));
}
