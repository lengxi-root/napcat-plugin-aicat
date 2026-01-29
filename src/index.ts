// NapCat AI Cat 插件 - 智能猫娘群管助手

import type { PluginModule, NapCatPluginContext, PluginConfigSchema } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import { EventType } from 'napcat-types/napcat-onebot/event/index';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import type { PluginConfig } from './types';
import { DEFAULT_PLUGIN_CONFIG, MODEL_LIST } from './config';
import { pluginState } from './core/state';
import { handleCommand } from './handlers/command-handler';
import { handlePacketCommands } from './handlers/packet-handler';
import { processMessageContent, sendReply } from './utils/message';
import { executeApiTool } from './tools/api-tools';
import { isOwner, initOwnerDataDir, cleanupExpiredVerifications, setNapCatLogger, setConfigOwners } from './managers/owner-manager';
import { commandManager, initDataDir } from './managers/custom-commands';
import { taskManager, initTasksDataDir } from './managers/scheduled-tasks';
import { userWatcherManager, initWatchersDataDir } from './managers/user-watcher';
import { initMessageLogger, logMessage, cleanupOldMessages, closeMessageLogger, getStorageType } from './managers/message-logger';
import type { NetworkAdapterConfig } from 'napcat-types/napcat-onebot/config/config';

// 获取当前插件文件所在目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export let plugin_config_ui: PluginConfigSchema = [];

// 插件初始化
const plugin_init: PluginModule['plugin_init'] = async (ctx: NapCatPluginContext) => {
  // 初始化状态
  pluginState.logger = ctx.logger;
  pluginState.actions = ctx.actions;
  pluginState.adapterName = ctx.adapterName;
  pluginState.networkConfig = ctx.pluginManager.config;

  pluginState.log('info', 'AI Cat 插件正在初始化喵～');

  // 初始化配置 UI
  plugin_config_ui = ctx.NapCatConfig.combine(
    ctx.NapCatConfig.html('<div style="padding: 10px; background: rgba(0,0,0,0.05); border-radius: 8px;"><h3>🐱 AI Cat 插件配置</h3><p>智能猫娘助手 - xy 帮助可以查看所有指令</p><p style="margin-top: 8px; color: #666;">💬 加入交流群: 631348711</p></div>'),
    ctx.NapCatConfig.text('prefix', '指令前缀', 'xy', '触发 AI 对话的指令前缀，如 xy、ai 等'),
    ctx.NapCatConfig.boolean('enableReply', '启用回复', true, '是否启用消息回复功能'),
    ctx.NapCatConfig.text('botName', '机器人名称', '汐雨', '机器人的显示名称'),
    ctx.NapCatConfig.text('confirmMessage', '确认消息', '汐雨收到喵～', '收到指令后的确认回复'),
    ctx.NapCatConfig.text('ownerQQs', '主人QQ', '', '主人QQ号列表，多个用逗号分隔（如：123456,789012）'),
    ctx.NapCatConfig.select('model', 'AI 模型', MODEL_LIST.map(m => ({ label: m, value: m })), 'gpt-5', '选择 AI 对话使用的模型'),
    ctx.NapCatConfig.select('maxContextTurns', '最大上下文轮数', [
      { label: '5 轮', value: 5 },
      { label: '10 轮', value: 10 },
      { label: '15 轮', value: 15 },
      { label: '20 轮', value: 20 },
    ], 10, '保留的对话上下文轮数'),
    ctx.NapCatConfig.boolean('debug', '调试模式', false, '开启后显示详细的调试日志')
  );

  // 加载已保存的配置
  try {
    if (fs.existsSync(ctx.configPath)) {
      const savedConfig = JSON.parse(fs.readFileSync(ctx.configPath, 'utf-8'));
      pluginState.config = { ...DEFAULT_PLUGIN_CONFIG, ...savedConfig };
      pluginState.log('info', `配置已加载，指令前缀: ${pluginState.config.prefix}`);
    }
  } catch (e) {
    pluginState.log('warn', '加载配置失败，使用默认配置');
  }

  // 设置当前模型
  if (pluginState.config.model) {
    pluginState.currentModel = pluginState.config.model;
    pluginState.log('info', `AI 模型: ${pluginState.currentModel}`);
  }

  // 设置配置中的主人QQ
  if (pluginState.config.ownerQQs) {
    setConfigOwners(pluginState.config.ownerQQs);
    pluginState.log('info', `主人QQ已设置: ${pluginState.config.ownerQQs}`);
  }

  // 设置 NapCat 日志器
  try {
    if (ctx.logger && typeof ctx.logger.info === 'function') {
      setNapCatLogger((msg: string) => ctx.logger?.info(msg));
    }
  } catch {
    // 静默失败
  }

  // 初始化数据目录（ctx.configPath 所在目录即为 data 目录）
  const pluginDataPath = ctx.configPath
    ? dirname(ctx.configPath)
    : join(__dirname, '..', 'data');

  initDataDir(pluginDataPath);
  initTasksDataDir(pluginDataPath);
  initWatchersDataDir(pluginDataPath);
  initOwnerDataDir(pluginDataPath);

  // 初始化消息日志记录器（data/log 目录）
  await initMessageLogger(pluginDataPath);

  // 启动验证码清理定时器
  pluginState.setVerificationCleanupInterval(
    setInterval(() => cleanupExpiredVerifications(), 60000)
  );

  // 每天清理旧消息
  setInterval(() => {
    const deleted = cleanupOldMessages(7);
    if (deleted > 0) {
      pluginState.log('info', `已清理 ${deleted} 条过期消息`);
    }
  }, 24 * 60 * 60 * 1000);

  // 设置定时任务消息发送器
  taskManager.setMessageSender(async (targetType, targetId, content) => {
    if (!pluginState.actions || !pluginState.networkConfig) return;
    const message = taskManager.parseMessageContent(content);
    try {
      if (targetType === 'group') {
        await pluginState.actions.call('send_group_msg', { group_id: targetId, message } as never, pluginState.adapterName, pluginState.networkConfig);
      } else {
        await pluginState.actions.call('send_private_msg', { user_id: targetId, message } as never, pluginState.adapterName, pluginState.networkConfig);
      }
    } catch (error) {
      pluginState.log('error', '定时任务发送消息失败:', error);
    }
  });

  // 设置用户检测器 API 调用器
  userWatcherManager.setApiCaller(async (action, params) => {
    if (!pluginState.actions || !pluginState.networkConfig) {
      return { success: false, error: 'actions 未初始化' };
    }
    return executeApiTool(pluginState.actions, pluginState.adapterName, pluginState.networkConfig, { action, params });
  });

  // 启动定时任务调度器
  taskManager.startScheduler();

  pluginState.log('info', 'AI Cat 插件初始化完成喵～');
};

