// API 工具模块
import type { Tool, ToolResult } from '../types';
import { pluginState } from '../core/state';
import { addPendingOperation, type OperationType } from '../managers/operation-tracker';

interface ActionMap {
  call: (action: string, params: unknown, adapter: string, config: unknown) => Promise<unknown>;
  get: (action: string) => unknown;
}

export const API_TOOLS: Tool[] = [{
  type: 'function',
  function: {
    name: 'call_api',
    description: '调用 OneBot API 接口。可用接口见系统提示词中的【可用API列表】',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'API名称，如 send_group_msg, set_group_ban 等' },
        params: { type: 'object', description: 'API参数' },
      },
      required: ['action'],
    },
  },
}];

// 无返回值的操作类型（需要通过通知事件确认）
const NO_RETURN_ACTIONS = new Set([
  'set_group_ban', 'set_group_whole_ban', 'set_group_kick',
  'set_group_admin', 'set_group_card', 'delete_msg',
]);

// 获取操作类型
function getOperationType (action: string, params: Record<string, unknown>): OperationType | null {
  if (action === 'set_group_ban') {
    const duration = params.duration as number || 0;
    return duration === 0 ? 'lift_ban' : 'ban';
  }
  if (action === 'set_group_kick') return 'kick';
  if (action === 'set_group_admin') {
    return params.enable ? 'set_admin' : 'unset_admin';
  }
  if (action === 'delete_msg') return 'recall';
  return null;
}

export async function executeApiTool (
  actions: ActionMap, adapter: string, config: unknown, args: Record<string, unknown>
): Promise<ToolResult> {
  const action = args.action as string;
  let params = (args.params as Record<string, unknown>) || {};
  if (Object.keys(params).length === 0) {
    params = Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'action'));
  }

  if (!action) return { success: false, error: '缺少 action 参数' };

  // 合并转发消息内容过滤
  if (action.includes('forward_msg') && params.messages) {
    params.messages = sanitizeForwardMessages(params.messages as unknown[]);
  }

  const isNoReturnAction = NO_RETURN_ACTIONS.has(action);
  const operationType = getOperationType(action, params);

  pluginState.debug(`[API] 执行 ${action}，参数: ${JSON.stringify(params)}`);

  try {
    // 调用 API
    const result = await actions.call(action as never, params as never, adapter, config) as Record<string, unknown>;
    pluginState.debug(`[API] ${action} 返回: ${JSON.stringify(result)}`);

    // 检查返回结果中是否包含错误
    if (result && result.retcode !== undefined && result.retcode !== 0) {
      return parseApiError(action, result);
    }

    // 对于有返回值的操作，直接返回成功
    if (!isNoReturnAction || result) {
      return { success: true, message: getSuccessMessage(action, params), data: result ?? {} };
    }

    // 无返回值操作：注册待确认，等待通知事件
    if (operationType && params.group_id && params.user_id) {
      pluginState.debug(`[API] ${action} 无返回值，等待通知确认...`);
      const confirmation = await addPendingOperation(
        operationType,
        String(params.group_id),
        String(params.user_id),
        { duration: params.duration as number, timeout: 3000 }
      );
      pluginState.debug(`[API] ${action} 确认结果: ${confirmation.confirmed ? '已确认' : '超时假定成功'}`);
      return { success: confirmation.success, message: confirmation.message, data: confirmation.data };
    }

    return { success: true, message: getSuccessMessage(action, params), data: {} };

  } catch (error) {
    const errorStr = String(error);
    pluginState.debug(`[API] ${action} 异常: ${errorStr}`);

    // "No data returned" 对于无返回操作通常意味着成功，等待通知确认
    if (errorStr.includes('No data returned') && isNoReturnAction) {
      if (operationType && params.group_id && params.user_id) {
        pluginState.debug(`[API] ${action} "No data returned"，等待通知确认...`);
        const confirmation = await addPendingOperation(
          operationType,
          String(params.group_id),
          String(params.user_id),
          { duration: params.duration as number, timeout: 3000 }
        );
        return { success: confirmation.success, message: confirmation.message, data: confirmation.data };
      }
      // 全员禁言等无 user_id 的操作
      return { success: true, message: getSuccessMessage(action, params), data: {} };
    }

    return parseApiException(action, errorStr);
  }
}

// 解析 API 返回错误
function parseApiError (action: string, result: Record<string, unknown>): ToolResult {
  const retcode = result.retcode as number;
  const msg = (result.message || result.msg || result.wording || '未知错误') as string;
  const msgStr = msg.toLowerCase();

  let friendlyError = `${action} 执行失败`;

  if (msgStr.includes('no permission') || msgStr.includes('lack') || retcode === 102) {
    friendlyError = '机器人没有管理员权限，无法执行此操作';
  } else if (msgStr.includes('owner') || msgStr.includes('群主')) {
    friendlyError = '无法对群主执行此操作';
  } else if (msgStr.includes('admin') || msgStr.includes('管理')) {
    friendlyError = '无法对管理员执行此操作（权限不足）';
  } else if (msgStr.includes('not found') || msgStr.includes('uid') || retcode === 100) {
    friendlyError = '找不到该用户，可能不在群内';
  } else if (msgStr.includes('频繁') || msgStr.includes('rate') || msgStr.includes('风控')) {
    friendlyError = '操作过于频繁或触发风控';
  } else {
    friendlyError = `${action} 失败: ${msg} (code: ${retcode})`;
  }

  return { success: false, error: friendlyError, data: result };
}

