// AI Cat 插件类型定义
export interface PluginConfig {
  prefix: string;
  enableReply: boolean;
  sendConfirmMessage: boolean;  // 是否发送确认消息
  botName: string;
  personality: string;  // AI 个性描述
  confirmMessage: string;
  maxContextTurns: number;
  ownerQQs: string;
  model: string;
  debug: boolean;
  apiSource: 'main' | 'custom';
  customApiUrl: string;
  customApiKey: string;
  customModel: string;
  allowPublicPacket: boolean;
  autoSwitchModel: boolean;  // 自动切换可用模型
  allowAtTrigger: boolean;   // 允许@机器人触发（无需前缀）
  [key: string]: unknown;
}

export interface AIConfig { base_url: string; api_key: string; model: string; timeout: number; }

export interface ToolFunction {
  name: string; description: string;
  parameters: { type: 'object'; properties: Record<string, { type: string; description?: string; enum?: string[]; default?: unknown; }>; required?: string[]; };
}

export interface Tool { type: 'function'; function: ToolFunction; }
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string; }; }
export interface AIMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: ToolCall[]; }
export interface AIResponse { choices: { message: AIMessage; finish_reason: string; }[]; error?: string; detail?: string; }
export interface ToolResult { success: boolean; data?: unknown; error?: string; message?: string; count?: number; }

export interface CustomCommand {
  pattern: string; response_type: 'text' | 'api'; response_content: string;
  api_url?: string; api_method?: 'GET' | 'POST'; api_extract?: string;
  description?: string; enabled: boolean; created_at: string;
}

export interface ScheduledTask {
  task_type: 'send_message' | 'api_call'; target_type: 'group' | 'private';
  target_id: string; content: string; interval_seconds: number; daily_time: string;
  repeat: boolean; description?: string; enabled: boolean; created_at: string;
  last_run: string | null; run_count: number;
}

export interface UserWatcher {
  target_user_id: string; action_type: 'reply' | 'recall' | 'ban' | 'kick' | 'api_call';
  action_content: string; group_id: string; keyword_filter: string;
  description?: string; cooldown_seconds: number; enabled: boolean;
  created_at: string; last_triggered: string | null; trigger_count: number;
}

export interface UserPermission { is_admin: boolean; is_owner: boolean; role: 'owner' | 'admin' | 'member'; }
export interface ContextInfo { turns: number; messages: number; expired: boolean; }
export interface MessageLog { message_id: string; user_id: string; user_name: string; group_id: string; group_name: string; message_type: 'private' | 'group'; content: string; raw_message: string; timestamp: number; }
export interface ActionMap { call: (action: string, params: unknown, adapter: string, config: unknown) => Promise<unknown>; get: (action: string) => unknown; }
