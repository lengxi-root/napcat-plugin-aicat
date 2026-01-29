// AI 对话处理器
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NetworkAdapterConfig } from 'napcat-types/napcat-onebot/config/config';
import type { AIMessage, Tool, ToolResult } from '../types';

import { pluginState } from '../core/state';
import {
  DEFAULT_AI_CONFIG,
  MAX_ROUNDS,
  ADMIN_REQUIRED_APIS,
  OWNER_ONLY_TOOLS,
  OWNER_ONLY_CUSTOM_TOOLS,
  MODEL_LIST,
  generateSystemPrompt,
} from '../config';
import { AIClient } from '../tools/ai-client';
import { getApiTools, executeApiTool } from '../tools/api-tools';
import { getWebTools, executeWebTool } from '../tools/web-tools';
import { getCustomCommandTools, executeCustomCommandTool } from '../managers/custom-commands';
import { getScheduledTaskTools, executeScheduledTaskTool } from '../managers/scheduled-tasks';
import { getUserWatcherTools, executeUserWatcherTool } from '../managers/user-watcher';
import { contextManager } from '../managers/context-manager';
import { isOwner } from '../managers/owner-manager';
import { sendReply, sendLongMessage, extractAtUsers } from '../utils/message';
import { checkUserPermission, buildPermissionInfo } from '../utils/permission';

// 处理 AI 对话命令
export async function handleAICommand(
  event: OB11Message,
  instruction: string,
  ctx: NapCatPluginContext,
  replyMessageId?: string
): Promise<void> {
  if (!ctx.actions) {
    await sendReply(event, '❌ 插件未正确初始化喵～', ctx);
    return;
  }

  const userId = String(event.user_id);
  const groupId = event.group_id ? String(event.group_id) : undefined;
  const userPerm = await checkUserPermission(userId, groupId, ctx);
  const userIsOwner = isOwner(userId);

  // 提取 @ 用户
  const atUsers = extractAtUsers(event.message);

  // 构建上下文信息
  const permInfo = buildPermissionInfo(userPerm, userIsOwner);
  const atInfo = atUsers.length > 0 ? `\n- 艾特的用户: ${atUsers.join(', ')}` : '';
  const replyInfo = replyMessageId ? `\n- 引用的消息ID: ${replyMessageId}` : '';
  const sender = event.sender as { nickname?: string; } | undefined;

  const contextInfo = `群号: ${groupId || '私聊'} | 用户: ${userId} (${sender?.nickname || ''}) | 权限: ${permInfo}${atInfo}${replyInfo}
指令: ${instruction}`;

  // 创建 AI 客户端
  const aiConfig = { ...DEFAULT_AI_CONFIG, model: pluginState.currentModel };
  const aiClient = new AIClient(aiConfig);

  // 获取工具定义
  const tools: Tool[] = [
    ...getApiTools(),
    ...getWebTools(),
    ...getCustomCommandTools(),
    ...getScheduledTaskTools(),
    ...getUserWatcherTools(),
  ];

  // 构建消息列表
  const systemPrompt = generateSystemPrompt(pluginState.config.botName);
  const messages: AIMessage[] = [{ role: 'system', content: systemPrompt }];

  // 添加历史上下文
  const history = contextManager.getContext(userId, groupId);
  if (history.length > 0) {
    messages.push(...history);
  }
  messages.push({ role: 'user', content: contextInfo });

  // 发送确认消息
  await sendReply(event, pluginState.config.confirmMessage || '收到喵～', ctx);

  const allToolResults: { tool: string; arguments: Record<string, unknown>; result: ToolResult; }[] = [];
  let retryCount = 0;
  const maxRetries = 2;

  // AI 对话循环
  for (let round = 0; round < MAX_ROUNDS; round++) {
    pluginState.debug(`第 ${round + 1} 轮对话开始`);

    let response = await aiClient.chatWithTools(messages, tools);

    // 超时自动切换模型重试
    if (response.error === '请求超时' && retryCount < maxRetries) {
      const currentModel = aiClient.getModel();
      const currentIndex = MODEL_LIST.indexOf(currentModel);
      const nextIndex = (currentIndex + 1) % MODEL_LIST.length;
      const nextModel = MODEL_LIST[nextIndex];

      pluginState.log('warn', `模型 ${currentModel} 超时，切换到 ${nextModel} 重试`);
      aiClient.setModel(nextModel);
      pluginState.currentModel = nextModel;

      response = await aiClient.chatWithTools(messages, tools);
      retryCount++;
    }

    if (response.error) {
      await sendReply(event, `❌ 请求失败: ${response.error}\n${response.detail?.slice(0, 200) || ''}`, ctx);
      return;
    }

    const choice = response.choices?.[0];
    const aiMessage = choice?.message;

    if (!aiMessage) {
      await sendReply(event, '❌ AI 响应异常喵～', ctx);
      return;
    }

    const toolCalls = aiMessage.tool_calls || [];
    const hasContent = !!(aiMessage.content && aiMessage.content.trim());

    pluginState.debug(`第 ${round + 1} 轮: toolCalls=${toolCalls.length}, hasContent=${hasContent}, finish_reason=${choice?.finish_reason}`);

    // 没有工具调用，返回最终回复并结束
    if (toolCalls.length === 0) {
      const finalContent = aiMessage.content || '';
      if (finalContent) {
        pluginState.debug(`发送最终回复: ${finalContent.slice(0, 50)}...`);
        await sendLongMessage(event, finalContent, ctx);
        contextManager.addMessage(userId, groupId, 'user', instruction);
        contextManager.addMessage(userId, groupId, 'assistant', finalContent);
      } else if (allToolResults.length > 0) {
        const success = allToolResults.filter(r => r.result.success).length;
        await sendReply(event, `✅ 完成 ${allToolResults.length} 个操作，成功 ${success} 个喵～`, ctx);
      }
      return; // 直接结束，不再继续循环
    }

    // 添加 AI 消息到对话
    messages.push(aiMessage);

    // 处理工具调用
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const toolId = toolCall.id;

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        args = {};
      }

      pluginState.debug(`工具调用: ${toolName}, 参数: ${JSON.stringify(args).slice(0, 200)}`);

      let result: ToolResult;

      // 权限检查 - 主人专属工具
      if (OWNER_ONLY_TOOLS.has(toolName) || OWNER_ONLY_CUSTOM_TOOLS.has(toolName)) {
        if (!userIsOwner) {
          result = { success: false, error: '该功能仅主人可用喵～' };
          allToolResults.push({ tool: toolName, arguments: args, result });
          messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolId });
          continue;
        }
      }

      // call_api 权限检查
      if (toolName === 'call_api') {
        const action = args.action as string;
        const params = (args.params as Record<string, unknown>) || {};

        // 管理员权限检查
        if (ADMIN_REQUIRED_APIS.has(action)) {
          if (!userPerm.is_admin) {
            result = { success: false, error: '你不是管理员，无法执行此操作喵～' };
            allToolResults.push({ tool: toolName, arguments: args, result });
            messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolId });
            continue;
          }

          // 跨群检查
          const targetGroup = String(params.group_id || '');
          if (targetGroup && groupId && targetGroup !== groupId) {
            result = { success: false, error: '不能跨群操作喵～' };
            allToolResults.push({ tool: toolName, arguments: args, result });
            messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolId });
            continue;
          }
        }
      }

      // 执行工具
      result = await executeTool(toolName, args, ctx);
      allToolResults.push({ tool: toolName, arguments: args, result });
      messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolId });

      pluginState.debug(`工具结果: success=${result.success}, message=${result.message || result.error || ''}`);
    }
  }

  await sendReply(event, `⚠️ 达到最大轮数，已执行 ${allToolResults.length} 个操作`, ctx);
}

