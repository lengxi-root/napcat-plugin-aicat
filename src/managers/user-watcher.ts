// 用户检测器管理器 - 监控特定用户消息并执行操作
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { UserWatcher, Tool, ToolResult } from '../types';

let DATA_DIR = '';
let WATCHERS_FILE = '';

// 初始化数据目录
export function initWatchersDataDir(dataPath: string): void {
  DATA_DIR = dataPath;
  WATCHERS_FILE = join(DATA_DIR, 'user_watchers.json');
  
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

// API 调用器类型
type ApiCaller = (action: string, params: Record<string, unknown>) => Promise<ToolResult>;

class UserWatcherManager {
  private watchers: Map<string, UserWatcher> = new Map();
  private apiCaller: ApiCaller | null = null;

  constructor() {
    this.loadWatchers();
  }

  // 设置 API 调用器
  setApiCaller(caller: ApiCaller): void {
    this.apiCaller = caller;
  }

  // 加载检测器
  loadWatchers(): void {
    if (!WATCHERS_FILE || !existsSync(WATCHERS_FILE)) return;
    
    try {
      const data = JSON.parse(readFileSync(WATCHERS_FILE, 'utf-8'));
      this.watchers = new Map(Object.entries(data));
    } catch (error) {
      console.error('[UserWatcher] 加载失败:', error);
    }
  }

  // 保存检测器
  private saveWatchers(): void {
    if (!WATCHERS_FILE) return;
    
    try {
      const dir = dirname(WATCHERS_FILE);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data = Object.fromEntries(this.watchers);
      writeFileSync(WATCHERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[UserWatcher] 保存失败:', error);
    }
  }

  // 添加检测器
  addWatcher(
    watcherId: string,
    targetUserId: string,
    actionType: 'reply' | 'recall' | 'ban' | 'kick' | 'api_call',
    actionContent: string = '',
    groupId: string = '',
    keywordFilter: string = '',
    description: string = '',
    cooldownSeconds: number = 0
  ): ToolResult {
    // 验证正则表达式
    if (keywordFilter) {
      try {
        new RegExp(keywordFilter);
      } catch (error) {
        return { success: false, error: `关键词正则表达式无效: ${error}` };
      }
    }

    this.watchers.set(watcherId, {
      target_user_id: String(targetUserId),
      action_type: actionType,
      action_content: actionContent,
      group_id: String(groupId) || '',
      keyword_filter: keywordFilter,
      description,
      cooldown_seconds: cooldownSeconds,
      enabled: true,
      created_at: new Date().toISOString(),
      last_triggered: null,
      trigger_count: 0,
    });

    this.saveWatchers();
    return {
      success: true,
      message: `用户检测器 '${watcherId}' 已添加，监控用户 ${targetUserId}`,
    };
  }

  // 删除检测器
  removeWatcher(watcherId: string): ToolResult {
    if (this.watchers.has(watcherId)) {
      this.watchers.delete(watcherId);
      this.saveWatchers();
      return { success: true, message: `用户检测器 '${watcherId}' 已删除` };
    }
    return { success: false, error: `检测器 '${watcherId}' 不存在` };
  }

  // 切换检测器状态
  toggleWatcher(watcherId: string, enabled: boolean): ToolResult {
    const watcher = this.watchers.get(watcherId);
    if (!watcher) {
      return { success: false, error: `检测器 '${watcherId}' 不存在` };
    }
    watcher.enabled = enabled;
    this.saveWatchers();
    return { success: true, message: `检测器 '${watcherId}' 已${enabled ? '启用' : '禁用'}` };
  }

  // 列出所有检测器
  listWatchers(): ToolResult {
    const watcherList = Array.from(this.watchers.entries()).map(([id, w]) => ({
      id,
      target_user: w.target_user_id,
      action: w.action_type,
      group: w.group_id || '全部',
      keyword: w.keyword_filter || '全部消息',
      enabled: w.enabled,
      trigger_count: w.trigger_count,
      description: w.description || '',
    }));
    return { success: true, data: watcherList, count: watcherList.length };
  }

  // 检查并执行检测器
  async checkAndExecute(
    userId: string,
    groupId: string,
    content: string,
    messageId: string
  ): Promise<{ watcherId: string; action: string; result: ToolResult } | null> {
    const userIdStr = String(userId);
    const groupIdStr = String(groupId) || '';

    for (const [watcherId, watcher] of this.watchers) {
      if (!watcher.enabled) continue;

      // 检查目标用户
      if (watcher.target_user_id !== userIdStr) continue;

      // 检查群限制
      if (watcher.group_id && watcher.group_id !== groupIdStr) continue;

      // 检查关键词过滤
      if (watcher.keyword_filter) {
        try {
          if (!new RegExp(watcher.keyword_filter).test(content)) continue;
        } catch {
          continue;
        }
      }

      // 检查冷却时间
      if (watcher.cooldown_seconds > 0 && watcher.last_triggered) {
        try {
          const lastTime = new Date(watcher.last_triggered).getTime();
          const elapsed = (Date.now() - lastTime) / 1000;
          if (elapsed < watcher.cooldown_seconds) continue;
        } catch {
          // 继续执行
        }
      }

      // 触发检测器
      const result = await this.executeAction(watcher, userIdStr, groupIdStr, content, messageId);

      // 更新触发记录
      watcher.last_triggered = new Date().toISOString();
      watcher.trigger_count = (watcher.trigger_count || 0) + 1;
      this.saveWatchers();

      return { watcherId, action: watcher.action_type, result };
    }

    return null;
  }

  // 执行操作
  private async executeAction(
    watcher: UserWatcher,
    userId: string,
    groupId: string,
    content: string,
    messageId: string
  ): Promise<ToolResult> {
    if (!this.apiCaller) {
      return { success: false, error: 'API调用器未设置' };
    }

    // 替换变量
    let actionContent = watcher.action_content
      .replace(/\{user_id\}/g, userId)
      .replace(/\{group_id\}/g, groupId)
      .replace(/\{content\}/g, content)
      .replace(/\{message_id\}/g, String(messageId));

    try {
      switch (watcher.action_type) {
        case 'reply':
          if (groupId) {
            return await this.apiCaller('send_group_msg', {
              group_id: groupId,
              message: [
                { type: 'at', data: { qq: userId } },
                { type: 'text', data: { text: ' ' + actionContent } },
              ],
            });
          } else {
            return await this.apiCaller('send_private_msg', {
              user_id: userId,
              message: actionContent,
            });
          }

        case 'recall':
          return await this.apiCaller('delete_msg', { message_id: messageId });

        case 'ban':
          if (!groupId) {
            return { success: false, error: '禁言操作需要在群聊中' };
          }
          const duration = parseInt(actionContent) || 600;
          return await this.apiCaller('set_group_ban', {
            group_id: groupId,
            user_id: userId,
            duration,
          });

        case 'kick':
          if (!groupId) {
            return { success: false, error: '踢人操作需要在群聊中' };
          }
          return await this.apiCaller('set_group_kick', {
            group_id: groupId,
            user_id: userId,
          });

        case 'api_call':
          try {
            const apiData = JSON.parse(actionContent);
            return await this.apiCaller(apiData.action, apiData.params || {});
          } catch {
            return { success: false, error: 'API调用内容格式错误，需要JSON格式' };
          }

        default:
          return { success: false, error: `未知操作类型: ${watcher.action_type}` };
      }
    } catch (error) {
      console.error('[UserWatcher] 执行失败:', error);
      return { success: false, error: String(error) };
    }
  }
}

// 工具定义
export const USER_WATCHER_TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'add_user_watcher',
      description: '添加用户检测器，监控特定用户的消息并自动执行操作（仅主人可用）',
      parameters: {
        type: 'object',
        properties: {
          watcher_id: { type: 'string', description: '检测器ID，唯一标识' },
          target_user_id: { type: 'string', description: '目标用户QQ号' },
          action_type: {
            type: 'string',
            enum: ['reply', 'recall', 'ban', 'kick', 'api_call'],
            description: '操作类型：reply=回复消息，recall=撤回消息，ban=禁言，kick=踢出群，api_call=自定义API',
          },
          action_content: {
            type: 'string',
            description: '操作内容：reply时为回复文本，ban时为禁言秒数，api_call时为JSON格式的API调用',
          },
          group_id: { type: 'string', description: '限定群号，空则所有群生效' },
          keyword_filter: {
            type: 'string',
            description: '关键词过滤（正则表达式），空则匹配该用户所有消息',
          },
          cooldown_seconds: {
            type: 'integer',
            description: '冷却时间（秒），防止频繁触发，默认0',
          },
          description: { type: 'string', description: '检测器描述' },
        },
        required: ['watcher_id', 'target_user_id', 'action_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_user_watcher',
      description: '删除用户检测器（仅主人可用）',
      parameters: {
        type: 'object',
        properties: {
          watcher_id: { type: 'string', description: '检测器ID' },
        },
        required: ['watcher_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_user_watchers',
      description: '列出所有用户检测器',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'toggle_user_watcher',
      description: '启用/禁用用户检测器（仅主人可用）',
      parameters: {
        type: 'object',
        properties: {
          watcher_id: { type: 'string', description: '检测器ID' },
          enabled: { type: 'boolean', description: '是否启用' },
        },
        required: ['watcher_id', 'enabled'],
      },
    },
  },
];

// 导出单例
export const userWatcherManager = new UserWatcherManager();

// 执行用户检测器工具
export function executeUserWatcherTool(
  toolName: string,
  args: Record<string, unknown>
): ToolResult {
  switch (toolName) {
    case 'add_user_watcher':
      return userWatcherManager.addWatcher(
        args.watcher_id as string,
        args.target_user_id as string,
        args.action_type as 'reply' | 'recall' | 'ban' | 'kick' | 'api_call',
        args.action_content as string,
        args.group_id as string,
        args.keyword_filter as string,
        args.description as string,
        args.cooldown_seconds as number
      );
    case 'remove_user_watcher':
      return userWatcherManager.removeWatcher(args.watcher_id as string);
    case 'list_user_watchers':
      return userWatcherManager.listWatchers();
    case 'toggle_user_watcher':
      return userWatcherManager.toggleWatcher(args.watcher_id as string, args.enabled as boolean);
    default:
      return { success: false, error: `未知工具: ${toolName}` };
  }
}

export function getUserWatcherTools(): Tool[] {
  return USER_WATCHER_TOOLS;
}
