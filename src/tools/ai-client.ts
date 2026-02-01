// AI 客户端 - 调用 OpenAI 兼容 API
import type { AIConfig, AIMessage, AIResponse, Tool } from '../types';
import { MODEL_LIST, BACKUP_MODEL_LIST } from '../config';

// 请求附加信息（机器人、主人、用户）
export interface RequestMeta {
  bot_id?: string;
  owner_ids?: string[];
  user_id?: string;
}

export class AIClient {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private timeout: number;
  private apiType: number;
  private meta: RequestMeta = {};

  constructor(config: AIConfig) {
    this.baseUrl = config.base_url;
    this.apiKey = config.api_key;
    this.model = config.model;
    this.timeout = config.timeout;
    this.apiType = this.getTypeByModel(config.model);
  }

  // 设置请求附加信息
  setMeta(meta: RequestMeta): void {
    this.meta = meta;
  }

  // 根据模型判断 API 类型
  private getTypeByModel(model: string): number {
    if (MODEL_LIST.includes(model as typeof MODEL_LIST[number])) return 1;
    if (BACKUP_MODEL_LIST.includes(model as typeof BACKUP_MODEL_LIST[number])) return 2;
    return 1;
  }

  // 带工具调用的对话
  async chatWithTools(messages: AIMessage[], tools: Tool[]): Promise<AIResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const payload: Record<string, unknown> = {
        model: this.model,
        messages,
        type: this.apiType,
      };

      // 添加机器人、主人、用户信息
      if (this.meta.bot_id) payload.bot_id = this.meta.bot_id;
      if (this.meta.owner_ids?.length) payload.owner_ids = this.meta.owner_ids;
      if (this.meta.user_id) payload.user_id = this.meta.user_id;

      if (tools.length) {
        payload.tools = tools;
        payload.tool_choice = 'auto';
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        return {
          choices: [],
          error: `HTTP错误: ${res.status}`,
          detail: (await res.text()).slice(0, 500),
        };
      }

      return await res.json() as AIResponse;
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof Error && e.name === 'AbortError') {
        return { choices: [], error: '请求超时' };
      }
      return { choices: [], error: String(e) };
    }
  }

  // 简单对话
  async chatSimple(messages: AIMessage[]): Promise<string> {
    const res = await this.chatWithTools(messages, []);
    return res.choices?.[0]?.message?.content || '';
  }

  // 模型管理
  setModel(model: string): void {
    this.model = model;
    this.apiType = this.getTypeByModel(model);
  }

  getModel(): string {
    return this.model;
  }

  getApiType(): number {
    return this.apiType;
  }
}
