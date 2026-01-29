// 命令处理器
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';

import { pluginState } from '../core/state';
import { MODEL_LIST } from '../config';
import { contextManager } from '../managers/context-manager';
import {
  isOwner,
  startOwnerVerification,
  verifyOwnerCode,
  removeOwner,
  listOwners,
} from '../managers/owner-manager';
import { userWatcherManager } from '../managers/user-watcher';
import { sendReply } from '../utils/message';
import { handleAICommand } from './ai-handler';

// 处理帮助命令
export async function handleHelp (
  event: OB11Message,
  userId: string,
  ctx: NapCatPluginContext
): Promise<void> {
  const isMaster = isOwner(userId);
  const prefix = pluginState.config.prefix || 'xy';
  const botName = pluginState.config.botName || '汐雨';

  let helpText = `🐱 ${botName}猫娘助手 v1.0.0 (NapCat)
【基础指令】
${prefix} <内容> - 与AI对话
${prefix} 帮助 - 显示帮助
${prefix} 上下文 - 查看对话状态
${prefix} 清除上下文 - 清除对话历史
${prefix} 检测器列表 - 查看所有检测器

【主人申请】
${prefix} 设置主人 - 申请成为主人（验证码输出到日志）
${prefix} 验证主人 <验证码> - 验证身份`;

  if (isMaster) {
    helpText += `

【主人管理】
${prefix} 主人列表 - 查看所有主人
${prefix} 移除主人 <QQ号> - 移除主人
${prefix} 模型列表 - 查看可用AI模型
${prefix} 切换模型 <数字> - 切换AI模型

【Packet 调试】
取 - 获取引用消息的详细数据
取 <seq> - 按 Real Seq 获取消息
取上一条 - 获取上一条消息详情
模式取1 - 切换到平铺模式
模式取2 - 切换到嵌套模式
api <action>\\n{params} - 调用OneBot
pb{...} - 发送 ProtoBuf 元素
pbl{...} - 发送长消息
raw <cmd>\\n{...} - 发送数据包`;
  }

  helpText += `\n\n当前前缀: ${prefix} | 当前模型: ${pluginState.currentModel}`;
  await sendReply(event, helpText, ctx);
}

/**
 * 处理模型列表命令
 */
export async function handleListModels (
  event: OB11Message,
  ctx: NapCatPluginContext
): Promise<void> {
  const lines = ['🐱 可用模型列表喵～\n'];
  for (let i = 0; i < MODEL_LIST.length; i++) {
    const mark = MODEL_LIST[i] === pluginState.currentModel ? ' ← 当前' : '';
    lines.push(`${i + 1}. ${MODEL_LIST[i]}${mark}`);
  }
  lines.push('\n使用 xy切换模型<数字> 切换喵～');
  await sendReply(event, lines.join('\n'), ctx);
}

/**
 * 处理切换模型命令
 */
export async function handleSwitchModel (
  event: OB11Message,
  indexStr: string | undefined,
  ctx: NapCatPluginContext
): Promise<void> {
  if (!indexStr) {
    await handleListModels(event, ctx);
    return;
  }

  const idx = parseInt(indexStr);
  if (idx >= 1 && idx <= MODEL_LIST.length) {
    pluginState.currentModel = MODEL_LIST[idx - 1];
    await sendReply(event, `✅ 模型已切换为 ${pluginState.currentModel} 喵～`, ctx);
  } else {
    await sendReply(event, `❌ 无效的序号喵，请输入 1-${MODEL_LIST.length}`, ctx);
  }
}

/**
 * 处理主命令入口
 * @returns 是否已处理该命令
 */
export async function handleCommand (
  event: OB11Message,
  command: string,
  ctx: NapCatPluginContext,
  replyMessageId?: string
): Promise<boolean> {
  const userId = String(event.user_id);
  const groupId = event.group_id ? String(event.group_id) : undefined;
  const prefix = pluginState.config.prefix || 'xy';

  // 帮助命令
  if (command === '帮助' || command === '') {
    await handleHelp(event, userId, ctx);
    return true;
  }

  // 清除上下文
  if (command === '清除上下文') {
    contextManager.clearContext(userId, groupId);
    await sendReply(event, '✅ 上下文已清除喵～', ctx);
    return true;
  }

  // 查看上下文
  if (command === '上下文') {
    const info = contextManager.getContextInfo(userId, groupId);
    if (info.expired || info.messages === 0) {
      await sendReply(event, '📝 当前没有活跃的上下文喵～', ctx);
    } else {
      await sendReply(event, `📝 对话轮数: ${info.turns} | 消息数: ${info.messages}`, ctx);
    }
    return true;
  }

  // 模型列表（仅主人）
  if (command === '模型列表' && isOwner(userId)) {
    await handleListModels(event, ctx);
    return true;
  }

  // 切换模型（仅主人）
  const switchMatch = command.match(/^切换模型\s*(\d+)?$/);
  if (switchMatch && isOwner(userId)) {
    await handleSwitchModel(event, switchMatch[1], ctx);
    return true;
  }

  // 检测器列表（仅主人）
  if (command === '检测器列表' && isOwner(userId)) {
    const result = userWatcherManager.listWatchers();
    const watchers = (result.data as { id: string; target_user: string; action: string; enabled: boolean; trigger_count: number; }[]) || [];

    if (watchers.length === 0) {
      await sendReply(event, '📋 暂无用户检测器喵～', ctx);
    } else {
      const lines = [`📋 用户检测器列表 (${watchers.length}个)：\n`];
      for (const w of watchers) {
        const status = w.enabled ? '✅' : '❌';
        lines.push(`${status} ${w.id}: 监控${w.target_user} -> ${w.action} (触发${w.trigger_count}次)`);
      }
      await sendReply(event, lines.join('\n'), ctx);
    }
    return true;
  }

  // 设置主人 - 任何人都可以申请
  if (command === '设置主人') {
    const result = startOwnerVerification(userId);
    await sendReply(event, result.message, ctx);
    return true;
  }

  // 验证主人 - 输入验证码
  const verifyMatch = command.match(/^验证主人\s+(\S+)$/);
  if (verifyMatch) {
    const inputCode = verifyMatch[1];
    const result = verifyOwnerCode(userId, inputCode);
    await sendReply(event, result.message, ctx);
    return true;
  }

  // 主人列表 - 仅主人可查看
  if (command === '主人列表' && isOwner(userId)) {
    const owners = listOwners();
    const lines = [
      `👑 主人列表 (共${owners.total}人)：`,
      '',
      '【初始主人】',
      ...owners.default.map(id => `  • ${id}`),
    ];
    if (owners.dynamic.length > 0) {
      lines.push('', '【动态添加】');
      lines.push(...owners.dynamic.map(id => `  • ${id}`));
    }
    await sendReply(event, lines.join('\n'), ctx);
    return true;
  }

  // 移除主人 - 仅初始主人可操作
  const removeOwnerMatch = command.match(/^移除主人\s+(\d+)$/);
  if (removeOwnerMatch && isOwner(userId)) {
    const targetId = removeOwnerMatch[1];
    const result = removeOwner(userId, targetId);
    await sendReply(event, result.message, ctx);
    return true;
  }

  // AI 命令处理
  if (command) {
    await handleAICommand(event, command, ctx, replyMessageId);
    return true;
  }

  return false;
}
