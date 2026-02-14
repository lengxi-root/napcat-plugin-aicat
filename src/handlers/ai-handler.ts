// AI 对话处理器
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NetworkAdapterConfig } from 'napcat-types/napcat-onebot/config/config';
import type { AIMessage, Tool, ToolResult, AIConfig } from '../types';
import { pluginState } from '../core/state';
import {
  DEFAULT_AI_CONFIG, MAX_ROUNDS, ADMIN_REQUIRED_APIS, OWNER_ONLY_APIS,
  OWNER_ONLY_TOOLS, OWNER_ONLY_CUSTOM_TOOLS, generateSystemPrompt,
  getValidModel, YTEA_MODEL_LIST,
} from '../config';
import { AIClient } from '../tools/ai-client';
import { getApiTools, executeApiTool } from '../tools/api-tools';
import { getWebTools, executeWebTool } from '../tools/web-tools';
import { getMessageTools, executeMessageTool } from '../tools/message-tools';
import { getCustomCommandTools, executeCustomCommandTool } from '../managers/custom-commands';
import { getScheduledTaskTools, executeScheduledTaskTool } from '../managers/scheduled-tasks';
import { getUserWatcherTools, executeUserWatcherTool } from '../managers/user-watcher';
import { contextManager } from '../managers/context-manager';
import { isOwner } from '../managers/owner-manager';
import { sendReply, sendLongMessage, extractAtUsers } from '../utils/message';
import { checkUserPermission, buildPermissionInfo } from '../utils/permission';

// 根据配置获取 AI 配置（返回配置和是否强制自动切换）
function getAIConfig (): { config: AIConfig; forceAutoSwitch: boolean; } {
  const { apiSource, model, customApiUrl, customApiKey, customModel, ytApiKey, yteaModel } = pluginState.config;

  // 模式3: 完全自定义 API
  if (apiSource === 'custom') {
    return {
      config: {
        base_url: customApiUrl || 'https://api.openai.com/v1/chat/completions',
        api_key: customApiKey || '',
        model: customModel || 'gpt-4o',
        timeout: DEFAULT_AI_CONFIG.timeout,
      },
      forceAutoSwitch: false,
    };
  }

  // 模式2: YTea 自购密钥（api.ytea.top），支持自动切换
  if (apiSource === 'ytea') {
    const selectedModel = yteaModel || YTEA_MODEL_LIST[0] || 'gpt-4o';
    const forceAutoSwitch = YTEA_MODEL_LIST.length > 0 && !YTEA_MODEL_LIST.includes(selectedModel);
    return {
      config: {
        base_url: 'https://api.ytea.top/v1/chat/completions',
        api_key: ytApiKey || '',
        model: forceAutoSwitch ? (YTEA_MODEL_LIST[0] || selectedModel) : selectedModel,
        timeout: DEFAULT_AI_CONFIG.timeout,
      },
      forceAutoSwitch,
    };
  }

  // 模式1: 主接口（i.elaina.vin），免费50次/天，强制自动切换
  const { model: validModel, forceAutoSwitch } = getValidModel(model || 'gpt-5');
  return {
    config: {
      base_url: DEFAULT_AI_CONFIG.base_url,
      api_key: DEFAULT_AI_CONFIG.api_key,
      model: validModel,
      timeout: DEFAULT_AI_CONFIG.timeout,
    },
    forceAutoSwitch: true,  // 主接口强制自动切换
  };
}

// 获取所有可用工具
function getAllTools (): Tool[] {
  return [
    ...getApiTools(),
    ...getWebTools(),
    ...getMessageTools(),
    ...getCustomCommandTools(),
    ...getScheduledTaskTools(),
    ...getUserWatcherTools(),
  ];
}

