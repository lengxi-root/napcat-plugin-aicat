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

// 创建嵌套合并转发消息
function createNestedForward (title: string, innerNodes: unknown[]): unknown {
  const botName = pluginState.config.botName || 'AI Cat';
  return {
    type: 'node',
    data: {
      user_id: 66600000,
      nickname: title || botName,
      content: innerNodes,
    },
  };
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

// 检查是否需要使用合并转发（超过400字或25行）
function needsForwardMessage (content: string): boolean {
  const charLimit = 400;
  const lineLimit = 25;
  const lineCount = content.split('\n').length;
  return content.length > charLimit || lineCount > lineLimit;
}

// 发送长消息（超过400字或25行时使用单层合并转发）
export async function sendLongMessage (event: OB11Message, content: string, ctx: NapCatPluginContext, isForward = false): Promise<void> {
  if (!ctx.actions) return;
  // 已经是合并转发消息或不需要转发，直接发送
  if (isForward || !needsForwardMessage(content)) { await sendReply(event, content, ctx); return; }

  const chunks = splitTextToChunks(content, 600);
  // 单层节点：直接作为消息列表发送
  const nodes = chunks.map(c => createTextNode(c));

  const action = event.group_id ? 'send_group_forward_msg' : 'send_private_forward_msg';
  const param = event.group_id ? { group_id: String(event.group_id), messages: nodes } : { user_id: String(event.user_id), messages: nodes };
  await ctx.actions.call(action, param as never, ctx.adapterName, ctx.pluginManager.config).catch(() => sendReply(event, content, ctx));
}

// 发送嵌套合并转发消息（双层嵌套）
export async function sendNestedForward (event: OB11Message, title: string, sections: { title: string; content: string; }[], ctx: NapCatPluginContext): Promise<void> {
  if (!ctx.actions) return;

  // 内层节点：各个分组
  const innerNodes = sections.map(s => createTextNode(s.content, s.title));
  // 外层嵌套：包裹内层节点
  const outerNode = createNestedForward(title, innerNodes);

  const action = event.group_id ? 'send_group_forward_msg' : 'send_private_forward_msg';
  const param = event.group_id ? { group_id: String(event.group_id), messages: [outerNode] } : { user_id: String(event.user_id), messages: [outerNode] };
  await ctx.actions.call(action, param as never, ctx.adapterName, ctx.pluginManager.config).catch(() => { });
}

// 发送单层合并转发消息
export async function sendForwardMsg (event: OB11Message, sections: { title: string; content: string; }[], ctx: NapCatPluginContext): Promise<void> {
  if (!ctx.actions) return;

  // 单层节点：直接作为消息列表
  const nodes = sections.map(s => createTextNode(s.content, s.title));

  const action = event.group_id ? 'send_group_forward_msg' : 'send_private_forward_msg';
  const param = event.group_id ? { group_id: String(event.group_id), messages: nodes } : { user_id: String(event.user_id), messages: nodes };
  await ctx.actions.call(action, param as never, ctx.adapterName, ctx.pluginManager.config).catch(() => { });
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
