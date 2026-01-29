// AI Cat 插件类型定义
export interface PluginConfig {
  prefix: string;
  enableReply: boolean;
  botName: string;
  confirmMessage: string;
  maxContextTurns: number;
  ownerQQs: string;
  model: string;
  debug: boolean;
  // OpenAI API 配置
  apiSource: 'builtin' | 'custom';
  customApiUrl: string;
  customApiKey: string;
  customModel: string;
  [key: string]: unknown;
}

// AI 服务配置
export interface AIConfig {
  base_url: string;
  api_key: string;
  model: string;
  timeout: number;
}

// 工具函数定义
export interface ToolFunction {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      default?: unknown;
    }>;
    required?: string[];
  };
}

// 工具定义
export interface Tool {
  type: 'function';
  function: ToolFunction;
}

// 工具调用
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// AI 消息
export interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

// AI 响应
export interface AIResponse {
  choices: {
    message: AIMessage;
    finish_reason: string;
  }[];
  error?: string;
  detail?: string;
}

// 工具执行结果
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  message?: string;
  count?: number;
}

// 自定义指令
export interface CustomCommand {
  pattern: string;
  response_type: 'text' | 'api';
  response_content: string;
  api_url?: string;
  api_method?: 'GET' | 'POST';
  api_extract?: string;
  description?: string;
  enabled: boolean;
  created_at: string;
}

// 定时任务
export interface ScheduledTask {
  task_type: 'send_message' | 'api_call';
  target_type: 'group' | 'private';
  target_id: string;
  content: string;
  interval_seconds: number;
  daily_time: string;
  repeat: boolean;
  description?: string;
  enabled: boolean;
  created_at: string;
  last_run: string | null;
  run_count: number;
}

// 用户检测器
export interface UserWatcher {
  target_user_id: string;
  action_type: 'reply' | 'recall' | 'ban' | 'kick' | 'api_call';
  action_content: string;
  group_id: string;
  keyword_filter: string;
  description?: string;
  cooldown_seconds: number;
  enabled: boolean;
  created_at: string;
  last_triggered: string | null;
  trigger_count: number;
}

// 用户权限
export interface UserPermission {
  is_admin: boolean;
  is_owner: boolean;
  role: 'owner' | 'admin' | 'member';
}

// 上下文信息
export interface ContextInfo {
  turns: number;
  messages: number;
  expired: boolean;
}

// 消息日志
export interface MessageLog {
  message_id: string;
  user_id: string;
  user_name: string;
  group_id: string;
  group_name: string;
  message_type: 'private' | 'group';
  content: string;
  raw_message: string;
  timestamp: number;
}

// ActionMap 接口
export interface ActionMap {
  call: (action: string, params: unknown, adapter: string, config: unknown) => Promise<unknown>;
  get: (action: string) => unknown;
}
