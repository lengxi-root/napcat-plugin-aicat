// AI Cat 插件配置
import type { AIConfig, PluginConfig } from './types';

// 默认插件配置
export const DEFAULT_PLUGIN_CONFIG: PluginConfig = {
  prefix: 'xy',
  enableReply: true,
  sendConfirmMessage: true,
  botName: '汐雨',
  personality: '可爱猫娘助手，说话带"喵"等语气词，活泼俏皮会撒娇',
  confirmMessage: '汐雨收到喵～',
  maxContextTurns: 10,
  ownerQQs: '',
  model: 'gpt-5',
  debug: false,
  apiSource: 'main',
  customApiUrl: '',
  customApiKey: '',
  customModel: 'gpt-4o',
  allowPublicPacket: true,
  autoSwitchModel: true,
};

// 模型列表（可从 API 动态更新）
export let MODEL_LIST: string[] = [
  'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.1',
  'gpt-4o', 'gpt-4o-mini', 'gpt-4', 'gpt-4-turbo',
  'claude-3-5-sonnet', 'claude-3-5-haiku',
  'deepseek-chat', 'deepseek-reasoner',
  'gemini-2.5-flash', 'gemini-2.5-pro',
];

// 默认AI配置
export const DEFAULT_AI_CONFIG: AIConfig = {
  base_url: 'https://i.elaina.vin/api/openai/chat/completions',
  api_key: '',
  model: 'gpt-5',
  timeout: 60000,
};

// 从 API 获取模型列表
export async function fetchModelList (): Promise<string[]> {
  try {
    const apiBase = DEFAULT_AI_CONFIG.base_url.replace('/chat/completions', '');
    const res = await fetch(`${apiBase}/models`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json() as { chat?: string[]; success?: boolean; };
      if (data.success && data.chat?.length) {
        MODEL_LIST = data.chat;
      }
    }
  } catch { /* ignore */ }
  return MODEL_LIST;
}

// 获取模型选项列表
export function getModelOptions (): { label: string; value: string; }[] {
  return MODEL_LIST.map(m => ({ label: m, value: m }));
}

// 上下文配置
export const CONTEXT_MAX_TURNS = 10;
export const CONTEXT_EXPIRE_SECONDS = 600;
export const MAX_ROUNDS = 20;

// 权限控制 API 集合
// 公开接口(所有人可用): 发消息、戳一戳、点赞、查询消息、表情回应、AI语音等 - 不在限制集合中

// 需要群管理员权限的接口
export const ADMIN_REQUIRED_APIS = new Set([
  // 群成员管理
  'set_group_ban', 'set_group_kick', 'set_group_whole_ban', 'set_group_anonymous_ban',
  'kick_group_member_batch',
  // 群权限管理
  'set_group_admin', 'set_group_special_title',
  // 群设置
  'set_group_name', 'set_group_portrait', 'set_group_add_option',
  'set_group_bot_add_option', 'set_group_search',
  // 精华消息
  'set_essence_msg', 'delete_essence_msg',
  // 群公告
  'send_group_notice', '_send_group_notice', '_delete_group_notice',
  // 群文件管理
  'delete_group_file', 'delete_group_folder',
  // 群待办
  'set_group_todo',
  // 加群请求处理
  'set_group_add_request',
]);

// 仅主人可用的接口
export const OWNER_ONLY_APIS = new Set([
  // 账号敏感信息
  'get_login_info', 'get_friend_list', 'get_group_list',
  'get_friends_with_category', 'get_unidirectional_friend_list',
  // 账号操作
  'set_qq_avatar', 'set_self_longnick', 'set_qq_profile',
  'set_online_status', 'set_custom_online_status',
  // 好友敏感操作
  'delete_friend', 'set_friend_add_request', 'set_friend_remark',
  // 密钥相关
  'get_cookies', 'get_csrf_token', 'get_credentials',
  'nc_get_rkey', 'get_rkey', 'get_clientkey', 'get_rkey_server',
  // 系统操作
  'set_restart', 'clean_cache', '_get_model_show', '_set_model_show',
  'get_online_clients', 'get_robot_uin_range', 'nc_get_packet_status',
  // 收藏
  'create_collection', 'get_collection_list',
  // 危险操作
  'log_out', 'send_packet', 'set_group_leave',
  // 可疑好友
  'get_doubtful_friends', 'set_doubtful_friend',
]);

