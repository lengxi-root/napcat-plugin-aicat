// Packet 命令处理器（仅主人可用）
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';

import {
  sendPacket,
  sendElem,
  sendLong,
  getMessagePb,
  extractSenderInfo,
  buildMessageNodes,
  jsonDumpsWithBytes,
  setPacketMode,
} from '../tools/packet-tools';
import { sendReply } from '../utils/message';

/**
 * 处理 Packet 相关命令
 * @param rawMessage 原始消息
 * @param event 消息事件
 * @param ctx 插件上下文
 * @returns 是否已处理
 */
export async function handlePacketCommands(
  rawMessage: string,
  event: OB11Message,
  ctx: NapCatPluginContext
): Promise<boolean> {
  // 去除 CQ 码前缀
  const content = rawMessage
    .replace(/\[CQ:reply,id=-?\d+\]/g, '')
    .replace(/\[CQ:at,qq=\d+\]/g, '')
    .trim();

  const groupId = event.group_id ? String(event.group_id) : undefined;

  // api{...} - 调用 OneBot API
  const apiMatch = content.match(/^(api|API)\s*(\{[\s\S]*\}|\w+[\s\S]*)$/);
  if (apiMatch) {
    await handleApiCommand(apiMatch[2], event, ctx);
    return true;
  }

  // pb{...} - 发送 ProtoBuf 元素
  const pbMatch = content.match(/^(pb|PB)\s*(\{[\s\S]*\})$/);
  if (pbMatch && groupId) {
    await handlePbCommand(pbMatch[2], groupId, event, ctx);
    return true;
  }

  // pbl{...} - 发送长消息
  const pblMatch = content.match(/^(pbl|PBL)\s*(\{[\s\S]*\})$/);
  if (pblMatch && groupId) {
    await handlePblCommand(pblMatch[2], groupId, event, ctx);
    return true;
  }

  // raw <cmd>\n{...} - 发送原始数据包
  const rawMatch = content.match(/^(raw|RAW)\s+(\S+)[\s\n]+(\{[\s\S]*\})$/);
  if (rawMatch) {
    await handleRawCommand(rawMatch[2], rawMatch[3], event, ctx);
    return true;
  }

  // 取 <seq> - 按序号获取消息
  const getBySeqMatch = content.match(/^取\s*(\d+)$/);
  if (getBySeqMatch && groupId) {
    await handleGetBySeq(getBySeqMatch[1], groupId, event, ctx);
    return true;
  }

  // 取 - 获取回复的消息
  if (content === '取' && groupId) {
    await handleGetReply(event, groupId, ctx);
    return true;
  }

  // 取上一条 - 获取上一条消息
  if (content === '取上一条' && groupId) {
    await handleGetPrevious(event, groupId, ctx);
    return true;
  }

  // 模式切换
  if (content === '模式取1') {
    setPacketMode(1);
    await sendReply(event, '✅ 已切换到模式1：平铺模式', ctx);
    return true;
  }
  if (content === '模式取2') {
    setPacketMode(2);
    await sendReply(event, '✅ 已切换到模式2：嵌套模式', ctx);
    return true;
  }

  return false;
}

/**
 * 处理 API 命令
 */
async function handleApiCommand(
  body: string,
  event: OB11Message,
  ctx: NapCatPluginContext
): Promise<void> {
  try {
    let actionName: string;
    let params: Record<string, unknown>;

    const trimmedBody = body.trim();
    if (trimmedBody.startsWith('{')) {
      const parsed = JSON.parse(trimmedBody);
      actionName = parsed.action || '';
      params = parsed.params || parsed;
      delete params.action;
    } else {
      const lines = trimmedBody.split('\n');
      actionName = lines[0].trim();
      const jsonPart = lines.slice(1).join('\n').trim();
      params = jsonPart ? JSON.parse(jsonPart) : {};
    }

    if (!actionName) {
      await sendReply(event, '❌ 缺少 action 参数', ctx);
      return;
    }

    const result = await ctx.actions.call(actionName, params as never, ctx.adapterName, ctx.pluginManager.config);
    await sendReply(event, `API 调用结果:\n${JSON.stringify(result, null, 2)}`, ctx);
  } catch (e) {
    await sendReply(event, `❌ API 调用失败: ${e}`, ctx);
  }
}

