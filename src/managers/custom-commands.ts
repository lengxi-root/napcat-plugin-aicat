// 自定义指令管理器
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { CustomCommand, Tool, ToolResult } from '../types';

// 数据目录（相对于插件目录）
let DATA_DIR = '';
let COMMANDS_FILE = '';

// 初始化数据目录
export function initDataDir(dataPath: string): void {
  DATA_DIR = dataPath;
  COMMANDS_FILE = join(DATA_DIR, 'custom_commands.json');
  
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

class CustomCommandManager {
  private commands: Map<string, CustomCommand> = new Map();

  constructor() {
    this.loadCommands();
  }

  /**
   * 加载指令
   */
  loadCommands(): void {
    if (!COMMANDS_FILE || !existsSync(COMMANDS_FILE)) return;
    
    try {
      const data = JSON.parse(readFileSync(COMMANDS_FILE, 'utf-8'));
      this.commands = new Map(Object.entries(data));
    } catch (error) {
      console.error('[CustomCommands] 加载失败:', error);
    }
  }

  /**
   * 保存指令
   */
  private saveCommands(): void {
    if (!COMMANDS_FILE) return;
    
    try {
      const dir = dirname(COMMANDS_FILE);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data = Object.fromEntries(this.commands);
      writeFileSync(COMMANDS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[CustomCommands] 保存失败:', error);
    }
  }

  /**
   * 添加指令
   */
  addCommand(
    commandId: string,
    pattern: string,
    responseType: 'text' | 'api',
    responseContent: string = '',
    apiUrl: string = '',
    apiMethod: 'GET' | 'POST' = 'GET',
    apiExtract: string = '',
    description: string = ''
  ): ToolResult {
    // 验证正则表达式
    try {
      new RegExp(pattern);
    } catch (error) {
      return { success: false, error: `正则表达式无效: ${error}` };
    }

    this.commands.set(commandId, {
      pattern,
      response_type: responseType,
      response_content: responseContent,
      api_url: apiUrl,
      api_method: apiMethod,
      api_extract: apiExtract,
      description,
      enabled: true,
      created_at: new Date().toISOString(),
    });

    this.saveCommands();
    return { success: true, message: `指令 '${commandId}' 已添加` };
  }

  /**
   * 删除指令
   */
  removeCommand(commandId: string): ToolResult {
    if (this.commands.has(commandId)) {
      this.commands.delete(commandId);
      this.saveCommands();
      return { success: true, message: `指令 '${commandId}' 已删除` };
    }
    return { success: false, error: `指令 '${commandId}' 不存在` };
  }

  /**
   * 切换指令状态
   */
  toggleCommand(commandId: string, enabled: boolean): ToolResult {
    const cmd = this.commands.get(commandId);
    if (!cmd) {
      return { success: false, error: `指令 '${commandId}' 不存在` };
    }
    cmd.enabled = enabled;
    this.saveCommands();
    return { success: true, message: `指令 '${commandId}' 已${enabled ? '启用' : '禁用'}` };
  }

  /**
   * 列出所有指令
   */
  listCommands(): ToolResult {
    const cmdList = Array.from(this.commands.entries()).map(([id, cmd]) => ({
      id,
      pattern: cmd.pattern,
      type: cmd.response_type,
      description: cmd.description || '',
      enabled: cmd.enabled,
    }));
    return { success: true, data: cmdList, count: cmdList.length };
  }

  /**
   * 匹配并执行指令
   */
  async matchAndExecute(
    content: string,
    userId: string,
    groupId: string,
    nickname: string
  ): Promise<string | null> {
    for (const [, cmd] of this.commands) {
      if (!cmd.enabled) continue;

      try {
        const match = content.match(new RegExp(cmd.pattern));
        if (match) {
          return await this.executeCommand(cmd, match, userId, groupId, nickname);
        }
      } catch (error) {
        console.error('[CustomCommands] 执行失败:', error);
      }
    }
    return null;
  }

  /**
   * 执行指令
   */
  private async executeCommand(
    cmd: CustomCommand,
    match: RegExpMatchArray,
    userId: string,
    groupId: string,
    nickname: string
  ): Promise<string> {
    if (cmd.response_type === 'text') {
      let response = cmd.response_content;
      
      // 替换捕获组
      for (let i = 1; i < match.length; i++) {
        if (match[i]) {
          response = response.replace(new RegExp(`\\$${i}`, 'g'), match[i]);
        }
      }
      
      // 替换变量
      response = response.replace(/\{user_id\}/g, userId);
      response = response.replace(/\{group_id\}/g, groupId);
      response = response.replace(/\{nickname\}/g, nickname);
      
      return response;
    } else if (cmd.response_type === 'api') {
      return await this.callApi(cmd, match, userId);
    }
    
    return '';
  }

  /**
   * 调用 API
   */
  private async callApi(
    cmd: CustomCommand,
    match: RegExpMatchArray,
    userId: string
  ): Promise<string> {
    try {
      let url = cmd.api_url || '';
      
      // 替换捕获组
      for (let i = 1; i < match.length; i++) {
        if (match[i]) {
          url = url.replace(new RegExp(`\\$${i}`, 'g'), match[i]);
        }
      }
      url = url.replace(/\{user_id\}/g, userId);

      const response = await fetch(url, {
        method: cmd.api_method || 'GET',
      });
      
      const data = await response.json();
      
      // 提取数据
      const extractPath = cmd.api_extract || '';
      if (extractPath) {
        let result: unknown = data;
        for (const key of extractPath.split('.')) {
          if (result && typeof result === 'object' && key in result) {
            result = (result as Record<string, unknown>)[key];
          }
        }
        return String(result) || 'API 返回为空';
      }
      
      return JSON.stringify(data);
    } catch (error) {
      return `API 调用失败: ${error}`;
    }
  }

  /**
   * 获取所有指令模式（用于正则匹配）
   */
  getPatterns(): Map<string, string> {
    const patterns = new Map<string, string>();
    for (const [id, cmd] of this.commands) {
      if (cmd.enabled) {
        patterns.set(id, cmd.pattern);
      }
    }
    return patterns;
  }
}

// 工具定义
export const CUSTOM_COMMAND_TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'add_custom_command',
      description: '添加自定义指令',
      parameters: {
        type: 'object',
        properties: {
          command_id: { type: 'string', description: '指令ID' },
          pattern: { type: 'string', description: '正则表达式' },
          response_type: {
            type: 'string',
            enum: ['text', 'api'],
            description: '响应类型',
          },
          response_content: { type: 'string', description: '固定回复内容(text类型)' },
          api_url: { type: 'string', description: 'API地址(api类型)' },
          api_extract: { type: 'string', description: 'API响应提取路径' },
          description: { type: 'string', description: '指令描述' },
        },
        required: ['command_id', 'pattern', 'response_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_custom_command',
      description: '删除自定义指令',
      parameters: {
        type: 'object',
        properties: {
          command_id: { type: 'string', description: '指令ID' },
        },
        required: ['command_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_custom_commands',
      description: '列出所有自定义指令',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'toggle_custom_command',
      description: '启用/禁用自定义指令',
      parameters: {
        type: 'object',
        properties: {
          command_id: { type: 'string', description: '指令ID' },
          enabled: { type: 'boolean', description: '是否启用' },
        },
        required: ['command_id', 'enabled'],
      },
    },
  },
];

// 导出单例
export const commandManager = new CustomCommandManager();

/**
 * 执行自定义指令工具
 */
export function executeCustomCommandTool(
  toolName: string,
  args: Record<string, unknown>
): ToolResult {
  switch (toolName) {
    case 'add_custom_command':
      return commandManager.addCommand(
        args.command_id as string,
        args.pattern as string,
        args.response_type as 'text' | 'api',
        args.response_content as string,
        args.api_url as string,
        args.api_method as 'GET' | 'POST',
        args.api_extract as string,
        args.description as string
      );
    case 'remove_custom_command':
      return commandManager.removeCommand(args.command_id as string);
    case 'list_custom_commands':
      return commandManager.listCommands();
    case 'toggle_custom_command':
      return commandManager.toggleCommand(args.command_id as string, args.enabled as boolean);
    default:
      return { success: false, error: `未知工具: ${toolName}` };
  }
}

export function getCustomCommandTools(): Tool[] {
  return CUSTOM_COMMAND_TOOLS;
}
