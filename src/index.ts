// NapCat AI Cat 插件 @author 冷曦 @version 1.0.0
import type { PluginModule, NapCatPluginContext, PluginConfigSchema } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import { EventType } from 'napcat-types/napcat-onebot/event/index';
import fs from 'fs';
import path, { dirname } from 'path';
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
import { initMessageLogger, logMessage, cleanupOldMessages, closeMessageLogger } from './managers/message-logger';

export let plugin_config_ui: PluginConfigSchema = [];

// 插件初始化
const plugin_init: PluginModule['plugin_init'] = async (ctx: NapCatPluginContext) => {
  pluginState.logger = ctx.logger;
  pluginState.actions = ctx.actions;
  pluginState.adapterName = ctx.adapterName;
  pluginState.networkConfig = ctx.pluginManager.config;
  pluginState.log('info', 'AI Cat 插件正在初始化喵～');

  plugin_config_ui = ctx.NapCatConfig.combine(
    ctx.NapCatConfig.html('<div style="padding:10px;background:rgba(0,0,0,0.05);border-radius:8px"><h3>🐱 AI Cat 插件</h3><p>智能猫娘助手 - xy帮助查看指令</p><p style="margin-top:8px;color:#666;font-size:12px">💬 交流群：631348711</p></div>'),
    ctx.NapCatConfig.text('prefix', '指令前缀', 'xy', '触发AI对话的前缀'),
    ctx.NapCatConfig.boolean('enableReply', '启用回复', true, '是否启用消息回复'),
    ctx.NapCatConfig.text('botName', '机器人名称', '汐雨', '机器人显示名称'),
    ctx.NapCatConfig.text('confirmMessage', '确认消息', '汐雨收到喵～', '收到指令后的确认回复'),
    ctx.NapCatConfig.text('ownerQQs', '主人QQ', '', '多个用逗号分隔'),
    ctx.NapCatConfig.html('<div style="padding:8px;margin-top:10px;background:rgba(0,100,200,0.1);border-radius:6px"><strong>🤖 AI API配置</strong></div>'),
    ctx.NapCatConfig.select('apiSource', 'API来源', [{ label: '🏠 内置API（免费）', value: 'builtin' }, { label: '🔧 自定义API', value: 'custom' }], 'builtin', '选择API来源'),
    ctx.NapCatConfig.select('model', '内置模型', MODEL_LIST.map(m => ({ label: m, value: m })), 'gpt-5', '内置API模型'),
    ctx.NapCatConfig.html('<div style="padding:6px;margin-top:8px;background:rgba(255,165,0,0.1);border-radius:4px;font-size:12px">⬇️ 以下配置仅"自定义API"生效</div>'),
    ctx.NapCatConfig.text('customApiUrl', '自定义API地址', '', '如 https://api.openai.com/v1/chat/completions'),
    ctx.NapCatConfig.text('customApiKey', '自定义API密钥', '', '如 sk-xxx'),
    ctx.NapCatConfig.text('customModel', '自定义模型', 'gpt-4o', '如 gpt-4o'),
    ctx.NapCatConfig.select('maxContextTurns', '上下文轮数', [{ label: '5轮', value: 5 }, { label: '10轮', value: 10 }, { label: '15轮', value: 15 }, { label: '20轮', value: 20 }], 10, '保留的对话轮数'),
    ctx.NapCatConfig.boolean('debug', '调试模式', false, '显示详细日志')
  );

  if (fs.existsSync(ctx.configPath)) {
    pluginState.config = { ...DEFAULT_PLUGIN_CONFIG, ...JSON.parse(fs.readFileSync(ctx.configPath, 'utf-8')) };
  }

  if (pluginState.config.model) pluginState.currentModel = pluginState.config.model;
  if (pluginState.config.ownerQQs) setConfigOwners(pluginState.config.ownerQQs);
  if (ctx.logger) setNapCatLogger((msg: string) => ctx.logger?.info(msg));

  const dataPath = ctx.configPath ? dirname(ctx.configPath) : path.join(process.cwd(), 'data');
  initDataDir(dataPath);
  initTasksDataDir(dataPath);
  initWatchersDataDir(dataPath);
  initOwnerDataDir(dataPath);
  await initMessageLogger(dataPath);

  pluginState.setVerificationCleanupInterval(setInterval(() => cleanupExpiredVerifications(), 60000));
  setInterval(() => cleanupOldMessages(7), 24 * 60 * 60 * 1000);

  taskManager.setMessageSender(async (type, id, content) => {
    if (!pluginState.actions || !pluginState.networkConfig) return;
    const msg = taskManager.parseMessageContent(content);
    const action = type === 'group' ? 'send_group_msg' : 'send_private_msg';
    const param = type === 'group' ? { group_id: id, message: msg } : { user_id: id, message: msg };
    await pluginState.actions.call(action, param as never, pluginState.adapterName, pluginState.networkConfig).catch(() => { });
  });

  userWatcherManager.setApiCaller(async (action, params) => {
    if (!pluginState.actions || !pluginState.networkConfig) return { success: false, error: 'actions未初始化' };
    return executeApiTool(pluginState.actions, pluginState.adapterName, pluginState.networkConfig, { action, params });
  });

  taskManager.startScheduler();
  pluginState.log('info', 'AI Cat 插件初始化完成喵～');
};