/**
 * 处理 PB 命令
 */
async function handlePbCommand(
  jsonStr: string,
  groupId: string,
  event: OB11Message,
  ctx: NapCatPluginContext
): Promise<void> {
  try {
    const elemContent = JSON.parse(jsonStr);
    const result = await sendElem(ctx.actions, ctx.adapterName, ctx.pluginManager.config, groupId, true, elemContent);
    await sendReply(event, result.success ? '✅ 发送成功' : `❌ ${result.error}`, ctx);
  } catch (e) {
    await sendReply(event, `❌ PB 发送失败: ${e}`, ctx);
  }
}

/**
 * 处理 PBL 命令
 */
async function handlePblCommand(
  jsonStr: string,
  groupId: string,
  event: OB11Message,
  ctx: NapCatPluginContext
): Promise<void> {
  try {
    const elemContent = JSON.parse(jsonStr);
    const result = await sendLong(ctx.actions, ctx.adapterName, ctx.pluginManager.config, groupId, true, elemContent);
    await sendReply(event, result.success ? '✅ 长消息发送成功' : `❌ ${result.error}`, ctx);
  } catch (e) {
    await sendReply(event, `❌ PBL 发送失败: ${e}`, ctx);
  }
}

/**
 * 处理 RAW 命令
 */
async function handleRawCommand(
  cmd: string,
  jsonStr: string,
  event: OB11Message,
  ctx: NapCatPluginContext
): Promise<void> {
  try {
    const packetContent = JSON.parse(jsonStr);
    const result = await sendPacket(ctx.actions, ctx.adapterName, ctx.pluginManager.config, cmd, packetContent);
    if (result.success) {
      await sendReply(event, `✅ 发送成功\n响应:\n${jsonDumpsWithBytes(result.data)}`, ctx);
    } else {
      await sendReply(event, `❌ ${result.error}`, ctx);
    }
  } catch (e) {
    await sendReply(event, `❌ RAW 发送失败: ${e}`, ctx);
  }
}

/**
 * 处理按序号获取消息
 */
async function handleGetBySeq(
  targetSeq: string,
  groupId: string,
  event: OB11Message,
  ctx: NapCatPluginContext
): Promise<void> {
  try {
    const result = await getMessagePb(ctx.actions, ctx.adapterName, ctx.pluginManager.config, groupId, '', targetSeq);

    if (!result.success || !result.data) {
      await sendReply(event, `❌ 未找到 Real Seq ${targetSeq} 的消息`, ctx);
      return;
    }

    const pbData = result.data as Record<number, unknown>;
    const { senderQQ, senderName } = extractSenderInfo(pbData);
    const botId = String((event as { self_id?: number }).self_id || '');

    const nodes = buildMessageNodes(botId, 'Bot', parseInt(targetSeq), senderQQ, senderName, pbData);

    await ctx.actions.call(
      'send_group_forward_msg',
      { group_id: groupId, messages: nodes } as never,
      ctx.adapterName,
      ctx.pluginManager.config
    );
  } catch (e) {
    await sendReply(event, `❌ 获取消息失败: ${e}`, ctx);
  }
}

/**
 * 处理获取回复消息
 */
