// AI 客户端 - 调用 OpenAI 兼容 API
import type { AIConfig, AIMessage, AIResponse, Tool } from '../types';

export class AIClient {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private timeout: number;

  constructor(config: AIConfig) {
    this.baseUrl = config.base_url;
    this.apiKey = config.api_key;
    this.model = config.model;
    this.timeout = config.timeout;
  }

  /**
   * 带工具调用的对话
   */
  async chatWithTools(messages: AIMessage[], tools: Tool[]): Promise<AIResponse> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const payload: Record<string, unknown> = {
        model: this.model,
        messages,
      };

      if (tools.length > 0) {
        payload.tools = tools;
        payload.tool_choice = 'auto';
      }

      // 构建请求头（如果没有 apiKey 则不发送 Authorization）
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      // 直接使用配置的 URL
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[AIClient] 请求失败: ${response.status} - ${errorText.slice(0, 500)}`);
        return {
          choices: [],
          error: `HTTP错误: ${response.status}`,
          detail: errorText.slice(0, 500),
        };
      }

      return await response.json() as AIResponse;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { choices: [], error: '请求超时' };
      }
      console.error(`[AIClient] 请求异常:`, error);
      return { choices: [], error: String(error) };
    }
  }

  /**
   * 简单对话（无工具）
   */
  async chatSimple(messages: AIMessage[]): Promise<string> {
    try {
      const response = await this.chatWithTools(messages, []);
      return response.choices?.[0]?.message?.content || '';
    } catch (error) {
      return `AI 请求失败: ${String(error)}`;
    }
  }

  /**
   * 更新模型
   */
  setModel(model: string): void {
    this.model = model;
  }

  /**
   * 获取当前模型
   */
  getModel(): string {
    return this.model;
  }
}
