// 消息日志记录器 - 按群/私聊分类存储
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

// 消息记录接口
export interface MessageRecord {
  id?: number;
  message_id: string;
  user_id: string;
  user_name: string;
  group_id: string;
  group_name: string;
  message_type: 'private' | 'group';
  content: string;
  raw_message: string;
  timestamp: number;
  created_at: string;
}

// 查询选项
export interface QueryOptions {
  user_id?: string;
  group_id?: string;
  keyword?: string;
  limit?: number;
  offset?: number;
  start_time?: number;
  end_time?: number;
}

// 日志文件数据结构
interface LogFileData {
  nextId: number;
  messages: MessageRecord[];
  savedAt: string;
}

// 内存缓存：按文件名存储
const messageCache: Map<string, MessageRecord[]> = new Map();
const nextIdCache: Map<string, number> = new Map();
const dirtyFiles: Set<string> = new Set();

// 日志目录
let LOG_DIR = '';

// 配置
const SAVE_INTERVAL = 60000; // 自动保存间隔（毫秒）
const MAX_MESSAGES_PER_FILE = 5000; // 每个文件最大消息数
let saveTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 获取日志文件路径
 */
function getLogFilePath (messageType: 'private' | 'group', targetId: string): string {
  const filename = messageType === 'group' ? `group_${targetId}.json` : `private_${targetId}.json`;
  return join(LOG_DIR, filename);
}

/**
 * 获取缓存键
 */
function getCacheKey (messageType: 'private' | 'group', targetId: string): string {
  return messageType === 'group' ? `group_${targetId}` : `private_${targetId}`;
}

/**
 * 加载日志文件
 */
function loadLogFile (cacheKey: string): MessageRecord[] {
  if (messageCache.has(cacheKey)) {
    return messageCache.get(cacheKey)!;
  }

  const filePath = join(LOG_DIR, `${cacheKey}.json`);

  if (!existsSync(filePath)) {
    messageCache.set(cacheKey, []);
    nextIdCache.set(cacheKey, 1);
    return [];
  }

  try {
    const data: LogFileData = JSON.parse(readFileSync(filePath, 'utf-8'));
    const messages = Array.isArray(data.messages) ? data.messages : [];
    messageCache.set(cacheKey, messages);
    nextIdCache.set(cacheKey, data.nextId || (messages.length > 0 ? Math.max(...messages.map(m => m.id || 0)) + 1 : 1));
    return messages;
  } catch (error) {
    console.error(`[MessageLogger] 加载日志文件失败 ${cacheKey}:`, error);
    messageCache.set(cacheKey, []);
    nextIdCache.set(cacheKey, 1);
    return [];
  }
}

/**
 * 保存日志文件
 */
function saveLogFile (cacheKey: string): void {
  const messages = messageCache.get(cacheKey);
  if (!messages) return;

  const filePath = join(LOG_DIR, `${cacheKey}.json`);

  try {
    const data: LogFileData = {
      nextId: nextIdCache.get(cacheKey) || 1,
      messages,
      savedAt: new Date().toISOString(),
    };
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`[MessageLogger] 保存日志文件失败 ${cacheKey}:`, error);
  }
}

/**
 * 保存所有脏文件
 */
function saveAllDirtyFiles (): void {
  for (const cacheKey of dirtyFiles) {
    saveLogFile(cacheKey);
  }
  dirtyFiles.clear();
}

/**
 * 初始化消息日志记录器
 * @param dataPath 数据目录路径
 */
export async function initMessageLogger (dataPath: string): Promise<boolean> {
  try {
    // 使用传入的数据目录下的 log 子目录
    LOG_DIR = join(dataPath, 'log');

    // 确保目录存在
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }

    // 启动自动保存定时器
    saveTimer = setInterval(() => {
      if (dirtyFiles.size > 0) {
        saveAllDirtyFiles();
      }
    }, SAVE_INTERVAL);

    console.log(`[MessageLogger] 已初始化，日志目录: ${LOG_DIR}`);
    return true;
  } catch (error) {
    console.error('[MessageLogger] 初始化失败:', error);
    return false;
  }
}

/**
 * 记录消息
 */
export function logMessage (record: Omit<MessageRecord, 'id' | 'created_at'>): void {
  const targetId = record.message_type === 'group' ? record.group_id : record.user_id;

  // 跳过空 ID
  if (!targetId) return;

  const cacheKey = getCacheKey(record.message_type, targetId);
  const messages = loadLogFile(cacheKey);

  const created_at = new Date().toISOString();
  const nextId = nextIdCache.get(cacheKey) || 1;

  messages.push({
    ...record,
    id: nextId,
    created_at,
  });

  nextIdCache.set(cacheKey, nextId + 1);

  // 限制每个文件的消息数量
  if (messages.length > MAX_MESSAGES_PER_FILE) {
    messages.splice(0, messages.length - MAX_MESSAGES_PER_FILE);
  }

  dirtyFiles.add(cacheKey);
}

/**
 * 查询消息
 */
