// NapCat AI Cat 插件 @author 冷曦 @version 1.0.0
import type { PluginModule, NapCatPluginContext, PluginConfigSchema } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import fs from 'fs';
import path, { dirname } from 'path';
import type { PluginConfig } from './types';
import { DEFAULT_PLUGIN_CONFIG, MODEL_LIST, BACKUP_MODEL_LIST } from './config';
import { pluginState } from './core/state';
import { handleCommand } from './handlers/command-handler';
import { handlePacketCommands, handlePublicPacketCommands } from './handlers/packet-handler';
import { processMessageContent, sendReply } from './utils/message';
import { executeApiTool } from './tools/api-tools';
import { isOwner, initOwnerDataDir, cleanupExpiredVerifications, setNapCatLogger, setConfigOwners } from './managers/owner-manager';
import { commandManager, initDataDir } from './managers/custom-commands';
import { taskManager, initTasksDataDir } from './managers/scheduled-tasks';
import { userWatcherManager, initWatchersDataDir } from './managers/user-watcher';
import { initMessageLogger, logMessage, cleanupOldMessages, closeMessageLogger } from './managers/message-logger';
import { handleNoticeEvent, type NoticeEvent } from './managers/operation-tracker';

export let plugin_config_ui: PluginConfigSchema = [];

