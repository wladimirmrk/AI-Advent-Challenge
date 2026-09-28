/**
 * Day 19: MCP Tool Composition & Pipeline Service
 * 
 * Implements:
 * 1. searchData: Query product catalog and knowledge base.
 * 2. summarizeData: Aggregate and synthesize structured analytical digest (Markdown/JSON).
 * 3. saveToFile: Securely persist reports to disk (data/reports) with path traversal protection.
 * 4. executePipeline: Composite orchestrator executing Search -> Summarize -> SaveToFile.
 */

import fs from 'node:fs';
import path from 'node:path';
import { MockEcommerceService, Product } from './mock-store.js';

export interface SearchOptions {
  query?: string;
  category?: string;
  max_results?: number;
}

export interface SearchResultItem {
  sku: string;
  title: string;
  category: string;
  price: number;
  currency: string;
  inStock: boolean;
  stockCount: number;
  warehouse: string;
  specs: Record<string, string>;
  description: string;
}

export interface SearchResult {
  success: boolean;
  query: string;
  category: string;
  totalFound: number;
  items: SearchResultItem[];
}

export interface SummarizeOptions {
  content?: string;
  items?: SearchResultItem[] | any[];
  format?: 'markdown' | 'json';
  title?: string;
}

export interface SummarizeResult {
  success: boolean;
  format: 'markdown' | 'json';
  title: string;
  summary: string;
  stats: {
    totalItems: number;
    inStockCount: number;
    outOfStockCount: number;
    minPrice: number;
    maxPrice: number;
    avgPrice: number;
    currency: string;
  };
  keyHighlights: string[];
  recommendations: string[];
  renderedContent: string;
}

export interface SaveToFileOptions {
  content: string | object;
  filename?: string;
  format?: 'markdown' | 'json';
  directory?: string;
}

export interface SaveToFileResult {
  success: boolean;
  filename: string;
  filePath: string;
  relativePath: string;
  bytesWritten: number;
  format: string;
  timestamp: string;
}

export class PipelineService {
  private static instance: PipelineService;
  private defaultDirectory: string;

  constructor(defaultDirectory?: string) {
    this.defaultDirectory = defaultDirectory || path.join(process.cwd(), 'data', 'reports');
  }

  public static getInstance(): PipelineService {
    if (!PipelineService.instance) {
      PipelineService.instance = new PipelineService();
    }
    return PipelineService.instance;
  }

  public setDefaultDirectory(dirPath: string) {
    this.defaultDirectory = dirPath;
  }

  public getDefaultDirectory(): string {
    return this.defaultDirectory;
  }

  /**
   * Step 1: Search Tool
   * Retrieves data matching query or category
   */
  public searchData(options: SearchOptions = {}): SearchResult {
    const query = options.query?.trim() || '';
    const category = options.category?.trim();
    const maxResults = options.max_results && options.max_results > 0 ? options.max_results : 20;

    const raw = MockEcommerceService.searchProducts(query, category);

    const items: SearchResultItem[] = raw.products.slice(0, maxResults).map((p: Product) => ({
      sku: p.sku,
      title: p.title,
      category: p.category,
      price: p.price,
      currency: p.currency,
      inStock: p.inStock,
      stockCount: p.stockCount,
      warehouse: p.warehouse,
      specs: p.specs || {},
      description: p.description,
    }));

    return {
      success: true,
      query,
      category: category || 'all',
      totalFound: items.length,
      items,
    };
  }