// 处理 AI 对话
export async function handleAICommand (
  event: OB11Message,
  instruction: string,
  ctx: NapCatPluginContext,
  replyMsgId?: string
): Promise<void> {
  if (!ctx.actions) {
    await sendReply(event, '❌ 插件未正确初始化喵～', ctx);
    return;
  }

  const userId = String(event.user_id);
  const groupId = event.group_id ? String(event.group_id) : undefined;
  const userPerm = await checkUserPermission(userId, groupId, ctx);
  const userIsOwner = isOwner(userId);
  const selfId = event.self_id ? String(event.self_id) : undefined;
  const atUsers = extractAtUsers(event.message, selfId);
  const sender = event.sender as { nickname?: string; } | undefined;

  // 构建上下文信息
  const contextInfo = [
    `群号: ${groupId || '私聊'} | 用户: ${userId} (${sender?.nickname || ''}) | 权限: ${buildPermissionInfo(userPerm, userIsOwner)}`,
    atUsers.length ? `- 艾特用户: ${atUsers.join(', ')}` : '',
    replyMsgId ? `- 引用消息ID: ${replyMsgId}` : '',
    `指令: ${instruction}`,
  ].filter(Boolean).join('\n');

  // 创建 AI 客户端（传入自动切换模式设置）
  // 如果用户选择的模型已不可用，则强制启用自动切换
  const { config: aiConfig, forceAutoSwitch } = getAIConfig();
  const autoSwitch = forceAutoSwitch || pluginState.config.autoSwitchModel !== false;
  const aiClient = new AIClient(aiConfig, autoSwitch);

  // 设置请求附加信息（机器人、主人、用户）
  const ownerQQs = pluginState.config.ownerQQs;
  const ownerIds = ownerQQs ? ownerQQs.split(/[,，\s]+/).map((s: string) => s.trim()).filter(Boolean) : [];
  let botId: string | undefined;
  try {
    const loginInfo = await ctx.actions?.call('get_login_info', {}, ctx.adapterName, ctx.pluginManager.config) as { user_id?: number | string; } | undefined;
    botId = loginInfo?.user_id ? String(loginInfo.user_id) : undefined;
  } catch { /* ignore */ }
  // 设置请求附加信息
  aiClient.setMeta({ bot_id: botId, owner_ids: ownerIds.length ? ownerIds : undefined, user_id: userId });

  const tools = getAllTools();

  // 构建消息列表
  const messages: AIMessage[] = [
    { role: 'system', content: generateSystemPrompt(pluginState.config.botName, pluginState.config.personality) },
    ...contextManager.getContext(userId, groupId),
    { role: 'user', content: contextInfo },
  ];

  // 发送确认消息（如果开启）
  if (pluginState.config.sendConfirmMessage !== false) {
    await sendReply(event, pluginState.config.confirmMessage || '收到喵～', ctx);
  }

  const allResults: { tool: string; result: ToolResult; }[] = [];
  let hasSentMsg = false;

  // 多轮对话循环
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await aiClient.chatWithTools(messages, tools);

    // 自动切换模式由服务器端处理，客户端只处理最终结果
    if (response.error) {
      const detail = response.detail ? `\n详情: ${response.detail.slice(0, 200)}` : '';
      await sendReply(event, `❌ 请求失败: ${response.error}${detail}`, ctx);
      return;
    }

    const aiMsg = response.choices?.[0]?.message;
    if (!aiMsg) {
      await sendReply(event, '❌ AI响应异常喵～', ctx);
      return;
    }

    const toolCalls = aiMsg.tool_calls || [];

    // 无工具调用，直接输出结果
    if (!toolCalls.length) {
      const content = aiMsg.content || '';
      if (content && !hasSentMsg) {
        await sendLongMessage(event, content, ctx);
        contextManager.addMessage(userId, groupId, 'user', instruction);
        contextManager.addMessage(userId, groupId, 'assistant', content);
      } else if (allResults.length && !hasSentMsg) {
        const success = allResults.filter(r => r.result.success).length;
        await sendReply(event, `✅ 完成 ${allResults.length} 个操作，成功 ${success} 个喵～`, ctx);
      }
      return;
    }

    // 执行工具调用
    messages.push(aiMsg);
    for (const tc of toolCalls) {
      const name = tc.function.name;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* ignore */ }

      // 检查是否通过 API 发送了消息
      if (name === 'call_api' && ['send_group_msg', 'send_private_msg', 'send_msg'].includes(args.action as string)) {
        hasSentMsg = true;
      }

      const result = await executeToolWithPermission(name, args, ctx, groupId, userPerm, userIsOwner);
      allResults.push({ tool: name, result });
      messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: tc.id });
    }
  }

  await sendReply(event, `⚠️ 达到最大轮数，已执行 ${allResults.length} 个操作`, ctx);
}