export const OWNER_ONLY_TOOLS = new Set(['query_error_logs']);
export const OWNER_ONLY_CUSTOM_TOOLS = new Set([
  'add_custom_command', 'remove_custom_command', 'toggle_custom_command',
  'add_scheduled_task', 'remove_scheduled_task', 'toggle_scheduled_task', 'run_scheduled_task_now',
  'add_user_watcher', 'remove_user_watcher', 'toggle_user_watcher',
]);

// 生成系统提示词
export function generateSystemPrompt (botName = '汐雨', personality = ''): string {
  const defaultPersonality = '可爱猫娘助手，说话带"喵"等语气词，活泼俏皮会撒娇';
  const persona = personality || defaultPersonality;
  return `你是${botName}，${persona}。用call_api工具调用接口(action,params)

【常用接口】
send_group_msg{group_id,message} send_private_msg{user_id,message} delete_msg{message_id}
send_group_forward_msg{group_id,messages} get_msg{message_id} get_group_member_info{group_id,user_id}
set_group_ban{group_id,user_id,duration} set_group_kick{group_id,user_id} set_group_card{group_id,user_id,card}
send_like{user_id,times} get_group_list{} get_friend_list{}

【消息段(仅API调用时用)】
文本{"type":"text","data":{"text":""}}/图片{"type":"image","data":{"file":"URL"}}/at{"type":"at","data":{"qq":""}}/回复{"type":"reply","data":{"id":""}}/表情{"type":"face","data":{"id":""}}/语音{"type":"record","data":{"file":""}}/视频{"type":"video","data":{"file":""}}

【转发节点】node={user_id,nickname,content:[消息段]} 嵌套:content放node数组
示例: [{node:普通},{node:content:[{node:子1},{node:子2}]}]

【定时任务工具(插件内置)】
add_scheduled_task: 添加定时任务
  参数: {task_id, task_type, target_type, target_id, content, daily_time?, interval_seconds?, run_now?}
  task_type: send_message(发消息) | api_call(调用API)
  target_type: group(群) | private(私聊)
  daily_time: "HH:MM" 每日定时 / interval_seconds: 间隔秒数
示例: add_scheduled_task({task_id:"morning",task_type:"send_message",target_type:"group",target_id:"123456",content:"早安喵～",daily_time:"08:00"})
示例: add_scheduled_task({task_id:"hourly",task_type:"send_message",target_type:"group",target_id:"123456",content:"整点报时",interval_seconds:3600})
remove_scheduled_task{task_id} / list_scheduled_tasks / toggle_scheduled_task{task_id} / run_scheduled_task_now{task_id}

【用户监控工具(插件内置)】
add_user_watcher: 添加消息监控器
  参数: {watcher_id, target_user_id, group_id?, keyword_filter?, action_type, action_content?}
  target_user_id: 指定QQ号 或 * 表示监控所有人
  group_id: 指定群号(不填则监控所有群)
  keyword_filter: 关键词过滤(不填则匹配所有消息)
  action_type: reply(回复) | recall(撤回) | ban(禁言) | kick(踢出) | api_call(调用API)
  action_content: 回复内容 或 API调用JSON
示例: add_user_watcher({watcher_id:"ad_filter",target_user_id:"*",group_id:"123456",keyword_filter:"广告",action_type:"recall"})
示例: add_user_watcher({watcher_id:"hello",target_user_id:"*",keyword_filter:"你好",action_type:"reply",action_content:"你好呀喵～"})
remove_user_watcher{watcher_id} / list_user_watchers / toggle_user_watcher{watcher_id}

【消息记录工具(插件内置)】
query_history_messages{group_id?,user_id?,keyword?,limit?,hours_ago?} 查询历史消息
search_messages{pattern,group_id?,limit?} 正则搜索消息
get_message_stats{group_id?} 获取消息统计
get_message_by_id{message_id} 通过ID获取消息

【网络工具】web_search{query} / fetch_url{url}

【NapCat API文档 - 不熟悉的接口用fetch_url查询】
完整接口索引: https://napcat.apifox.cn/llms.txt (包含所有API链接,先查这个找到具体接口URL)
消息接口: https://napcat.apifox.cn/77363176f0.md
群聊接口: https://napcat.apifox.cn/77363177f0.md
账号接口: https://napcat.apifox.cn/77363175f0.md
文件接口: https://napcat.apifox.cn/77363182f0.md

【规则】回复直接输出纯文本(不要JSON消息段);用当前群号不跨群;无需调send_msg;每次只回复一条`;
}
