// AI 客户端 - 调用 OpenAI 兼容 API
import type { AIConfig, AIMessage, AIResponse, Tool } from '../types';

export class AIClient {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private timeout: number;

  constructor (config: AIConfig) {
    this.baseUrl = config.base_url;
    this.apiKey = config.api_key;
    this.model = config.model;
    this.timeout = config.timeout;
  }

  // 带工具调用的对话
  async chatWithTools (messages: AIMessage[], tools: Tool[]): Promise<AIResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const payload: Record<string, unknown> = { model: this.model, messages };
      if (tools.length) { payload.tools = tools; payload.tool_choice = 'auto'; }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const res = await fetch(this.baseUrl, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return { choices: [], error: `HTTP错误: ${res.status}`, detail: (await res.text()).slice(0, 500) };
      return await res.json() as AIResponse;
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof Error && e.name === 'AbortError') return { choices: [], error: '请求超时' };
      return { choices: [], error: String(e) };
    }
  }

  // 简单对话
  async chatSimple (messages: AIMessage[]): Promise<string> {
    const res = await this.chatWithTools(messages, []);
    return res.choices?.[0]?.message?.content || '';
  }

  setModel (model: string): void { this.model = model; }
  getModel (): string { return this.model; }
}
