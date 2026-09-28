/**
 * Demo runner for User Prompt (Day 20 Orchestration MCP):
 * "Подбери мне лучший ноутбук для работы до 150000 руб, проверь его наличие и характеристики,
 * рассчитай стоимость и срок экспресс-доставки в Казань, а затем сформируй подробный аналитический отчет
 * и сохрани его на диск в data/reports."
 */

import fs from 'node:fs';
import path from 'node:path';
import { startAllMcpServers, RunningServers } from './mcp-multi-server';
import { PipelineService } from './pipeline-service';
import { McpServerConfig } from '../src/agent/mcp/types';
import { McpRouter } from '../src/agent/mcp/McpRouter';

// Mock storage & window environment for Agent class in Node.js
const mockStorage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, val: string) => mockStorage.set(key, String(val)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};
(globalThis as any).window = {
  location: { origin: 'http://localhost:5173' },
};

import { Agent } from '../src/agent/Agent';

async function runDemo() {
  console.log('\n======================================================================');
  console.log('🌟 Запуск Демонстрации Orchestration MCP (День 20)');
  console.log('======================================================================\n');

  const PORTS = {
    catalog: 3061,
    logistics: 3062,
    analytics: 3063,
  };

  const REPORTS_DIR = path.join(process.cwd(), 'data', 'reports');
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const pipeline = PipelineService.getInstance();
  pipeline.setDefaultDirectory(REPORTS_DIR);

  // Start all 3 MCP servers
  let servers: RunningServers | null = null;
  try {
    servers = await startAllMcpServers(PORTS);
  } catch (err: any) {
    console.log(`Примечание: Серверы возможно уже запущены (${err.message}), продолжаем подключение.`);
  }

  const catalogServerConfig: McpServerConfig = {
    id: 'mcp-catalog-server',
    name: 'Каталог и Склад',
    url: `http://localhost:${PORTS.catalog}/sse`,
    transport: 'sse',
    enabled: true,
    createdAt: Date.now(),
  };

  const logisticsServerConfig: McpServerConfig = {
    id: 'mcp-logistics-server',
    name: 'Логистика и Заказы',
    url: `http://localhost:${PORTS.logistics}/sse`,
    transport: 'sse',
    enabled: true,
    createdAt: Date.now(),
  };

  const analyticsServerConfig: McpServerConfig = {
    id: 'mcp-analytics-server',
    name: 'Аналитика и Отчеты',
    url: `http://localhost:${PORTS.analytics}/sse`,
    transport: 'sse',
    enabled: true,
    createdAt: Date.now(),
  };

  const activeServers = [catalogServerConfig, logisticsServerConfig, analyticsServerConfig];
  mockStorage.set('agent_mcp_servers', JSON.stringify(activeServers));

  const router = McpRouter.getInstance();
  router.reset();
  await router.discoverAllTools(activeServers, true);

  console.log('📋 Реестр инструментов по серверам (McpRouter Routing Table):');
  const routingTable = router.getRoutingTable();
  for (const [tool, srv] of routingTable.entries()) {
    console.log(`   • ${tool.padEnd(25)} ➔ ${srv}`);
  }

  const userPrompt =
    'Подбери мне лучший ноутбук для работы до 150000 руб, проверь его наличие и характеристики, рассчитай стоимость и срок экспресс-доставки в Казань, а затем сформируй подробный аналитический отчет и сохрани его на диск в data/reports.';

  console.log(`\n💬 Входной запрос пользователя:\n"${userPrompt}"\n`);
  console.log('⚙️ Инициализация AI Agent и запуск многошаговой оркестрации...\n');

  const agent = new Agent('chat-demo-orchestration');
  agent.setApiKey('demo-api-key');

  // Multi-step LLM simulation demonstrating dynamic analysis of rich catalog
  let turnCounter = 0;
  let catalogSearchResults: any = null;
  let selectedLaptopDetails: any = null;
  let deliveryCalcResult: any = null;

  (agent as any).callLLM = async (messages: any[]) => {
    turnCounter++;
    const lastMsg = messages[messages.length - 1]?.content || '';

    if (turnCounter === 1) {
      console.log('▶️ [Шаг 1: Маршрутизация на Каталог и Склад (порт 3001)]');
      console.log('   Агент ищет в каталоге ноутбуки стоимостью до 150 000 руб...');
      return {
        content: `Приступаю к подбору лучшего рабочего ноутбука в бюджете до 150 000 руб. Сначала запрошу список всех подходящих моделей в каталоге.\n<mcp_call name="store_search_products">{"query": "ноутбук", "category": "laptops", "max_price": 150000}</mcp_call>`,
        promptTokens: 150,
        completionTokens: 35,
        totalTokens: 185,
      };
    }

    if (turnCounter === 2) {
      const match = lastMsg.match(/<mcp_result name="store_search_products"[^>]*>([\s\S]*?)<\/mcp_result>/i);
      if (match) {
        try {
          catalogSearchResults = JSON.parse(match[1]);
        } catch {}
      }

      console.log(`   Найдено вариантов в каталоге: ${catalogSearchResults?.totalFound || 8} шт.`);
      console.log('▶️ [Шаг 2: Маршрутизация на Каталог и Склад (порт 3001)]');
      console.log('   Агент анализирует варианты и запрашивает детальные спеки фаворита: MacBook Air 13" M3 16/512GB...');
      return {
        content: `Среди 8 найденных моделей до 150 000 руб лучшим балансом производительности, автономности и экрана является Apple MacBook Air 13" M3 16/512GB (LAPTOP-AIR-M3). Проверю его точные характеристики, склад и остаток.\n<mcp_call name="store_get_product">{"sku": "LAPTOP-AIR-M3"}</mcp_call>`,
        promptTokens: 350,
        completionTokens: 40,
        totalTokens: 390,
      };
    }

    if (turnCounter === 3) {
      const match = lastMsg.match(/<mcp_result name="store_get_product"[^>]*>([\s\S]*?)<\/mcp_result>/i);
      if (match) {
        try {
          selectedLaptopDetails = JSON.parse(match[1]);
        } catch {}
      }

      console.log('▶️ [Шаг 3: Маршрутизация на Логистику и Заказы (порт 3002)]');
      console.log('   Агент рассчитывает экспресс-доставку в Казань для посылки весом 1.5 кг...');
      return {
        content: `Ноутбук Apple MacBook Air 13" M3 в наличии (5 шт., Склад Юг). Теперь обращусь к серверу логистики для расчета стоимости и сроков экспресс-доставки в Казань.\n<mcp_call name="delivery_calculate_cost">{"city": "Казань", "weight_kg": 1.5, "express": true}</mcp_call>`,
        promptTokens: 480,
        completionTokens: 40,
        totalTokens: 520,
      };
    }

    if (turnCounter === 4) {
      const match = lastMsg.match(/<mcp_result name="delivery_calculate_cost"[^>]*>([\s\S]*?)<\/mcp_result>/i);
      if (match) {
        try {
          deliveryCalcResult = JSON.parse(match[1]);
        } catch {}
      }

      console.log('▶️ [Шаг 4: Маршрутизация на Аналитику и Отчеты (порт 3003)]');
      console.log('   Агент формирует сравнительную аналитическую выжимку...');
      const summaryContent = JSON.stringify({
        selected: selectedLaptopDetails?.product || {
          title: 'Ноутбук Apple MacBook Air 13" M3 16/512GB Space Gray',
          price: 149990,
          warehouse: 'Склад Юг (Москва)',
          stockCount: 5,
        },
        delivery: deliveryCalcResult || {
          city: 'Казань',
          isExpress: true,
          totalCost: 1048,
          estimatedDays: 'Срочная доставка (1-2 дня)',
        },
        alternatives: [
          { sku: 'LAPTOP-THINKPAD-T14', title: 'Lenovo ThinkPad T14 Gen 4 Core i7 32/1TB', price: 139990, inStock: true },
          { sku: 'LAPTOP-ZENBOOK-14', title: 'ASUS ZenBook 14 OLED Ultra 7 16/1TB', price: 124990, inStock: true },
          { sku: 'LAPTOP-XIAOMI-PRO16', title: 'Xiaomi Book Pro 16 4K OLED Ryzen 7 16/512GB', price: 99990, inStock: true },
        ],
        totalBudget: 151038,
      });

      return {
        content: `Экспресс-доставка рассчитана: 1-2 дня. Теперь сформирую подробную аналитическую сводку через аналитический сервер.\n<mcp_call name="summarize">{"title": "Аналитический отчет: Подбор рабочего ноутбука до 150000 руб с экспресс-доставкой в Казань", "content": ${JSON.stringify(summaryContent)}}</mcp_call>`,
        promptTokens: 600,
        completionTokens: 50,
        totalTokens: 650,
      };
    }

    if (turnCounter === 5) {
      console.log('▶️ [Шаг 5: Маршрутизация на Аналитику и Отчеты (порт 3003)]');
      console.log('   Агент сохраняет готовый отчет на диск в data/reports/work-laptop-kazan.md...');

      const reportMarkdown = `# Аналитический отчет: Подбор ноутбука для работы до 150 000 руб

> **Дата составления:** ${new Date().toLocaleString('ru-RU')}  
> **Город назначения:** Казань (Республика Татарстан)  
> **Тип доставки:** Экспресс-курьер (1-2 рабочих дня)  
> **Статус:** ✅ В наличии на складе

---

## 🏆 Победитель сравнения: Apple MacBook Air 13" M3 (2024)

- **Артикул (SKU):** \`LAPTOP-AIR-M3\`
- **Стоимость:** **149 990 руб.** (укладывается в бюджет до 150 000 руб.)
- **Наличие:** 5 шт. на основном складе (Склад Юг, Москва)
- **Процессор:** Apple M3 (8 ядер CPU / 10 ядер GPU) с аппаратным ускорением трассировки лучей и 16-ядерным Neural Engine
- **Память:** 16 GB объединенной высокоскоростной памяти (Unified Memory)
- **Накопитель:** 512 GB SSD NVMe
- **Экран:** 13.6" Liquid Retina IPS (2560x1664), 500 нит, цветовой охват P3
- **Автономность:** До 18 часов реальной работы от одного заряда
- **Вес:** 1.24 кг (сверхлегкий алюминиевый корпус)

### Почему именно он?
1. **Максимальная производительность на ватт:** Чип M3 опережает конкурентов в энергоэффективности, позволяя компилировать код и запускать контейнеры без нагрева и шума (пассивное охлаждение 0 dB).
2. **16 ГБ оперативной памяти:** Запас под многозадачность, Docker, базы данных и браузеры с сотнями вкладок.
3. **Ликвидность и надежность:** Высочайшая остаточная стоимость на вторичном рынке и автономность на весь рабочий день без зарядки.

---

## 📊 Сравнение с альтернативами в каталоге (до 150 000 руб.)

| Модель | CPU / Память | Экран | Цена | Преимущество |
| :--- | :--- | :--- | :---: | :--- |
| **Apple MacBook Air 13" M3** | M3 / 16GB / 512GB | 13.6" Liquid Retina | **149 990 ₽** | 🏆 Автономность 18ч, бесшумный, экран P3 |
| **Lenovo ThinkPad T14 Gen 4** | Core i7 / 32GB / 1TB | 14.0" WUXGA IPS | **139 990 ₽** | 32 ГБ RAM, клавиатура TrackPoint, MIL-STD |
| **ASUS ZenBook 14 OLED** | Ultra 7 / 16GB / 1TB | 14.0" 2.8K OLED 120Hz | **124 990 ₽** | Роскошный 120Hz OLED экран, вес 1.2 кг |
| **Dell XPS 13 Plus** | Core i7 / 16GB / 512GB | 13.4" 3.5K OLED Touch | **147 990 ₽** | Премиальный дизайн InfinityEdge |
| **HUAWEI MateBook X Pro** | Core i7 / 16GB / 1TB | 14.2" 3.1K LTPS Touch | **144 990 ₽** | Магниевый софт-тач корпус, звук 6 динамиков |
| **Xiaomi Book Pro 16** | Ryzen 7 / 16GB / 512GB | 16.0" 4K OLED Touch | **99 990 ₽** | Большой 4K экран при цене до 100 000 ₽ |

---

## 🚚 Расчет логистики и доставки в Казань

- **Служба доставки:** Экспресс-курьер (Logistics MCP Server)
- **Город назначения:** г. Казань
- **Вес отправления:** 1.5 кг (ноутбук + фирменная упаковка + зарядное устройство)
- **Срок доставки:** **1-2 рабочих дня** (при заказе сегодня — доставка послезавтра)
- **Базовый тариф:** 655 руб.
- **Экспресс-доплата:** 393 руб.
- **Итоговая стоимость доставки:** **1 048 руб.**

---

## 💰 Итоговая финансовая смета

| Статья расходов | Сумма |
| :--- | :---: |
| Ноутбук Apple MacBook Air 13" M3 16/512GB Space Gray | 149 990 руб. |
| Экспресс-доставка курьером до двери (г. Казань) | 1 048 руб. |
| **ИТОГО К ОПЛАТЕ:** | **151 038 руб.** |

---

> Отчет сгенерирован автоматически в рамках многосерверной оркестрации Model Context Protocol (MCP).
`;

      return {
        content: `<mcp_call name="saveToFile">{"filename": "work-laptop-kazan.md", "content": ${JSON.stringify(reportMarkdown)}}</mcp_call>`,
        promptTokens: 750,
        completionTokens: 35,
        totalTokens: 785,
      };
    }

    // Step 6: Final synthesis for user
    return {
      content: `### 🎯 Результат подбора ноутбука для работы (до 150 000 руб.)

Я провел всесторонний анализ каталога, проверил наличие, рассчитал доставку и сформировал отчет:

1. **Лучший выбор:** **Apple MacBook Air 13" M3 16/512GB Space Gray**
   - **Цена:** **149 990 руб.** (строго укладывается в бюджет до 150 000 руб.).
   - **Характеристики:** 8-ядерный процессор Apple M3, 16 ГБ объединенной памяти, 512 ГБ SSD, экран Liquid Retina 500 нит, автономность до 18 часов, вес всего 1.24 кг.
   - **Наличие:** 5 шт. на основном Складе Юг (Москва).
   - **Главные конкуренты в каталоге:** Lenovo ThinkPad T14 (139 990 руб., 32 ГБ RAM) и ASUS ZenBook 14 OLED (124 990 руб., экран 120Hz). MacBook Air M3 выбран за непревзойденное сочетание тишины (0 dB), автономности и производительности для рабочих задач.

2. **Экспресс-доставка в Казань:**
   - **Срок доставки:** **1-2 рабочих дня**.
   - **Стоимость курьерской экспресс-доставки:** **1 048 руб.** (базовый тариф 655 руб. + экспресс-доплата 393 руб.).
   - **Итоговая сумма заказа с доставкой:** **151 038 руб.**

3. **Сохраненный отчет:**
   - Подробная аналитическая выкладка со сравнительной таблицей всех 6 альтернатив, спецификациями и сметой сохранена в файл:
   - 📄 **\`data/reports/work-laptop-kazan.md\`**`,
      promptTokens: 850,
      completionTokens: 120,
      totalTokens: 970,
    };
  };

  await agent.sendMessage(userPrompt);

  const messages = agent.getState().messages;
  const lastAssistantMsg = messages[messages.length - 1];

  console.log('\n======================================================================');
  console.log('✅ ИТОГОВЫЙ ОТВЕТ АГЕНТА:');
  console.log('======================================================================\n');
  console.log(lastAssistantMsg.content);

  console.log('\n======================================================================');
  console.log('🔍 ТРАССИРОВКА ВЫЗОВОВ МЕЖДУ СЕРВЕРАМИ MCP (Cross-Server Flow):');
  console.log('======================================================================');
  const calls = lastAssistantMsg.mcpCalls || [];
  calls.forEach((c, idx) => {
    console.log(
      `Шаг ${idx + 1}: ${c.toolName.padEnd(23)} ➔ Сервер: "${c.serverName}" (${c.serverUrl}) [latency: ${c.latencyMs}ms]`
    );
  });

  const generatedFile = path.join(REPORTS_DIR, 'work-laptop-kazan.md');
  if (fs.existsSync(generatedFile)) {
    console.log('\n======================================================================');
    console.log(`📄 СОДЕРЖИМОЕ СОХРАНЕННОГО ФАЙЛА (${generatedFile}):`);
    console.log('======================================================================\n');
    console.log(fs.readFileSync(generatedFile, 'utf8'));
  }

  if (servers) {
    await servers.closeAll();
    console.log('\n🛑 Демо-серверы успешно остановлены.');
  }
}

runDemo().catch((err) => {
  console.error('Ошибка в демо:', err);
  process.exit(1);
});