export function queryMessages (options: QueryOptions = {}): MessageRecord[] {
  const {
    user_id,
    group_id,
    keyword,
    limit = 20,
    offset = 0,
    start_time,
    end_time,
  } = options;

  let results: MessageRecord[] = [];

  // 如果指定了 group_id，只查该群的日志
  if (group_id) {
    const cacheKey = getCacheKey('group', group_id);
    results = [...loadLogFile(cacheKey)];
  }
  // 如果指定了 user_id 但没有 group_id，查私聊日志
  else if (user_id && !group_id) {
    const cacheKey = getCacheKey('private', user_id);
    results = [...loadLogFile(cacheKey)];
  }
  // 否则加载所有日志
  else {
    try {
      const files = readdirSync(LOG_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const cacheKey = file.replace('.json', '');
        const messages = loadLogFile(cacheKey);
        results.push(...messages);
      }
    } catch {
      // 目录不存在或读取失败
    }
  }

  // 按用户过滤
  if (user_id) {
    results = results.filter(m => m.user_id === user_id);
  }

  // 关键词过滤
  if (keyword) {
    const kw = keyword.toLowerCase();
    results = results.filter(m => m.content.toLowerCase().includes(kw));
  }

  // 时间过滤
  if (start_time) {
    results = results.filter(m => m.timestamp >= start_time);
  }
  if (end_time) {
    results = results.filter(m => m.timestamp <= end_time);
  }

  // 按时间倒序
  results.sort((a, b) => b.timestamp - a.timestamp);
  return results.slice(offset, offset + limit);
}

/**
 * 获取消息统计
 */
export function getMessageStats (group_id?: string): {
  total: number;
  today: number;
  users: number;
  files: number;
} {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTs = Math.floor(todayStart.getTime() / 1000);

  let results: MessageRecord[] = [];
  let fileCount = 0;

  if (group_id) {
    const cacheKey = getCacheKey('group', group_id);
    results = loadLogFile(cacheKey);
    fileCount = 1;
  } else {
    try {
      const files = readdirSync(LOG_DIR).filter(f => f.endsWith('.json'));
      fileCount = files.length;
      for (const file of files) {
        const cacheKey = file.replace('.json', '');
        const messages = loadLogFile(cacheKey);
        results.push(...messages);
      }
    } catch {
      // 目录不存在或读取失败
    }
  }

  const users = new Set(results.map(m => m.user_id));
  const today = results.filter(m => m.timestamp >= todayTs).length;

  return {
    total: results.length,
    today,
    users: users.size,
    files: fileCount,
  };
}

/**
 * 根据 message_id 获取消息
 */
export function getMessageById (message_id: string): MessageRecord | null {
  try {
    const files = readdirSync(LOG_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const cacheKey = file.replace('.json', '');
      const messages = loadLogFile(cacheKey);
      const found = messages.find(m => m.message_id === message_id);
      if (found) return found;
    }
  } catch {
    // 目录不存在或读取失败
  }
  return null;
}

/**
 * 清理旧消息（保留最近 N 天）
 */
export function cleanupOldMessages (days: number = 7): number {
  const cutoff = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
  let totalDeleted = 0;

  try {
    const files = readdirSync(LOG_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const cacheKey = file.replace('.json', '');
      const messages = loadLogFile(cacheKey);
      const before = messages.length;

      // 过滤保留新消息
      const filtered = messages.filter(m => m.timestamp >= cutoff);
      const deleted = before - filtered.length;

      if (deleted > 0) {
        messageCache.set(cacheKey, filtered);
        dirtyFiles.add(cacheKey);
        totalDeleted += deleted;
      }
    }
  } catch {
    // 目录不存在或读取失败
  }

  return totalDeleted;
}

/**
 * 关闭消息日志记录器
 */
export function closeMessageLogger (): void {
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }

  // 保存所有脏文件
  saveAllDirtyFiles();
}

/**
 * 获取存储类型
 */
export function getStorageType (): 'json' | 'memory' {
  return LOG_DIR ? 'json' : 'memory';
}

/**
 * 获取日志目录
 */
export function getLogDirectory (): string {
  return LOG_DIR;
}

/**
 * 获取所有日志文件列表
 */
export function getLogFiles (): { name: string; type: 'group' | 'private'; id: string; count: number; }[] {
  const result: { name: string; type: 'group' | 'private'; id: string; count: number; }[] = [];

  try {
    const files = readdirSync(LOG_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const cacheKey = file.replace('.json', '');
      const messages = loadLogFile(cacheKey);

      let type: 'group' | 'private' = 'group';
      let id = '';

      if (cacheKey.startsWith('group_')) {
        type = 'group';
        id = cacheKey.replace('group_', '');
      } else if (cacheKey.startsWith('private_')) {
        type = 'private';
        id = cacheKey.replace('private_', '');
      }

      result.push({
        name: file,
        type,
        id,
        count: messages.length,
      });
    }
  } catch {
    // 目录不存在或读取失败
  }

  return result;
}

/**
 * 搜索消息（支持正则）
 */
export function searchMessages (pattern: string, options: QueryOptions = {}): MessageRecord[] {
  const { group_id, user_id, limit = 20 } = options;

  let results: MessageRecord[] = [];

  // 如果指定了 group_id，只查该群
  if (group_id) {
    const cacheKey = getCacheKey('group', group_id);
    results = [...loadLogFile(cacheKey)];
  } else if (user_id) {
    // 查私聊
    const cacheKey = getCacheKey('private', user_id);
    results = [...loadLogFile(cacheKey)];
  } else {
    // 查所有
    try {
      const files = readdirSync(LOG_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const cacheKey = file.replace('.json', '');
        const messages = loadLogFile(cacheKey);
        results.push(...messages);
      }
    } catch {
      // 目录不存在或读取失败
    }
  }

  // 再按用户过滤
  if (user_id && group_id) {
    results = results.filter(m => m.user_id === user_id);
  }

  try {
    const regex = new RegExp(pattern, 'i');
    results = results.filter(m => regex.test(m.content));
  } catch {
    // 无效正则，使用普通搜索
    const kw = pattern.toLowerCase();
    results = results.filter(m => m.content.toLowerCase().includes(kw));
  }

  results.sort((a, b) => b.timestamp - a.timestamp);
  return results.slice(0, limit);
}
