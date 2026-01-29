// AI Cat 插件配置
import type { AIConfig, PluginConfig } from './types';

export const DEFAULT_PLUGIN_CONFIG: PluginConfig = {
  prefix: 'xy', enableReply: true, botName: '汐雨', confirmMessage: '汐雨收到喵～',
  maxContextTurns: 10, ownerQQs: '', model: 'gpt-5', debug: false,
  apiSource: 'builtin', customApiUrl: '', customApiKey: '', customModel: 'gpt-4o',
};

export const MODEL_LIST: string[] = ['gpt-5-mini-ca', 'gpt-5-nano-ca', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gpt-4o', 'gpt-4o-mini', 'gpt-5-mini', 'gpt-4', 'gpt-5', 'gpt-5.1'];

export const DEFAULT_AI_CONFIG: AIConfig = { base_url: 'https://i.elaina.vin/api/openai/chat/completions', api_key: '', model: 'gpt-5', timeout: 60000 };

export const CONTEXT_MAX_TURNS = 10;
export const CONTEXT_EXPIRE_SECONDS = 600;
export const MAX_ROUNDS = 10;

export const ADMIN_REQUIRED_APIS = new Set(['set_group_ban', 'set_group_kick', 'set_group_admin', 'set_group_card', 'set_group_special_title', 'set_group_name', 'set_group_whole_ban', 'set_group_anonymous_ban', 'set_essence_msg', 'delete_essence_msg', 'send_group_notice', 'set_group_portrait', 'upload_group_file', 'delete_group_file', 'create_group_file_folder']);

export const OWNER_ONLY_TOOLS = new Set(['query_history_messages', 'query_error_logs']);
export const OWNER_ONLY_CUSTOM_TOOLS = new Set(['add_custom_command', 'remove_custom_command', 'toggle_custom_command', 'add_scheduled_task', 'remove_scheduled_task', 'toggle_scheduled_task', 'run_scheduled_task_now', 'add_user_watcher', 'remove_user_watcher', 'toggle_user_watcher']);

export function generateSystemPrompt (botName: string = '汐雨'): string {
  return `你是${botName}，基于NapCat的可爱猫娘助手喵～说话带"喵"等语气词，活泼俏皮会撒娇。

【调用方式】使用call_api工具，传入action(接口名)和params(参数对象)

【常用API】
消息: send_group_msg / send_private_msg / delete_msg / get_msg
查询: get_login_info / get_friend_list / get_group_list / get_group_member_info
群管: set_group_card / set_group_ban / set_group_kick / set_essence_msg

【其他工具】web_search / fetch_url / 自定义指令 / 定时任务 / 用户检测器

【规则】使用当前群号，不能跨群；回复简短可爱，带猫娘语气喵～`;
}

export const SYSTEM_PROMPT = generateSystemPrompt();
