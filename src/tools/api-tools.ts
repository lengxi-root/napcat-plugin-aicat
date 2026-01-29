// API 工具模块
import type { Tool, ToolResult } from '../types';
import { pluginState } from '../core/state';

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

export async function executeApiTool (
  actions: ActionMap, adapter: string, config: unknown, args: Record<string, unknown>
): Promise<ToolResult> {
  const action = args.action as string;
  let params = (args.params as Record<string, unknown>) || {};
  if (Object.keys(params).length === 0) {
    params = Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'action'));
  }

  if (!action) return { success: false, error: '缺少 action 参数' };

  // 禁言相关操作添加详细日志
  const isBanAction = action === 'set_group_ban' || action === 'set_group_whole_ban';

  try {
    if (isBanAction) {
      pluginState.debug(`[禁言] 开始执行 ${action}`);
      pluginState.debug(`[禁言] 参数: ${JSON.stringify(params)}`);
    }

    const result = await actions.call(action as never, params as never, adapter, config) as Record<string, unknown>;

    if (isBanAction) {
      pluginState.debug(`[禁言] 框架返回结果: ${JSON.stringify(result)}`);
      if (result) {
        pluginState.debug(`[禁言] retcode: ${result.retcode}, status: ${result.status}, message: ${result.message || result.msg}`);
      }
    }

    // 检查返回结果中是否包含错误
    if (result && result.retcode !== undefined && result.retcode !== 0) {
      const retcode = result.retcode;
      const msg = result.message || result.msg || result.wording || '未知错误';

      if (isBanAction) {
        pluginState.debug(`[禁言] 检测到失败 - retcode: ${retcode}, msg: ${msg}`);
      }

      // 解析具体的错误原因
      let friendlyError = `${action} 执行失败`;
      const msgStr = String(msg).toLowerCase();

      if (msgStr.includes('no permission') || msgStr.includes('lack') || retcode === 102) {
        friendlyError = '机器人没有管理员权限，无法执行此操作';
      } else if (msgStr.includes('owner') || msgStr.includes('群主')) {
        friendlyError = '无法对群主执行此操作';
      } else if (msgStr.includes('admin') || msgStr.includes('管理')) {
        friendlyError = '无法对管理员执行禁言（权限不足）';
      } else if (msgStr.includes('not found') || msgStr.includes('uid') || retcode === 100) {
        friendlyError = '找不到该用户，可能不在群内';
      } else if (msgStr.includes('频繁') || msgStr.includes('rate') || msgStr.includes('风控')) {
        friendlyError = '操作过于频繁或触发风控';
      } else {
        friendlyError = `${action} 执行失败: ${msg} (code: ${retcode})`;
      }

      return {
        success: false,
        error: friendlyError,
        data: result
      };
    }

    // 成功情况
    let successMessage = `${action} 执行成功`;
    if (action === 'set_group_ban') {
      const duration = params.duration as number || 0;
      successMessage = duration === 0
        ? `已解除用户 ${params.user_id} 的禁言`
        : `已禁言用户 ${params.user_id}，时长 ${Math.floor(duration / 60)}分钟`;

      pluginState.debug(`[禁言] 成功 - ${successMessage}`);
    } else if (action === 'set_group_whole_ban') {
      successMessage = params.enable ? '已开启全员禁言' : '已关闭全员禁言';
      pluginState.debug(`[禁言] 成功 - ${successMessage}`);
    } else if (action === 'set_group_kick') {
      successMessage = `已将用户 ${params.user_id} 踢出群聊`;
    } else if (action === 'delete_msg') {
      successMessage = `已撤回消息 ${params.message_id}`;
    }

    return { success: true, message: successMessage, data: result ?? {} };
  } catch (error) {
    const errorStr = String(error);

    if (isBanAction) {
      pluginState.debug(`[禁言] 捕获到异常: ${errorStr}`);
    }

    // 特殊处理：NapCat 框架对禁言等操作可能抛出 "No data returned" 但实际已成功
    if (errorStr.includes('No data returned')) {
      if (isBanAction) {
        pluginState.debug(`[禁言] 检测到 "No data returned"，框架无返回但操作可能已成功`);

        // 对于禁言操作，"No data returned" 通常意味着成功
        let successMessage = `${action} 执行成功（框架无返回数据）`;
        if (action === 'set_group_ban') {
          const duration = params.duration as number || 0;
          successMessage = duration === 0
            ? `已解除用户 ${params.user_id} 的禁言`
            : `已禁言用户 ${params.user_id}，时长 ${Math.floor(duration / 60)}分钟`;
        } else if (action === 'set_group_whole_ban') {
          successMessage = params.enable ? '已开启全员禁言' : '已关闭全员禁言';
        }

        pluginState.debug(`[禁言] 视为成功 - ${successMessage}`);
        return { success: true, message: successMessage, data: {} };
      }

      // 其他管理操作也可能是成功的
      if (['set_group_kick', 'set_group_admin', 'set_group_card', 'delete_msg'].includes(action)) {
        return { success: true, message: `${action} 执行成功`, data: {} };
      }
    }

    let friendlyError = `${action} 执行失败`;

    // 详细的错误解析
    if (errorStr.includes('NOT_GROUP_ADMIN') || errorStr.includes('no permission') || errorStr.includes('lack of permission')) {
      friendlyError = '机器人没有管理员权限，无法执行此操作';
    } else if (errorStr.includes('cannot ban owner') || errorStr.includes('群主')) {
      friendlyError = '无法对群主执行此操作';
    } else if (errorStr.includes('cannot ban admin') || errorStr.includes('管理员')) {
      friendlyError = '无法对管理员执行此操作（可能权限不足）';
    } else if (errorStr.includes('uid error') || errorStr.includes('user not found')) {
      friendlyError = '找不到该用户，可能不在群内';
    } else if (errorStr.includes('频繁') || errorStr.includes('rate limit') || errorStr.includes('风控')) {
      friendlyError = '操作过于频繁或触发风控，请稍后再试';
    } else if (errorStr.includes('group not found')) {
      friendlyError = '找不到该群';
    } else {
      // 包含原始错误信息
      friendlyError = `${action} 执行失败: ${errorStr.slice(0, 150)}`;
    }

    return { success: false, error: friendlyError };
  }
}

export const getApiTools = (): Tool[] => API_TOOLS;