/**
 * 执行工具
 * @param toolName 工具名称
 * @param args 工具参数
 * @param ctx 插件上下文
 */
async function executeTool (
  toolName: string,
  args: Record<string, unknown>,
  ctx: NapCatPluginContext
): Promise<ToolResult> {
  // 自定义指令工具
  const customCommandTools = new Set([
    'add_custom_command',
    'remove_custom_command',
    'list_custom_commands',
    'toggle_custom_command',
  ]);
  if (customCommandTools.has(toolName)) {
    return executeCustomCommandTool(toolName, args);
  }

  // 定时任务工具
  const scheduledTaskTools = new Set([
    'add_scheduled_task',
    'remove_scheduled_task',
    'list_scheduled_tasks',
    'toggle_scheduled_task',
    'run_scheduled_task_now',
  ]);
  if (scheduledTaskTools.has(toolName)) {
    return executeScheduledTaskTool(toolName, args);
  }

  // 用户检测器工具
  const userWatcherTools = new Set([
    'add_user_watcher',
    'remove_user_watcher',
    'list_user_watchers',
    'toggle_user_watcher',
  ]);
  if (userWatcherTools.has(toolName)) {
    return executeUserWatcherTool(toolName, args);
  }

  // 网络工具
  const webTools = new Set(['web_search', 'fetch_url']);
  if (webTools.has(toolName)) {
    return executeWebTool(toolName, args);
  }

  // API 工具
  if (toolName === 'call_api' && ctx.actions) {
    return executeApiTool(
      ctx.actions,
      ctx.adapterName,
      ctx.pluginManager.config as NetworkAdapterConfig,
      args
    );
  }

  return { success: false, error: `未知工具: ${toolName}` };
}