  /**
   * Step 2: Summarize Tool
   * Processes retrieved items or raw content into a structured analytical report
   */
  public summarizeData(options: SummarizeOptions = {}): SummarizeResult {
    const format = options.format === 'json' ? 'json' : 'markdown';
    let items: any[] = [];

    // Parse items if passed directly or if string content contains json
    if (Array.isArray(options.items) && options.items.length > 0) {
      items = options.items;
    } else if (options.content) {
      const trimmed = options.content.trim();
      let candidate = trimmed;

      // Extract content from <mcp_result> tag if present
      const mcpMatch = candidate.match(/<mcp_result[^>]*>([\s\S]*?)<\/mcp_result>/i);
      if (mcpMatch) {
        candidate = mcpMatch[1].trim();
      }

      // Remove markdown code fences if wrapped
      candidate = candidate
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();

      const tryParse = (str: string) => {
        try {
          const parsed = JSON.parse(str);
          if (Array.isArray(parsed)) return parsed;
          if (Array.isArray(parsed.items)) return parsed.items;
          if (Array.isArray(parsed.products)) return parsed.products;
        } catch {}
        return null;
      };

      const direct = tryParse(candidate);
      if (direct) {
        items = direct;
      } else {
        // Fallback: search for first { ... } or [ ... ] block
        const jsonBlockMatch = candidate.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (jsonBlockMatch) {
          const blockParsed = tryParse(jsonBlockMatch[1]);
          if (blockParsed) items = blockParsed;
        }
      }
    }

    const title = options.title?.trim() || 'Аналитический отчет по товарам';

    if (items.length === 0) {
      const emptyMarkdown = `# ${title}\n\n**Результат:** По заданным критериям не найдено ни одного товара.\n\n*Рекомендация:* Проверьте параметры запроса или расширьте фильтр поиска.`;
      return {
        success: true,
        format,
        title,
        summary: 'По запросу товаров не найдено.',
        stats: {
          totalItems: 0,
          inStockCount: 0,
          outOfStockCount: 0,
          minPrice: 0,
          maxPrice: 0,
          avgPrice: 0,
          currency: 'RUB',
        },
        keyHighlights: ['Товары не найдены'],
        recommendations: ['Смягчите критерии поиска или проверьте артикулы.'],
        renderedContent: format === 'json' ? JSON.stringify({ title, totalItems: 0, items: [] }, null, 2) : emptyMarkdown,
      };
    }

    // Calculate analytical metrics
    const totalItems = items.length;
    const inStockItems = items.filter((i) => i.inStock === true || (i.stockCount && i.stockCount > 0));
    const inStockCount = inStockItems.length;
    const outOfStockCount = totalItems - inStockCount;

    const prices = items.map((i) => Number(i.price) || 0).filter((p) => p > 0);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 0;
    const sumPrice = prices.reduce((a, b) => a + b, 0);
    const avgPrice = prices.length ? Math.round(sumPrice / prices.length) : 0;
    const currency = items[0]?.currency || 'RUB';

    const cheapestItem = items.find((i) => i.price === minPrice);
    const expensiveItem = items.find((i) => i.price === maxPrice);

    const keyHighlights: string[] = [
      `Всего проанализировано позиций: ${totalItems}`,
      `В наличии на складах: ${inStockCount} из ${totalItems} (${Math.round((inStockCount / totalItems) * 100)}%)`,
      `Ценовой диапазон: от ${minPrice.toLocaleString('ru-RU')} до ${maxPrice.toLocaleString('ru-RU')} ${currency} (средняя цена: ${avgPrice.toLocaleString('ru-RU')} ${currency})`,
    ];

    if (cheapestItem) {
      keyHighlights.push(`Наиболее доступная позиция: "${cheapestItem.title}" (${cheapestItem.price.toLocaleString('ru-RU')} ${currency})`);
    }
    if (expensiveItem && expensiveItem !== cheapestItem) {
      keyHighlights.push(`Флагманская позиция: "${expensiveItem.title}" (${expensiveItem.price.toLocaleString('ru-RU')} ${currency})`);
    }

    const recommendations: string[] = [];
    if (outOfStockCount > 0) {
      recommendations.push(`Для ${outOfStockCount} позиций, отсутствующих на складе, рекомендуется оформить предзаказ.`);
    }
    if (inStockCount > 0) {
      recommendations.push(`Товары в наличии могут быть отправлены курьерской доставкой в течение 24 часов.`);
    }

    let renderedContent = '';
    if (format === 'json') {
      renderedContent = JSON.stringify(
        {
          title,
          generatedAt: new Date().toISOString(),
          stats: {
            totalItems,
            inStockCount,
            outOfStockCount,
            minPrice,
            maxPrice,
            avgPrice,
            currency,
          },
          keyHighlights,
          recommendations,
          items: items.map((it) => ({
            sku: it.sku,
            title: it.title,
            category: it.category,
            price: it.price,
            currency: it.currency,
            inStock: it.inStock,
            stockCount: it.stockCount,
            warehouse: it.warehouse,
          })),
        },
        null,
        2
      );
    } else {
      // Build clean GitHub Flavored Markdown
      const tableRows = items.map(
        (it) =>
          `| ${it.title} | \`${it.sku}\` | ${Number(it.price).toLocaleString('ru-RU')} ${it.currency || currency} | ${it.inStock ? '✅ В наличии (' + (it.stockCount ?? 1) + ' шт.)' : '❌ Ожидается'} | ${it.warehouse || 'Основной склад'} |`
      );

      renderedContent = `# ${title}

> **Дата составления:** ${new Date().toLocaleString('ru-RU')}  
> **Статус отчета:** Успешно сформирован автоматическим пайплайном MCP

---

## 📊 Ключевые показатели

- **Всего позиций:** ${totalItems}
- **Доступно к заказу:** ${inStockCount}
- **Ожидают поставки:** ${outOfStockCount}
- **Средняя стоимость:** ${avgPrice.toLocaleString('ru-RU')} ${currency}
- **Диапазон цен:** ${minPrice.toLocaleString('ru-RU')} — ${maxPrice.toLocaleString('ru-RU')} ${currency}

---

## 📋 Сводная таблица товаров

| Товар | Артикул | Цена | Статус | Склад |
| :--- | :--- | :---: | :---: | :--- |
${tableRows.join('\n')}

---

## 💡 Аналитические выводы

${keyHighlights.map((kh) => `- ${kh}`).join('\n')}

## 🚀 Рекомендации

${recommendations.map((rec) => `1. ${rec}`).join('\n')}
`;
    }

    return {
      success: true,
      format,
      title,
      summary: `Сформирован отчет по ${totalItems} товарам (в наличии: ${inStockCount}). Диапазон цен: ${minPrice}-${maxPrice} ${currency}.`,
      stats: {
        totalItems,
        inStockCount,
        outOfStockCount,
        minPrice,
        maxPrice,
        avgPrice,
        currency,
      },
      keyHighlights,
      recommendations,
      renderedContent,
    };
  }