// 获取配置
export const plugin_get_config = async (): Promise<PluginConfig> => pluginState.config;

// 保存配置
export const plugin_set_config = async (ctx: NapCatPluginContext, config: PluginConfig): Promise<void> => {
  pluginState.config = config;
  if (config.ownerQQs !== undefined) setConfigOwners(config.ownerQQs);
  if (config.model) pluginState.currentModel = config.model;
  if (ctx?.configPath) {
    const dir = path.dirname(ctx.configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ctx.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }
};

// 插件清理
const plugin_cleanup: PluginModule['plugin_cleanup'] = async () => {
  pluginState.log('info', 'AI Cat 插件正在卸载喵～');
  taskManager.stopScheduler();
  pluginState.clearVerificationCleanupInterval();
  closeMessageLogger();
};

// 消息处理
const plugin_onmessage: PluginModule['plugin_onmessage'] = async (ctx: NapCatPluginContext, event: OB11Message) => {
  if (event.post_type !== EventType.MESSAGE) return;
  const raw = event.raw_message || '', userId = String(event.user_id), groupId = event.group_id ? String(event.group_id) : undefined;
  const sender = event.sender as { nickname?: string; } | undefined;

  logMessage({ message_id: String(event.message_id), user_id: userId, user_name: sender?.nickname || '', group_id: groupId || '', group_name: '', message_type: event.message_type, content: raw.slice(0, 500), raw_message: raw, timestamp: event.time });

  const watchResult = await userWatcherManager.checkAndExecute(userId, groupId || '', raw, String(event.message_id)).catch(() => null);
  if (watchResult) pluginState.log('info', `检测器触发: ${watchResult.watcherId}`);

  const cmdResp = await commandManager.matchAndExecute(raw.trim(), userId, groupId || '', sender?.nickname || '').catch(() => null);
  if (cmdResp) { await sendReply(event, cmdResp, ctx); return; }

  if (isOwner(userId) && ctx.actions) {
    const packetResult = await handlePacketCommands(raw, event, ctx);
    if (packetResult) return;
  }

  const { content, replyMessageId } = processMessageContent(raw);
  if (pluginState.config.enableReply === false) return;

  const prefix = pluginState.config.prefix || 'xy';
  const match = content.match(new RegExp(`^${prefix}\\s*(.*)`, 'is'));
  if (!match) return;

  await handleCommand(event, match[1].trim(), ctx, replyMessageId);
};

export { plugin_init, plugin_onmessage, plugin_cleanup };
