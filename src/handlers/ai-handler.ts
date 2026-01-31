// AI 对话处理器
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NetworkAdapterConfig } from 'napcat-types/napcat-onebot/config/config';
import type { AIMessage, Tool, ToolResult } from '../types';
import { pluginState } from '../core/state';
import { DEFAULT_AI_CONFIG, MAX_ROUNDS, ADMIN_REQUIRED_APIS, OWNER_ONLY_APIS, OWNER_ONLY_TOOLS, OWNER_ONLY_CUSTOM_TOOLS, MODEL_LIST, generateSystemPrompt } from '../config';
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

// 处理AI对话
export async function handleAICommand (event: OB11Message, instruction: string, ctx: NapCatPluginContext, replyMsgId?: string): Promise<void> {
  if (!ctx.actions) { await sendReply(event, '❌ 插件未正确初始化喵～', ctx); return; }

  const userId = String(event.user_id), groupId = event.group_id ? String(event.group_id) : undefined;
  const userPerm = await checkUserPermission(userId, groupId, ctx), userIsOwner = isOwner(userId);
  const atUsers = extractAtUsers(event.message), sender = event.sender as { nickname?: string; } | undefined;

  const contextInfo = `群号: ${groupId || '私聊'} | 用户: ${userId} (${sender?.nickname || ''}) | 权限: ${buildPermissionInfo(userPerm, userIsOwner)}${atUsers.length ? '\n- 艾特用户: ' + atUsers.join(', ') : ''}${replyMsgId ? '\n- 引用消息ID: ' + replyMsgId : ''}\n指令: ${instruction}`;

  const useCustom = pluginState.config.apiSource === 'custom';
  const aiConfig = useCustom
    ? { base_url: pluginState.config.customApiUrl || 'https://api.openai.com/v1/chat/completions', api_key: pluginState.config.customApiKey || '', model: pluginState.config.customModel || 'gpt-4o', timeout: DEFAULT_AI_CONFIG.timeout }
    : { base_url: DEFAULT_AI_CONFIG.base_url, api_key: DEFAULT_AI_CONFIG.api_key, model: pluginState.currentModel, timeout: DEFAULT_AI_CONFIG.timeout };
  const aiClient = new AIClient(aiConfig);

  const tools: Tool[] = [...getApiTools(), ...getWebTools(), ...getMessageTools(), ...getCustomCommandTools(), ...getScheduledTaskTools(), ...getUserWatcherTools()];
  const messages: AIMessage[] = [{ role: 'system', content: generateSystemPrompt(pluginState.config.botName) }];
  const history = contextManager.getContext(userId, groupId);
  if (history.length) messages.push(...history);
  messages.push({ role: 'user', content: contextInfo });

  await sendReply(event, pluginState.config.confirmMessage || '收到喵～', ctx);

  const allResults: { tool: string; result: ToolResult; }[] = [];
  let retryCount = 0, hasSentMsg = false;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let response = await aiClient.chatWithTools(messages, tools);

    // 超时自动切换模型
    if (response.error === '请求超时' && retryCount < 2) {
      const curIdx = MODEL_LIST.indexOf(aiClient.getModel());
      const next = MODEL_LIST[(curIdx + 1) % MODEL_LIST.length];
      aiClient.setModel(next);
      pluginState.currentModel = next;
      response = await aiClient.chatWithTools(messages, tools);
      retryCount++;
    }

    if (response.error) { await sendReply(event, `❌ 请求失败: ${response.error}`, ctx); return; }
    const aiMsg = response.choices?.[0]?.message;
    if (!aiMsg) { await sendReply(event, '❌ AI响应异常喵～', ctx); return; }

    const toolCalls = aiMsg.tool_calls || [];
    if (!toolCalls.length) {
      const content = aiMsg.content || '';
      if (content && !hasSentMsg) {
        await sendLongMessage(event, content, ctx);
        contextManager.addMessage(userId, groupId, 'user', instruction);
        contextManager.addMessage(userId, groupId, 'assistant', content);
      } else if (allResults.length && !hasSentMsg) {
        await sendReply(event, `✅ 完成 ${allResults.length} 个操作，成功 ${allResults.filter(r => r.result.success).length} 个喵～`, ctx);
      }
      return;
    }

    messages.push(aiMsg);
    for (const tc of toolCalls) {
      const name = tc.function.name;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { }

      // 检查是否通过API发送了消息
      if (name === 'call_api' && ['send_group_msg', 'send_private_msg', 'send_msg'].includes(args.action as string)) hasSentMsg = true;

      let result: ToolResult;
      if ((OWNER_ONLY_TOOLS.has(name) || OWNER_ONLY_CUSTOM_TOOLS.has(name)) && !userIsOwner) {
        result = { success: false, error: '该功能仅主人可用喵～' };
      } else if (name === 'call_api') {
        const action = args.action as string, params = (args.params as Record<string, unknown>) || {};
        // 敏感API仅主人可用（好友列表、群列表等机器人隐私信息）
        if (OWNER_ONLY_APIS.has(action) && !userIsOwner) {
          result = { success: false, error: '该信息仅主人可查询喵～' };
        } else if (ADMIN_REQUIRED_APIS.has(action) && !userPerm.is_admin) {
          result = { success: false, error: '你不是管理员喵～' };
        } else if (ADMIN_REQUIRED_APIS.has(action) && params.group_id && groupId && String(params.group_id) !== groupId) {
          result = { success: false, error: '不能跨群操作喵～' };
        } else {
          result = await executeTool(name, args, ctx, groupId, userIsOwner);
        }
      } else {
        result = await executeTool(name, args, ctx, groupId, userIsOwner);
      }
      allResults.push({ tool: name, result });
      messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: tc.id });
    }
  }
  await sendReply(event, `⚠️ 达到最大轮数，已执行 ${allResults.length} 个操作`, ctx);
}