async function handleGetReply(
  event: OB11Message,
  groupId: string,
  ctx: NapCatPluginContext
): Promise<void> {
  // 检查是否回复了消息
  let replyId: string | undefined;
  const message = event.message;
  if (Array.isArray(message)) {
    for (const seg of message) {
      if ((seg as { type?: string }).type === 'reply' && (seg as { data?: { id?: string } }).data?.id) {
        replyId = String((seg as { data: { id: string } }).data.id);
        break;
      }
    }
  }

  if (!replyId) {
    await sendReply(event, '请回复要获取的消息', ctx);
    return;
  }

  try {
    const msgInfo = await ctx.actions.call('get_msg', { message_id: replyId } as never, ctx.adapterName, ctx.pluginManager.config) as Record<string, unknown>;
    let msgData: Record<string, unknown> = {};
    let realSeq: string | undefined;

    if (msgInfo) {
      if (msgInfo.retcode === 0) {
        msgData = msgInfo.data as Record<string, unknown>;
        realSeq = msgData.real_seq as string;
      } else {
        msgData = msgInfo;
        realSeq = msgInfo.real_seq as string;
      }
    }

    let pbData: Record<number, unknown> | undefined;
    if (realSeq) {
      const result = await getMessagePb(ctx.actions, ctx.adapterName, ctx.pluginManager.config, groupId, replyId, realSeq);
      if (result.success) {
        pbData = result.data as Record<number, unknown>;
      }
    }

    const botId = String((event as { self_id?: number }).self_id || '');
    const sender = msgData.sender as Record<string, unknown> | undefined;
    const senderQQ = sender?.user_id ? String(sender.user_id) : null;
    const senderName = (sender?.nickname as string) || null;

    const nodes = buildMessageNodes(
      botId,
      'Bot',
      realSeq ? parseInt(realSeq) : 0,
      senderQQ,
      senderName,
      pbData || {},
      msgData.message
    );

    await ctx.actions.call(
      'send_group_forward_msg',
      { group_id: groupId, messages: nodes } as never,
      ctx.adapterName,
      ctx.pluginManager.config
    );
  } catch (e) {
    await sendReply(event, `❌ 获取消息失败: ${e}`, ctx);
  }
}

/**
 * 处理获取上一条消息
 */
async function handleGetPrevious(
  event: OB11Message,
  groupId: string,
  ctx: NapCatPluginContext
): Promise<void> {
  try {
    let targetRealSeq: number | undefined;

    // 检查是否回复了消息
    const message = event.message;
    if (Array.isArray(message)) {
      for (const seg of message) {
        if ((seg as { type?: string }).type === 'reply' && (seg as { data?: { id?: string } }).data?.id) {
          const replyId = String((seg as { data: { id: string } }).data.id);
          const msgInfo = await ctx.actions.call('get_msg', { message_id: replyId } as never, ctx.adapterName, ctx.pluginManager.config) as Record<string, unknown>;
          if (msgInfo) {
            if (msgInfo.retcode === 0) {
              targetRealSeq = parseInt((msgInfo.data as Record<string, unknown>)?.real_seq as string);
            } else {
              targetRealSeq = parseInt(msgInfo.real_seq as string);
            }
          }
          break;
        }
      }
    }

    // 如果没有回复消息，则获取当前消息的 real_seq
    if (!targetRealSeq) {
      const currentMsgId = String(event.message_id);
      const msgInfo = await ctx.actions.call('get_msg', { message_id: currentMsgId } as never, ctx.adapterName, ctx.pluginManager.config) as Record<string, unknown>;
      if (msgInfo) {
        if (msgInfo.retcode === 0) {
          targetRealSeq = parseInt((msgInfo.data as Record<string, unknown>)?.real_seq as string);
        } else {
          targetRealSeq = parseInt(msgInfo.real_seq as string);
        }
      }
    }

    if (!targetRealSeq || isNaN(targetRealSeq)) {
      await sendReply(event, '❌ 无法获取消息的 real_seq', ctx);
      return;
    }

    // 获取上一条消息
    const previousSeq = targetRealSeq - 1;
    const result = await getMessagePb(ctx.actions, ctx.adapterName, ctx.pluginManager.config, groupId, '', String(previousSeq));

    if (!result.success || !result.data) {
      await sendReply(event, '❌ 未找到上一条消息', ctx);
      return;
    }

    const pbData = result.data as Record<number, unknown>;
    const { senderQQ, senderName } = extractSenderInfo(pbData);
    const botId = String((event as { self_id?: number }).self_id || '');

    const nodes = buildMessageNodes(botId, 'Bot', previousSeq, senderQQ, senderName, pbData);

    await ctx.actions.call(
      'send_group_forward_msg',
      { group_id: groupId, messages: nodes } as never,
      ctx.adapterName,
      ctx.pluginManager.config
    );
  } catch (e) {
    await sendReply(event, `❌ 获取上一条消息失败: ${e}`, ctx);
  }
}
