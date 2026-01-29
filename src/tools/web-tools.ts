import type { Tool, ToolResult } from '../types';

const TIMEOUT = 15000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

export const WEB_TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '搜索互联网获取实时信息',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          engine: { type: 'string', enum: ['auto', 'baidu', 'bing'], description: '搜索引擎' },
          count: { type: 'integer', description: '返回结果数量' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: '获取网页内容',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '网页URL' },
          max_length: { type: 'integer', description: '最大返回字符数' },
        },
        required: ['url'],
      },
    },
  },
];

async function fetchWithTimeout(url: string): Promise<string> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT);
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: controller.signal });
  clearTimeout(id);
  return res.text();
}

async function searchBaidu(query: string, count: number): Promise<ToolResult> {
  try {
    const html = await fetchWithTimeout(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${count}`);
    const results: { title: string; url: string; snippet: string }[] = [];
    const pattern = /<h3[^>]*>.*?<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>.*?<\/h3>/gs;
    let match;
    while ((match = pattern.exec(html)) !== null && results.length < count) {
      const title = match[2].replace(/<[^>]+>/g, '').trim();
      if (title && match[1]) results.push({ title, url: match[1], snippet: '' });
    }
    return { success: true, data: { engine: 'baidu', query, results } };
  } catch (e) { return { success: false, error: String(e) }; }
}

async function searchBing(query: string, count: number): Promise<ToolResult> {
  try {
    const html = await fetchWithTimeout(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${count}`);
    const results: { title: string; url: string; snippet: string }[] = [];
    const pattern = /<li class="b_algo"[^>]*>.*?<h2><a href="([^"]+)"[^>]*>([^<]+)<\/a><\/h2>.*?<p[^>]*>([^<]*)<\/p>/gs;
    let match;
    while ((match = pattern.exec(html)) !== null && results.length < count) {
      results.push({ title: match[2].replace(/<[^>]+>/g, '').trim(), url: match[1], snippet: match[3].slice(0, 200) });
    }
    return { success: true, data: { engine: 'bing', query, results } };
  } catch (e) { return { success: false, error: String(e) }; }
}

async function fetchWebpage(url: string, maxLength: number): Promise<ToolResult> {
  try {
    let html = await fetchWithTimeout(url);
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    let text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length > maxLength) text = text.slice(0, maxLength) + '...';
    return { success: true, data: { url, title, content: text } };
  } catch (e) { return { success: false, error: String(e) }; }
}

export async function executeWebTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (toolName === 'web_search') {
    const query = (args.query as string) || '';
    const engine = (args.engine as string) || 'auto';
    const count = (args.count as number) || 5;
    if (engine === 'baidu') return searchBaidu(query, count);
    if (engine === 'bing') return searchBing(query, count);
    const result = await searchBaidu(query, count);
    if (result.success && (result.data as { results: unknown[] })?.results?.length > 0) return result;
    return searchBing(query, count);
  }
  if (toolName === 'fetch_url') {
    return fetchWebpage((args.url as string) || '', (args.max_length as number) || 2000);
  }
  return { success: false, error: `未知工具: ${toolName}` };
}

export const getWebTools = (): Tool[] => WEB_TOOLS;