// 执行工具
async function executeTool (name: string, args: Record<string, unknown>, ctx: NapCatPluginContext, currentGroupId?: string, isOwnerUser?: boolean): Promise<ToolResult> {
  const customCmds = new Set(['add_custom_command', 'remove_custom_command', 'list_custom_commands', 'toggle_custom_command']);
  const taskTools = new Set(['add_scheduled_task', 'remove_scheduled_task', 'list_scheduled_tasks', 'toggle_scheduled_task', 'run_scheduled_task_now']);
  const watcherTools = new Set(['add_user_watcher', 'remove_user_watcher', 'list_user_watchers', 'toggle_user_watcher']);
  const webTools = new Set(['web_search', 'fetch_url']);
  const msgTools = new Set(['query_history_messages', 'search_messages', 'get_message_stats', 'get_message_by_id']);

  if (customCmds.has(name)) return executeCustomCommandTool(name, args);
  if (taskTools.has(name)) return executeScheduledTaskTool(name, args);
  if (watcherTools.has(name)) return executeUserWatcherTool(name, args);
  if (webTools.has(name)) return executeWebTool(name, args);
  // 消息查询工具：非主人只能查询当前群
  if (msgTools.has(name)) {
    const queryGroupId = args.group_id as string | undefined;
    if (!isOwnerUser && queryGroupId && currentGroupId && queryGroupId !== currentGroupId) {
      return { success: false, error: '只能查询当前群的消息记录喵～' };
    }
    // 非主人且在群内，自动限定为当前群
    if (!isOwnerUser && currentGroupId && !queryGroupId) {
      args.group_id = currentGroupId;
    }
    return executeMessageTool(name, args);
  }
  if (name === 'call_api' && ctx.actions) return executeApiTool(ctx.actions, ctx.adapterName, ctx.pluginManager.config as NetworkAdapterConfig, args);
  return { success: false, error: `未知工具: ${name}` };
}