  /**
   * Step 3: SaveToFile Tool
   * Persists report safely on disk with path traversal protection
   */
  public saveToFile(options: SaveToFileOptions): SaveToFileResult {
    if (options.content === undefined || options.content === null) {
      throw new Error('Параметр "content" обязателен для сохранения файла');
    }

    const targetDir = options.directory ? path.resolve(options.directory) : this.defaultDirectory;

    // Ensure directory exists
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const format = options.format === 'json' ? 'json' : 'markdown';
    const ext = format === 'json' ? '.json' : '.md';

    let rawFilename = options.filename?.trim() || '';

    if (!rawFilename) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      rawFilename = `report-${timestamp}${ext}`;
    } else {
      // Path traversal security check: sanitize filename to only allow basename
      const sanitized = path.basename(rawFilename);
      if (sanitized !== rawFilename || rawFilename.includes('..') || rawFilename.includes('/') || rawFilename.includes('\\')) {
        throw new Error(`Обнаружена попытка path traversal: имя файла "${rawFilename}" содержит недопустимые пути.`);
      }
      rawFilename = sanitized;
      if (!rawFilename.toLowerCase().endsWith('.md') && !rawFilename.toLowerCase().endsWith('.json') && !rawFilename.toLowerCase().endsWith('.txt')) {
        rawFilename = `${rawFilename}${ext}`;
      }
    }

    const finalPath = path.join(targetDir, rawFilename);

    let textToWrite = '';
    if (typeof options.content === 'object') {
      textToWrite = JSON.stringify(options.content, null, 2);
    } else {
      textToWrite = String(options.content);
    }

    fs.writeFileSync(finalPath, textToWrite, 'utf8');
    const bytesWritten = Buffer.byteLength(textToWrite, 'utf8');

    const relativePath = path.relative(process.cwd(), finalPath);

    return {
      success: true,
      filename: rawFilename,
      filePath: finalPath,
      relativePath,
      bytesWritten,
      format,
      timestamp: new Date().toISOString(),
    };
  }
}

