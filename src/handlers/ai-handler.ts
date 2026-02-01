// AI 对话处理器
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NetworkAdapterConfig } from 'napcat-types/napcat-onebot/config/config';
import type { AIMessage, Tool, ToolResult, AIConfig } from '../types';
import { pluginState } from '../core/state';
import {
  DEFAULT_AI_CONFIG, MAX_ROUNDS, ADMIN_REQUIRED_APIS, OWNER_ONLY_APIS,
  OWNER_ONLY_TOOLS, OWNER_ONLY_CUSTOM_TOOLS, MODEL_LIST, BACKUP_MODEL_LIST, generateSystemPrompt,
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

// 根据配置获取 AI 配置
function getAIConfig (): AIConfig {
  const { apiSource, model, backupModel, customApiUrl, customApiKey, customModel } = pluginState.config;

  switch (apiSource) {
    case 'custom':
      return {
        base_url: customApiUrl || 'https://api.openai.com/v1/chat/completions',
        api_key: customApiKey || '',
        model: customModel || 'gpt-4o',
        timeout: DEFAULT_AI_CONFIG.timeout,
      };
    case 'backup':
      return {
        base_url: DEFAULT_AI_CONFIG.base_url,
        api_key: DEFAULT_AI_CONFIG.api_key,
        model: backupModel || 'gemini-2.5-flash',
        timeout: DEFAULT_AI_CONFIG.timeout,
      };
    default: // main
      return {
        base_url: DEFAULT_AI_CONFIG.base_url,
        api_key: DEFAULT_AI_CONFIG.api_key,
        model: model || 'gpt-5',
        timeout: DEFAULT_AI_CONFIG.timeout,
      };
  }
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
  const atUsers = extractAtUsers(event.message);
  const sender = event.sender as { nickname?: string; } | undefined;

  // 构建上下文信息
  const contextInfo = [
    `群号: ${groupId || '私聊'} | 用户: ${userId} (${sender?.nickname || ''}) | 权限: ${buildPermissionInfo(userPerm, userIsOwner)}`,
    atUsers.length ? `- 艾特用户: ${atUsers.join(', ')}` : '',
    replyMsgId ? `- 引用消息ID: ${replyMsgId}` : '',
    `指令: ${instruction}`,
  ].filter(Boolean).join('\n');

  // 创建 AI 客户端
  const aiClient = new AIClient(getAIConfig());
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
  let retryCount = 0;
  const maxRetries = 3;
  const allModels = [...MODEL_LIST, ...BACKUP_MODEL_LIST];

  // 多轮对话循环
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let response = await aiClient.chatWithTools(messages, tools);

    // 模型失效时自动切换
    while (response.error && retryCount < maxRetries) {
      const isRetryable = /超时|HTTP|429|500|502|503|model|invalid/i.test(response.error);
      if (!isRetryable) break;

      const currentIdx = allModels.indexOf(aiClient.getModel());
      const nextModel = allModels[(currentIdx + 1) % allModels.length];
      pluginState.debug(`[AI] 模型 ${aiClient.getModel()} 失效，临时切换到 ${nextModel}`);
      aiClient.setModel(nextModel);
      response = await aiClient.chatWithTools(messages, tools);
      retryCount++;
    }

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

// 执行工具
async function executeTool (
  name: string,
  args: Record<string, unknown>,
  ctx: NapCatPluginContext,
  currentGroupId?: string,
  isOwnerUser?: boolean
): Promise<ToolResult> {
  // 工具分类映射
  const toolHandlers: Record<string, () => Promise<ToolResult>> = {
    // 自定义命令工具
    add_custom_command: () => executeCustomCommandTool(name, args),
    remove_custom_command: () => executeCustomCommandTool(name, args),
    list_custom_commands: () => executeCustomCommandTool(name, args),
    toggle_custom_command: () => executeCustomCommandTool(name, args),
    // 定时任务工具
    add_scheduled_task: () => executeScheduledTaskTool(name, args),
    remove_scheduled_task: () => executeScheduledTaskTool(name, args),
    list_scheduled_tasks: () => executeScheduledTaskTool(name, args),
    toggle_scheduled_task: () => executeScheduledTaskTool(name, args),
    run_scheduled_task_now: () => executeScheduledTaskTool(name, args),
    // 用户检测器工具
    add_user_watcher: () => executeUserWatcherTool(name, args),
    remove_user_watcher: () => executeUserWatcherTool(name, args),
    list_user_watchers: () => executeUserWatcherTool(name, args),
    toggle_user_watcher: () => executeUserWatcherTool(name, args),
    // 网络工具
    web_search: () => executeWebTool(name, args),
    fetch_url: () => executeWebTool(name, args),
    // 消息查询工具
    query_history_messages: () => executeMessageToolWithScope(name, args, currentGroupId, isOwnerUser),
    search_messages: () => executeMessageToolWithScope(name, args, currentGroupId, isOwnerUser),
    get_message_stats: () => executeMessageToolWithScope(name, args, currentGroupId, isOwnerUser),
    get_message_by_id: () => executeMessageToolWithScope(name, args, currentGroupId, isOwnerUser),
    // API 调用
    call_api: () => ctx.actions
      ? executeApiTool(ctx.actions, ctx.adapterName, ctx.pluginManager.config as NetworkAdapterConfig, args)
      : Promise.resolve({ success: false, error: 'actions未初始化' }),
  };

  const handler = toolHandlers[name];
  return handler ? handler() : { success: false, error: `未知工具: ${name}` };
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
