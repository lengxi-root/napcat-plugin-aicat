// AI Cat 插件配置
import type { AIConfig, PluginConfig } from './types';
export const DEFAULT_PLUGIN_CONFIG: PluginConfig = {
  prefix: 'xy',
  enableReply: true,
  botName: '汐雨',
  confirmMessage: '汐雨收到喵～',
  maxContextTurns: 10,
  ownerQQs: '',
  model: 'gpt-5',
  debug: false,
};

// 可用模型列表
export const MODEL_LIST: string[] = [
  'gpt-5-mini-ca',
  'gpt-5-nano-ca',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-5-mini',
  'gpt-4',
  'gpt-5',
  'gpt-5.1',
];

// 默认 AI 配置
export const DEFAULT_AI_CONFIG: AIConfig = {
  base_url: 'https://i.elaina.vin/api/openai/chat/completions',
  api_key: '',
  model: 'gpt-5',
  timeout: 60000,
};

// 上下文配置
export const CONTEXT_MAX_TURNS = 10;
export const CONTEXT_EXPIRE_SECONDS = 600;
export const MAX_ROUNDS = 10;

// 需要管理员权限的 API
export const ADMIN_REQUIRED_APIS = new Set([
  'set_group_ban',
  'set_group_kick',
  'set_group_admin',
  'set_group_card',
  'set_group_special_title',
  'set_group_name',
  'set_group_whole_ban',
  'set_group_anonymous_ban',
  'set_essence_msg',
  'delete_essence_msg',
  'send_group_notice',
  'set_group_portrait',
  'upload_group_file',
  'delete_group_file',
  'create_group_file_folder',
]);

// 仅主人可用的工具
export const OWNER_ONLY_TOOLS = new Set([
  'query_history_messages',
  'query_error_logs',
]);

export const OWNER_ONLY_CUSTOM_TOOLS = new Set([
  'add_custom_command',
  'remove_custom_command',
  'toggle_custom_command',
  'add_scheduled_task',
  'remove_scheduled_task',
  'toggle_scheduled_task',
  'run_scheduled_task_now',
  'add_user_watcher',
  'remove_user_watcher',
  'toggle_user_watcher',
]);

// 生成系统提示词
export function generateSystemPrompt (botName: string = '汐雨'): string {
  return `你是${botName}，基于 NapCat 框架的可爱猫娘助手喵～说话带"喵"等语气词，活泼俏皮会撒娇。

【调用方式】使用 call_api 工具调用接口，传入 action(接口名) 和 params(参数对象)

【常用API】
消息: send_group_msg / send_private_msg / delete_msg / get_msg / send_group_forward_msg
互动: group_poke / friend_poke / set_msg_emoji_like
查询: get_login_info / get_stranger_info / get_friend_list / get_group_list / get_group_info / get_group_member_info / get_group_member_list
群管理: set_group_card / set_group_ban / set_group_kick / set_group_admin / set_group_name / set_group_whole_ban / set_essence_msg / send_group_notice
扩展: get_ai_characters / send_group_ai_record / ocr_image / get_group_file_url

【其他工具】web_search / fetch_url

【主人工具】自定义指令 / 定时任务 / 用户检测器

【消息格式】[{"type":"text","data":{"text":"内容"}}, {"type":"at","data":{"qq":"123456"}}]

【规则】
- 使用当前群号，不能跨群操作
- 回复简短可爱，带猫娘语气喵～
- 管理操作前确认用户有权限`;
}

export const SYSTEM_PROMPT = generateSystemPrompt();
