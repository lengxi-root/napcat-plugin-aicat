// 命令处理器
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import { pluginState } from '../core/state';
import { MODEL_LIST, PLUGIN_VERSION } from '../config';
import { contextManager } from '../managers/context-manager';
import { isOwner, startOwnerVerification, verifyOwnerCode, removeOwner, listOwners } from '../managers/owner-manager';
import { userWatcherManager } from '../managers/user-watcher';
import { sendReply, sendForwardMsg } from '../utils/message';
import { handleAICommand } from './ai-handler';

// 帮助信息
async function handleHelp (event: OB11Message, userId: string, ctx: NapCatPluginContext): Promise<void> {
  const isMaster = isOwner(userId);
  const prefix = pluginState.config.prefix || 'xy';
  const name = pluginState.config.botName || '汐雨';
  const currentModel = pluginState.config.model || 'gpt-5';

  const sections: { title: string; content: string; }[] = [
    { title: `🐱 ${name}猫娘助手 v${PLUGIN_VERSION}`, content: '欢迎使用喵～' },
    {
      title: '📌 基础指令',
      content: [
        `${prefix} <内容> - AI对话`,
        `${prefix} 帮助 - 显示帮助`,
        `${prefix} 上下文 - 对话状态`,
        `${prefix} 清除上下文 - 清除历史`,
        `${prefix} 检测器列表 - 查看检测器`,
        `${prefix} AI状态 - 查看本群AI开关`,
      ].join('\n'),
    },
    {
      title: '👑 主人申请',
      content: `${prefix} 设置主人 - 申请成为主人\n${prefix} 验证主人 <验证码> - 验证身份`,
    },
  ];

  if (isMaster) {
    sections.push({
      title: '🔧 主人管理',
      content: [
        `${prefix} 主人列表 - 查看所有主人`,
        `${prefix} 移除主人 <QQ号> - 移除主人`,
        `${prefix} 模型列表 - 查看AI模型`,
        `${prefix} 切换模型 <数字> - 切换模型`,
        `${prefix} 开启AI - 开启本群AI对话`,
        `${prefix} 关闭AI - 关闭本群AI对话`,
      ].join('\n'),
    });
    sections.push({
      title: '🔬 Packet调试',
      content: '取 - 获取引用消息详情\napi <action>\\n{params} - 调用OneBot',
    });
  }

  sections.push({ title: '⚙️ 当前状态', content: `前缀: ${prefix}\n模型: ${currentModel}` });

  await sendForwardMsg(event, sections, ctx);
}

// 模型列表
async function handleListModels (event: OB11Message, ctx: NapCatPluginContext): Promise<void> {
  const currentModel = pluginState.config.model || 'gpt-5';
  const lines = ['🐱 可用模型列表喵～\n'];
  MODEL_LIST.forEach((m, i) => lines.push(`${i + 1}. ${m}${m === currentModel ? ' ← 当前' : ''}`));
  lines.push('\n使用 xy切换模型<数字> 切换喵～');
  await sendReply(event, lines.join('\n'), ctx);
}

// 切换模型
async function handleSwitchModel (event: OB11Message, idx: string | undefined, ctx: NapCatPluginContext): Promise<void> {
  if (!idx) {
    await handleListModels(event, ctx);
    return;
  }
  const i = parseInt(idx);
  if (i >= 1 && i <= MODEL_LIST.length) {
    pluginState.config.model = MODEL_LIST[i - 1];
    await sendReply(event, `✅ 模型已切换为 ${pluginState.config.model} 喵～`, ctx);
  } else {
    await sendReply(event, `❌ 无效序号，请输入1-${MODEL_LIST.length}`, ctx);
  }
}