// 带权限检查的工具执行
async function executeToolWithPermission (
  name: string,
  args: Record<string, unknown>,
  ctx: NapCatPluginContext,
  groupId: string | undefined,
  userPerm: { is_admin: boolean; },
  isOwnerUser: boolean
): Promise<ToolResult> {
  // 仅主人可用的工具
  if ((OWNER_ONLY_TOOLS.has(name) || OWNER_ONLY_CUSTOM_TOOLS.has(name)) && !isOwnerUser) {
    return { success: false, error: '该功能仅主人可用喵～' };
  }

  // API 调用权限检查
  if (name === 'call_api') {
    const action = args.action as string;
    const params = (args.params as Record<string, unknown>) || {};

    if (OWNER_ONLY_APIS.has(action) && !isOwnerUser) {
      return { success: false, error: '该信息仅主人可查询喵～' };
    }
    if (ADMIN_REQUIRED_APIS.has(action) && !userPerm.is_admin) {
      return { success: false, error: '你不是管理员喵～' };
    }
    if (ADMIN_REQUIRED_APIS.has(action) && params.group_id && groupId && String(params.group_id) !== groupId) {
      return { success: false, error: '不能跨群操作喵～' };
    }
  }

  return executeTool(name, args, ctx, groupId, isOwnerUser);
}

// 工具分组路由表（按前缀匹配，减少重复定义）
const TOOL_ROUTES: [string[], (name: string, args: Record<string, unknown>) => Promise<ToolResult>][] = [
  [['add_custom_command', 'remove_custom_command', 'list_custom_commands', 'toggle_custom_command'], executeCustomCommandTool],
  [['add_scheduled_task', 'remove_scheduled_task', 'list_scheduled_tasks', 'toggle_scheduled_task', 'run_scheduled_task_now'], executeScheduledTaskTool],
  [['add_user_watcher', 'remove_user_watcher', 'list_user_watchers', 'toggle_user_watcher'], executeUserWatcherTool],
  [['web_search', 'fetch_url'], executeWebTool],
];

// 执行工具（基于路由表分发）
async function executeTool (
  name: string,
  args: Record<string, unknown>,
  ctx: NapCatPluginContext,
  currentGroupId?: string,
  isOwnerUser?: boolean
): Promise<ToolResult> {
  // 消息查询工具（带权限范围控制）
  if (['query_history_messages', 'search_messages', 'get_message_stats', 'get_message_by_id'].includes(name)) {
    return executeMessageToolWithScope(name, args, currentGroupId, isOwnerUser);
  }
  // API 调用
  if (name === 'call_api') {
    return ctx.actions
      ? executeApiTool(ctx.actions, ctx.adapterName, ctx.pluginManager.config as NetworkAdapterConfig, args)
      : { success: false, error: 'actions未初始化' };
  }
  // 路由表分发
  for (const [names, handler] of TOOL_ROUTES) {
    if (names.includes(name)) return handler(name, args);
  }
  return { success: false, error: `未知工具: ${name}` };
}

// 消息工具权限范围控制
async function executeMessageToolWithScope (
  name: string,
  args: Record<string, unknown>,
  currentGroupId?: string,
  isOwnerUser?: boolean
): Promise<ToolResult> {
  const queryGroupId = args.group_id as string | undefined;

  // 非主人只能查询当前群
  if (!isOwnerUser && queryGroupId && currentGroupId && queryGroupId !== currentGroupId) {
    return { success: false, error: '只能查询当前群的消息记录喵～' };
  }

  // 非主人且在群内，自动限定为当前群
  if (!isOwnerUser && currentGroupId && !queryGroupId) {
    args.group_id = currentGroupId;
  }

  return executeMessageTool(name, args);
}
