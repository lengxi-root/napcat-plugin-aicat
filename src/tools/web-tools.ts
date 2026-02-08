import type { Tool, ToolResult } from '../types';

const TIMEOUT = 15000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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
          engine: { type: 'string', enum: ['auto', 'baidu', 'bing', 'sogou'], description: '搜索引擎' },
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

// 带超时的 fetch
async function fetchWithTimeout (url: string, headers?: Record<string, string>): Promise<string> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...headers,
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(id);
    return res.text();
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// 通用 HTML 清理
function stripHtml (html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

// ========== 百度搜索 ==========
async function searchBaidu (query: string, count: number): Promise<ToolResult> {
  try {
    const html = await fetchWithTimeout(
      `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${Math.min(count * 2, 20)}&ie=utf-8`
    );
    const results: { title: string; url: string; snippet: string }[] = [];

    // 多种正则匹配百度结果（适配不同页面结构）
    // 方式1：标准结果容器
    const containerPattern = /<div[^>]*class="[^"]*result[^"]*c-container[^"]*"[^>]*>[\s\S]*?<\/div>\s*(?=<div[^>]*class="[^"]*result|$)/g;
    let containerMatch;
    while ((containerMatch = containerPattern.exec(html)) !== null && results.length < count) {
      const block = containerMatch[0];
      // 提取标题和链接
      const titleMatch = block.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/);
      if (!titleMatch) continue;
      const title = stripHtml(titleMatch[2]);
      const url = titleMatch[1];
      if (!title || !url) continue;
      // 提取摘要（多种方式）
      let snippet = '';
      const snippetMatch = block.match(/<span[^>]*class="[^"]*content-right_[^"]*"[^>]*>([\s\S]*?)<\/span>/)
        || block.match(/<div[^>]*class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/)
        || block.match(/<div[^>]*class="[^"]*c-span-last[^"]*"[^>]*>([\s\S]*?)<\/div>/)
        || block.match(/<span[^>]*class="[^"]*"[^>]*>([\s\S]{20,300}?)<\/span>/);
      if (snippetMatch) snippet = stripHtml(snippetMatch[1]).slice(0, 300);
      results.push({ title, url, snippet });
    }

    // 方式2：兜底 - 直接匹配 h3 > a（如果方式1没结果）
    if (results.length === 0) {
      const h3Pattern = /<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/g;
      let h3Match;
      while ((h3Match = h3Pattern.exec(html)) !== null && results.length < count) {
        const title = stripHtml(h3Match[2]);
        if (title && h3Match[1]) results.push({ title, url: h3Match[1], snippet: '' });
      }
    }

    return { success: true, data: { engine: 'baidu', query, results, total: results.length } };
  } catch (e) { return { success: false, error: `百度搜索失败: ${String(e)}` }; }
}

