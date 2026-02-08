// 消息发送工具函数
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message, OB11PostSendMsg } from 'napcat-types/napcat-onebot/types/index';
import { pluginState } from '../core/state';

// 去重缓存（自动清理，防止内存泄漏）
const recentMsgs = new Map<string, number>();
const DEDUP_TTL = 3000;
const CLEANUP_INTERVAL = 30000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startMessageCleanup (): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, t] of recentMsgs) { if (now - t > DEDUP_TTL) recentMsgs.delete(k); }
  }, CLEANUP_INTERVAL);
}

export function stopMessageCleanup (): void {
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
  recentMsgs.clear();
}

// 发送回复消息
export async function sendReply (event: OB11Message, content: string, ctx: NapCatPluginContext): Promise<void> {
  if (!ctx.actions) return;
  const key = `${event.group_id || event.user_id}:${content.slice(0, 100)}`;
  if (recentMsgs.has(key) && Date.now() - recentMsgs.get(key)! < DEDUP_TTL) return;
  recentMsgs.set(key, Date.now());

  const params: OB11PostSendMsg = {
    message: content, message_type: event.message_type,
    ...(event.message_type === 'group' ? { group_id: String(event.group_id) } : { user_id: String(event.user_id) }),
  };
  await ctx.actions.call('send_msg', params, ctx.adapterName, ctx.pluginManager.config).catch(() => { });
}

// 创建文本节点
function createTextNode (text: string, nickname?: string): unknown {
  return {
    type: 'node',
    data: {
      user_id: 66600000,
      nickname: nickname || pluginState.config.botName || 'AI Cat',
      content: [{ type: 'text', data: { text } }],
    },
  };
}

// 构建转发消息 action 和 params（复用逻辑）
function buildForwardCall (event: OB11Message, messages: unknown[]): { action: string; param: Record<string, unknown> } {
  const isGroup = !!event.group_id;
  return {
    action: isGroup ? 'send_group_forward_msg' : 'send_private_forward_msg',
    param: isGroup ? { group_id: String(event.group_id), messages } : { user_id: String(event.user_id), messages },
  };
}

// 发送合并转发（统一入口）
async function callForward (event: OB11Message, messages: unknown[], ctx: NapCatPluginContext, fallback?: () => Promise<void>): Promise<void> {
  if (!ctx.actions) return;
  const { action, param } = buildForwardCall(event, messages);
  await ctx.actions.call(action, param as never, ctx.adapterName, ctx.pluginManager.config).catch(() => fallback?.());
}

// 检查是否需要使用合并转发（超过400字或25行）
function needsForwardMessage (content: string): boolean {
  return content.length > 400 || content.split('\n').length > 25;
}

// 发送长消息（超过阈值时自动使用合并转发）
export async function sendLongMessage (event: OB11Message, content: string, ctx: NapCatPluginContext, isForward = false): Promise<void> {
  if (isForward || !needsForwardMessage(content)) { await sendReply(event, content, ctx); return; }
  const nodes = splitTextToChunks(content, 600).map(c => createTextNode(c));
  await callForward(event, nodes, ctx, () => sendReply(event, content, ctx));
}

// 发送嵌套合并转发消息（双层嵌套）
export async function sendNestedForward (event: OB11Message, title: string, sections: { title: string; content: string; }[], ctx: NapCatPluginContext): Promise<void> {
  const innerNodes = sections.map(s => createTextNode(s.content, s.title));
  const outerNode = { type: 'node', data: { user_id: 66600000, nickname: title || pluginState.config.botName || 'AI Cat', content: innerNodes } };
  await callForward(event, [outerNode], ctx);
}

// 发送单层合并转发消息
export async function sendForwardMsg (event: OB11Message, sections: { title: string; content: string; }[], ctx: NapCatPluginContext): Promise<void> {
  await callForward(event, sections.map(s => createTextNode(s.content, s.title)), ctx);
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

// 提取@用户（排除机器人自身和@全体成员）
export function extractAtUsers (message: unknown, selfId?: string): string[] {
  if (!Array.isArray(message)) return [];
  return message
    .filter((s: { type?: string; data?: { qq?: string | number; }; }) =>
      s.type === 'at' && s.data?.qq && s.data.qq !== 'all' && (!selfId || String(s.data.qq) !== selfId))
    .map((s: { data?: { qq?: string | number; }; }) => String(s.data?.qq));
}