// 主命令入口
export async function handleCommand (
  event: OB11Message,
  cmd: string,
  ctx: NapCatPluginContext,
  replyMsgId?: string
): Promise<boolean> {
  const userId = String(event.user_id);
  const groupId = event.group_id ? String(event.group_id) : undefined;

  // 基础命令
  if (cmd === '帮助' || cmd === '') {
    await handleHelp(event, userId, ctx);
    return true;
  }

  if (cmd === '清除上下文') {
    contextManager.clearContext(userId, groupId);
    await sendReply(event, '✅ 上下文已清除喵～', ctx);
    return true;
  }

  if (cmd === '上下文') {
    const info = contextManager.getContextInfo(userId, groupId);
    const msg = info.expired || info.messages === 0
      ? '📝 当前没有活跃上下文喵～'
      : `📝 对话轮数: ${info.turns} | 消息数: ${info.messages}`;
    await sendReply(event, msg, ctx);
    return true;
  }

  // 主人命令
  if (cmd === '模型列表' && isOwner(userId)) {
    await handleListModels(event, ctx);
    return true;
  }

  const switchMatch = cmd.match(/^切换模型\s*(\d+)?$/);
  if (switchMatch && isOwner(userId)) {
    await handleSwitchModel(event, switchMatch[1], ctx);
    return true;
  }

  if (cmd === '检测器列表' && isOwner(userId)) {
    const result = userWatcherManager.listWatchers();
    const watchers = (result.data as { id: string; target_user: string; action: string; enabled: boolean; trigger_count: number; }[]) || [];
    if (!watchers.length) {
      await sendReply(event, '📋 暂无用户检测器喵～', ctx);
    } else {
      const list = watchers.map(w =>
        `${w.enabled ? '✅' : '❌'} ${w.id}: 监控${w.target_user} -> ${w.action} (触发${w.trigger_count}次)`
      ).join('\n');
      await sendReply(event, `📋 用户检测器列表 (${watchers.length}个)：\n${list}`, ctx);
    }
    return true;
  }

  // 主人验证
  if (cmd === '设置主人') {
    await sendReply(event, startOwnerVerification(userId).message, ctx);
    return true;
  }

  const verifyMatch = cmd.match(/^验证主人\s+(\S+)$/);
  if (verifyMatch) {
    await sendReply(event, verifyOwnerCode(userId, verifyMatch[1]).message, ctx);
    return true;
  }

  if (cmd === '主人列表' && isOwner(userId)) {
    const owners = listOwners();
    const dynamicPart = owners.dynamic.length
      ? '\n\n【动态添加】\n' + owners.dynamic.map(id => `  • ${id}`).join('\n')
      : '';
    await sendReply(event, `👑 主人列表 (共${owners.total}人)：\n\n【初始主人】\n${owners.default.map(id => `  • ${id}`).join('\n')}${dynamicPart}`, ctx);
    return true;
  }

  const removeMatch = cmd.match(/^移除主人\s+(\d+)$/);
  if (removeMatch && isOwner(userId)) {
    await sendReply(event, removeOwner(userId, removeMatch[1]).message, ctx);
    return true;
  }

  // 群AI开关（主人命令，仅群聊可用）
  if (cmd === '开启AI' && isOwner(userId)) {
    if (!groupId) { await sendReply(event, '❌ 该指令仅在群聊中可用喵～', ctx); return true; }
    pluginState.setGroupAI(groupId, true);
    await sendReply(event, `✅ 本群(${groupId})AI对话已开启喵～`, ctx);
    return true;
  }

  if (cmd === '关闭AI' && isOwner(userId)) {
    if (!groupId) { await sendReply(event, '❌ 该指令仅在群聊中可用喵～', ctx); return true; }
    pluginState.setGroupAI(groupId, false);
    await sendReply(event, `✅ 本群(${groupId})AI对话已关闭喵～`, ctx);
    return true;
  }

  if (cmd === 'AI状态') {
    if (!groupId) { await sendReply(event, '📝 私聊AI对话始终开启喵～', ctx); return true; }
    const disabled = pluginState.isGroupAIDisabled(groupId);
    await sendReply(event, `📝 本群AI对话状态: ${disabled ? '❌ 已关闭' : '✅ 已开启'}`, ctx);
    return true;
  }

  // AI 对话
  if (cmd) {
    await handleAICommand(event, cmd, ctx, replyMsgId);
    return true;
  }

  return false;
}