// 插件初始化
const plugin_init: PluginModule['plugin_init'] = async (ctx: NapCatPluginContext) => {
  // 设置全局状态
  Object.assign(pluginState, {
    logger: ctx.logger,
    actions: ctx.actions,
    adapterName: ctx.adapterName,
    networkConfig: ctx.pluginManager.config,
  });
  pluginState.log('info', 'AI Cat 插件正在初始化喵～');

  // 配置UI
  plugin_config_ui = ctx.NapCatConfig.combine(
    ctx.NapCatConfig.html('<div style="padding:10px;background:#f5f5f5;border-radius:8px;margin-bottom:10px"><b>🐱 AI Cat 智能猫娘助手</b><br/><span style="color:#666;font-size:13px">使用 <code>xy帮助</code> 查看指令 | 交流群：631348711</span></div>'),
    // 基础设置
    ctx.NapCatConfig.html('<b>📌 基础设置</b>'),
    ctx.NapCatConfig.text('prefix', '指令前缀', 'xy', '触发AI对话的前缀'),
    ctx.NapCatConfig.text('botName', '机器人名称', '汐雨', '机器人显示名称'),
    ctx.NapCatConfig.text('personality', 'AI个性', '可爱猫娘助手，说话带"喵"等语气词，活泼俏皮会撒娇', 'AI的性格描述，会影响回复风格'),
    ctx.NapCatConfig.text('ownerQQs', '主人QQ', '', '多个用逗号分隔'),
    ctx.NapCatConfig.boolean('enableReply', '启用回复', true, '是否启用消息回复功能'),
    ctx.NapCatConfig.boolean('sendConfirmMessage', '发送确认消息', true, '收到指令后发送确认提示'),
    ctx.NapCatConfig.text('confirmMessage', '确认消息内容', '汐雨收到喵～', '确认提示的文本内容'),
    // AI 配置
    ctx.NapCatConfig.html('<b>🤖 AI 配置</b>'),
    ctx.NapCatConfig.select('apiSource', 'API来源', [
      { label: '主接口 (GPT/Claude)', value: 'main' },
      { label: '备用接口 (Gemini)', value: 'backup' },
      { label: '自定义API', value: 'custom' },
    ], 'main', '选择AI接口来源'),
    ctx.NapCatConfig.select('model', '主接口模型', MODEL_LIST.map(m => ({ label: m, value: m })), 'gpt-5', '主接口使用的模型'),
    ctx.NapCatConfig.select('backupModel', '备用模型', BACKUP_MODEL_LIST.map(m => ({ label: m, value: m })), 'gemini-2.5-flash', '备用接口使用的模型'),
    ctx.NapCatConfig.select('maxContextTurns', '上下文轮数', [5, 10, 15, 20].map(n => ({ label: `${n}轮`, value: n })), 10, '保留的对话历史轮数'),
    // 自定义 API
    ctx.NapCatConfig.html('<b>🔧 自定义API</b> <span style="color:#999;font-size:12px">仅选择自定义API时生效</span>'),
    ctx.NapCatConfig.text('customApiUrl', 'API地址', '', '如 https://api.openai.com/v1/chat/completions'),
    ctx.NapCatConfig.text('customApiKey', 'API密钥', '', '如 sk-xxx'),
    ctx.NapCatConfig.text('customModel', '模型名称', 'gpt-4o', '如 gpt-4o'),
    // 高级设置
    ctx.NapCatConfig.html('<b>⚙️ 高级设置</b>'),
    ctx.NapCatConfig.boolean('debug', '调试模式', false, '显示详细调试日志'),
    ctx.NapCatConfig.boolean('allowPublicPacket', '公开取指令', true, '允许所有人使用"取"指令')
  );

  // 加载配置
  if (fs.existsSync(ctx.configPath)) {
    pluginState.config = { ...DEFAULT_PLUGIN_CONFIG, ...JSON.parse(fs.readFileSync(ctx.configPath, 'utf-8')) };
  }

  // 初始化配置相关
  if (pluginState.config.ownerQQs) setConfigOwners(pluginState.config.ownerQQs);
  if (ctx.logger) setNapCatLogger((msg: string) => ctx.logger?.info(msg));

  // 初始化数据目录
  const dataPath = ctx.configPath ? dirname(ctx.configPath) : path.join(process.cwd(), 'data');
  initDataDir(dataPath);
  initTasksDataDir(dataPath);
  initWatchersDataDir(dataPath);
  initOwnerDataDir(dataPath);
  await initMessageLogger(dataPath);

  // 启动定时任务
  pluginState.setVerificationCleanupInterval(setInterval(() => cleanupExpiredVerifications(), 60000));
  setInterval(() => cleanupOldMessages(7), 24 * 60 * 60 * 1000);

  // 配置消息发送器
  taskManager.setMessageSender(async (type, id, content) => {
    if (!pluginState.actions || !pluginState.networkConfig) return;
    const msg = taskManager.parseMessageContent(content);
    const action = type === 'group' ? 'send_group_msg' : 'send_private_msg';
    const param = type === 'group' ? { group_id: id, message: msg } : { user_id: id, message: msg };
    await pluginState.actions.call(action, param as never, pluginState.adapterName, pluginState.networkConfig).catch(() => { });
  });

  // 配置 API 调用器
  userWatcherManager.setApiCaller(async (action, params) => {
    if (!pluginState.actions || !pluginState.networkConfig) return { success: false, error: 'actions未初始化' };
    try {
      return await executeApiTool(pluginState.actions, pluginState.adapterName, pluginState.networkConfig, { action, params });
    } catch (e) { return { success: false, error: String(e) }; }
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
  if (event.post_type !== 'message') return;

  const raw = event.raw_message || '';
  const userId = String(event.user_id);
  const groupId = event.group_id ? String(event.group_id) : undefined;
  const sender = event.sender as { nickname?: string } | undefined;

  // 记录消息
  logMessage({
    message_id: String(event.message_id),
    user_id: userId,
    user_name: sender?.nickname || '',
    group_id: groupId || '',
    group_name: '',
    message_type: event.message_type,
    content: raw.slice(0, 500),
    raw_message: raw,
    timestamp: event.time,
  });

  // 用户检测器
  const watchResult = await userWatcherManager.checkAndExecute(userId, groupId || '', raw, String(event.message_id)).catch(() => null);
  if (watchResult) pluginState.log('info', `检测器触发: ${watchResult.watcherId}`);

  // 自定义命令
  const cmdResp = await commandManager.matchAndExecute(raw.trim(), userId, groupId || '', sender?.nickname || '').catch(() => null);
  if (cmdResp) {
    await sendReply(event, cmdResp, ctx);
    return;
  }

  // 公开的"取"指令
  if (pluginState.config.allowPublicPacket && ctx.actions) {
    const publicResult = await handlePublicPacketCommands(raw, event, ctx);
    if (publicResult) return;
  }

  // 主人专属 Packet 指令
  if (isOwner(userId) && ctx.actions) {
    const packetResult = await handlePacketCommands(raw, event, ctx);
    if (packetResult) return;
  }

  // AI 对话处理
  const { content, replyMessageId } = processMessageContent(raw);
  if (pluginState.config.enableReply === false) return;

  const prefix = pluginState.config.prefix || 'xy';
  const match = content.match(new RegExp(`^${prefix}\\s*(.*)`, 'is'));
  if (!match) return;

  await handleCommand(event, match[1].trim(), ctx, replyMessageId);
};

// 事件处理
const plugin_onevent: PluginModule['plugin_onevent'] = async (_ctx: NapCatPluginContext, event: unknown) => {
  const e = event as { post_type?: string; notice_type?: string };

  if (e.post_type === 'notice' && e.notice_type) {
    const handled = handleNoticeEvent(event as NoticeEvent);
    if (handled) pluginState.debug(`[Notice] 操作已确认: ${e.notice_type}`);
  }
};

export { plugin_init, plugin_onmessage, plugin_onevent, plugin_cleanup };