/**
 * 获取配置
 */
export const plugin_get_config = async (): Promise<PluginConfig> => {
  return pluginState.config;
};

/**
 * 保存配置
 */
export const plugin_set_config = async (ctx: NapCatPluginContext, config: PluginConfig): Promise<void> => {
  pluginState.config = config;

  // 更新主人QQ列表
  if (config.ownerQQs !== undefined) {
    setConfigOwners(config.ownerQQs);
    pluginState.log('info', `主人QQ已更新: ${config.ownerQQs}`);
  }

  // 更新 AI 模型
  if (config.model) {
    pluginState.currentModel = config.model;
    pluginState.log('info', `AI 模型已更新: ${config.model}`);
  }

  // 保存到文件
  if (ctx?.configPath) {
    try {
      const configDir = path.dirname(ctx.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(ctx.configPath, JSON.stringify(config, null, 2), 'utf-8');
      pluginState.log('info', `配置已保存，新前缀: ${config.prefix}`);
    } catch (e) {
      pluginState.log('error', '保存配置失败');
      throw e;
    }
  }
};

/**
 * 插件清理
 */
const plugin_cleanup: PluginModule['plugin_cleanup'] = async (_ctx: NapCatPluginContext) => {
  pluginState.log('info', 'AI Cat 插件正在卸载喵～');
  taskManager.stopScheduler();
  pluginState.clearVerificationCleanupInterval();
  closeMessageLogger();
};

/**
 * 消息处理
 */
const plugin_onmessage: PluginModule['plugin_onmessage'] = async (ctx: NapCatPluginContext, event: OB11Message) => {
  if (event.post_type !== EventType.MESSAGE) return;

  const rawMessage = event.raw_message || '';
  const userId = String(event.user_id);
  const groupId = event.group_id ? String(event.group_id) : undefined;
  const messageId = String(event.message_id);
  const sender = event.sender as { nickname?: string; } | undefined;
  const userName = sender?.nickname || '';

  // 记录消息到日志
  try {
    logMessage({
      message_id: messageId,
      user_id: userId,
      user_name: userName,
      group_id: groupId || '',
      group_name: '',
      message_type: event.message_type,
      content: rawMessage.slice(0, 500),
      raw_message: rawMessage,
      timestamp: event.time,
    });
  } catch {
    // 静默失败
  }

  // 用户检测器检查
  try {
    const watchResult = await userWatcherManager.checkAndExecute(userId, groupId || '', rawMessage, messageId);
    if (watchResult) {
      pluginState.log('info', `用户检测器触发: ${watchResult.watcherId} -> ${watchResult.action}`);
    }
  } catch (error) {
    pluginState.log('error', '用户检测器处理失败:', error);
  }

  // 自定义指令匹配
  try {
    const cmdResponse = await commandManager.matchAndExecute(rawMessage.trim(), userId, groupId || '', userName);
    if (cmdResponse) {
      await sendReply(event, cmdResponse, ctx);
      return;
    }
  } catch (error) {
    pluginState.log('error', '自定义指令处理失败:', error);
  }

  // Packet 命令处理（仅主人可用）
  if (isOwner(userId) && ctx.actions) {
    const packetResult = await handlePacketCommands(rawMessage, event, ctx);
    if (packetResult) return;
  }

  // 处理消息内容
  const { content: processedMessage, replyMessageId } = processMessageContent(rawMessage);

  // 检查是否启用回复功能
  if (pluginState.config.enableReply === false) return;

  // 使用配置的前缀进行命令匹配
  const prefix = pluginState.config.prefix || 'xy';
  const prefixRegex = new RegExp(`^${prefix}\\s*(.*)`, 'is');
  const prefixMatch = processedMessage.match(prefixRegex);
  if (!prefixMatch) return;

  const command = prefixMatch[1].trim();

  // 处理命令
  await handleCommand(event, command, ctx, replyMessageId);
};

// ============================================================================
// 导出
// ============================================================================

export { plugin_init, plugin_onmessage, plugin_cleanup };