// ========== Bing 搜索 ==========
async function searchBing (query: string, count: number): Promise<ToolResult> {
  try {
    const html = await fetchWithTimeout(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(count * 2, 20)}&setlang=zh-CN`
    );
    const results: { title: string; url: string; snippet: string }[] = [];

    // 方式1：匹配 b_algo 结果块
    const algoPattern = /<li[^>]*class="b_algo"[^>]*>([\s\S]*?)<\/li>/g;
    let algoMatch;
    while ((algoMatch = algoPattern.exec(html)) !== null && results.length < count) {
      const block = algoMatch[1];
      const linkMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!linkMatch) continue;
      const title = stripHtml(linkMatch[2]);
      const url = linkMatch[1];
      if (!title || !url) continue;
      // 摘要
      let snippet = '';
      const pMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/)
        || block.match(/<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      if (pMatch) snippet = stripHtml(pMatch[1]).slice(0, 300);
      results.push({ title, url, snippet });
    }

    // 方式2：兜底 - 宽松匹配
    if (results.length === 0) {
      const linkPattern = /<h2>\s*<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/g;
      let linkMatch;
      while ((linkMatch = linkPattern.exec(html)) !== null && results.length < count) {
        const title = stripHtml(linkMatch[2]);
        if (title && linkMatch[1]) results.push({ title, url: linkMatch[1], snippet: '' });
      }
    }

    return { success: true, data: { engine: 'bing', query, results, total: results.length } };
  } catch (e) { return { success: false, error: `Bing搜索失败: ${String(e)}` }; }
}

// ========== 搜狗搜索（备用） ==========
async function searchSogou (query: string, count: number): Promise<ToolResult> {
  try {
    const html = await fetchWithTimeout(
      `https://www.sogou.com/web?query=${encodeURIComponent(query)}&num=${Math.min(count * 2, 20)}`
    );
    const results: { title: string; url: string; snippet: string }[] = [];

    // 匹配搜狗结果
    const blockPattern = /<div[^>]*class="[^"]*vrwrap[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*vrwrap|$)/g;
    let blockMatch;
    while ((blockMatch = blockPattern.exec(html)) !== null && results.length < count) {
      const block = blockMatch[1];
      const linkMatch = block.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!linkMatch) continue;
      const title = stripHtml(linkMatch[2]);
      if (!title) continue;
      let snippet = '';
      const descMatch = block.match(/<p[^>]*class="[^"]*str_info[^"]*"[^>]*>([\s\S]*?)<\/p>/)
        || block.match(/<div[^>]*class="[^"]*space-txt[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      if (descMatch) snippet = stripHtml(descMatch[1]).slice(0, 300);
      results.push({ title, url: linkMatch[1], snippet });
    }

    // 兜底
    if (results.length === 0) {
      const h3Pattern = /<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/g;
      let h3Match;
      while ((h3Match = h3Pattern.exec(html)) !== null && results.length < count) {
        const title = stripHtml(h3Match[2]);
        if (title && h3Match[1]) results.push({ title, url: h3Match[1], snippet: '' });
      }
    }

    return { success: true, data: { engine: 'sogou', query, results, total: results.length } };
  } catch (e) { return { success: false, error: `搜狗搜索失败: ${String(e)}` }; }
}

// ========== 网页内容提取 ==========
async function fetchWebpage (url: string, maxLength: number): Promise<ToolResult> {
  try {
    const html = await fetchWithTimeout(url);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]) : '';

    // 提取正文（优先 article/main，否则 body）
    let content = '';
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
      || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
      || html.match(/<div[^>]*class="[^"]*(?:content|article|post|entry|text)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

    const raw = articleMatch ? articleMatch[1] : html;
    // 清理 script/style/nav/header/footer
    content = raw.replace(/<(script|style|nav|header|footer|aside|iframe)[^>]*>[\s\S]*?<\/\1>/gi, '');
    content = stripHtml(content);
    if (content.length > maxLength) content = content.slice(0, maxLength) + '...';

    return { success: true, data: { url, title, content, length: content.length } };
  } catch (e) { return { success: false, error: `获取网页失败: ${String(e)}` }; }
}

// ========== 工具执行入口 ==========
export async function executeWebTool (toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (toolName === 'web_search') {
    const query = (args.query as string) || '';
    const engine = (args.engine as string) || 'auto';
    const count = (args.count as number) || 5;

    if (engine === 'baidu') return searchBaidu(query, count);
    if (engine === 'bing') return searchBing(query, count);
    if (engine === 'sogou') return searchSogou(query, count);

    // auto 模式：百度 → Bing → 搜狗，直到有结果
    const baiduResult = await searchBaidu(query, count);
    if (baiduResult.success && ((baiduResult.data as { results: unknown[] })?.results?.length ?? 0) > 0) return baiduResult;

    const bingResult = await searchBing(query, count);
    if (bingResult.success && ((bingResult.data as { results: unknown[] })?.results?.length ?? 0) > 0) return bingResult;

    return searchSogou(query, count);
  }

  if (toolName === 'fetch_url') {
    return fetchWebpage((args.url as string) || '', (args.max_length as number) || 3000);
  }

  return { success: false, error: `未知工具: ${toolName}` };
}

export const getWebTools = (): Tool[] => WEB_TOOLS;