// 解析 API 异常
function parseApiException (action: string, errorStr: string): ToolResult {
  let friendlyError = `${action} 执行失败`;

  if (errorStr.includes('NOT_GROUP_ADMIN') || errorStr.includes('no permission')) {
    friendlyError = '机器人没有管理员权限，无法执行此操作';
  } else if (errorStr.includes('cannot ban owner') || errorStr.includes('群主')) {
    friendlyError = '无法对群主执行此操作';
  } else if (errorStr.includes('cannot ban admin') || errorStr.includes('管理员')) {
    friendlyError = '无法对管理员执行此操作（权限不足）';
  } else if (errorStr.includes('uid error') || errorStr.includes('user not found')) {
    friendlyError = '找不到该用户，可能不在群内';
  } else if (errorStr.includes('频繁') || errorStr.includes('rate limit') || errorStr.includes('风控')) {
    friendlyError = '操作过于频繁或触发风控，请稍后再试';
  } else if (errorStr.includes('group not found')) {
    friendlyError = '找不到该群';
  } else {
    friendlyError = `${action} 失败: ${errorStr.slice(0, 100)}`;
  }

  return { success: false, error: friendlyError };
}

// 获取成功消息
function getSuccessMessage (action: string, params: Record<string, unknown>): string {
  if (action === 'set_group_ban') {
    const duration = params.duration as number || 0;
    return duration === 0
      ? `已解除用户 ${params.user_id} 的禁言`
      : `已禁言用户 ${params.user_id}，时长 ${Math.floor(duration / 60)}分钟`;
  }
  if (action === 'set_group_whole_ban') {
    return params.enable ? '已开启全员禁言' : '已关闭全员禁言';
  }
  if (action === 'set_group_kick') {
    return `已将用户 ${params.user_id} 踢出群聊`;
  }
  if (action === 'delete_msg') {
    return `已撤回消息 ${params.message_id}`;
  }
  if (action === 'set_group_admin') {
    return params.enable
      ? `已设置用户 ${params.user_id} 为管理员`
      : `已取消用户 ${params.user_id} 的管理员`;
  }
  return `${action} 执行成功`;
}

export const getApiTools = (): Tool[] => API_TOOLS;

// 处理合并转发消息，规范化格式并过滤无效内容
function sanitizeForwardMessages (messages: unknown[]): unknown[] {
  if (!Array.isArray(messages)) return messages;

  return messages.map(node => {
    const n = node as Record<string, unknown>;
    if (n.type !== 'node' || !n.data) return node;

    const data = n.data as Record<string, unknown>;

    // 确保 user_id 是数字类型
    if (data.user_id !== undefined) {
      data.user_id = Number(data.user_id) || 66600000;
    }

    // 确保 nickname 存在
    if (!data.nickname) {
      data.nickname = 'Bot';
    }

    // 处理 content 字段
    if (typeof data.content === 'string') {
      // 字符串内容转为标准消息段格式
      data.content = [{ type: 'text', data: { text: sanitizeText(data.content) } }];
    } else if (Array.isArray(data.content)) {
      // 检查 content 是否包含嵌套的 node（嵌套合并转发）
      const hasNestedNodes = (data.content as unknown[]).some(
        seg => (seg as Record<string, unknown>).type === 'node'
      );

      if (hasNestedNodes) {
        // 递归处理嵌套的 node 数组
        data.content = sanitizeForwardMessages(data.content as unknown[]);
      } else {
        // 处理普通消息段
        data.content = (data.content as unknown[]).map(seg => {
          const s = seg as Record<string, unknown>;

          // 处理 text 消息段
          if (s.type === 'text' && s.data) {
            const d = s.data as Record<string, unknown>;
            if (typeof d.text === 'string') {
              d.text = sanitizeText(d.text);
            }
          }

          // 过滤无效的 image 节点（缺少 file 或 url）
          if (s.type === 'image' && s.data) {
            const d = s.data as Record<string, unknown>;
            if (!d.file && !d.url) {
              return { type: 'text', data: { text: '[图片]' } };
            }
          }

          return seg;
        }).filter(Boolean);
      }
    }

    return node;
  });
}

// 过滤可能被误解析为 CQ 码的文本
function sanitizeText (text: string): string {
  // 将可能引起问题的 [xxx] 格式转为全角括号
  return text.replace(/\[(?!CQ:)(动画表情|表情|图片|文件|语音|视频)[^\]]*\]/g, match => {
    return '【' + match.slice(1, -1) + '】';
  });
}
