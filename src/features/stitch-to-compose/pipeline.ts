/**
 * Stitch to Jetpack Compose Pipeline
 *
 * Orchestrates:
 * 1. Stitch HTML -> Deterministic Design IR + Design Tokens
 * 2. Design IR -> RAG Query -> Project Retrieval (Top 8 chunks)
 * 3. LLM Call 1: Compose Planning (maps nodes to existing components)
 * 4. LLM Call 2: Compose Generation (generates production Kotlin)
 * 5. Structured output with reused components, new components, and warnings.
 */

import { parseHtmlToDom } from './html-parser';
import { convertDomToDesignScreen } from './ir-converter';
import { getOrBuildProjectIndex } from './rag/indexer';
import { buildRagQueryFromIR, retrieveRelevantChunks } from './rag/retriever';
import {
  StitchToComposeOptions,
  StitchToComposePipelineResult,
  ComposePlan,
  ComposeGenerationResult,
  DesignScreen,
  ProjectFileWriteResult,
} from './types';
import { writeComposeScreenToProject } from './project-writer';
import { agentInstance, Agent } from '../../agent/Agent';

/**
 * Extracts JSON object from LLM response text that might be surrounded by markdown code blocks.
 */
function extractJsonFromResponse<T>(content: string): T | null {
  const trimmed = content.trim();

  // Try direct JSON parse
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed) as T;
    } catch {}
  }

  // Try markdown codeblock extraction
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch && jsonMatch[1]) {
    try {
      return JSON.parse(jsonMatch[1].trim()) as T;
    } catch {}
  }

  // Try finding outer curly braces
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      const sub = trimmed.slice(firstBrace, lastBrace + 1);
      return JSON.parse(sub) as T;
    } catch {}
  }

  return null;
}

/**
 * Fallback plan generator when LLM is unavailable or offline.
 */
function createFallbackPlan(screen: DesignScreen, retrievedSymbols: string[]): ComposePlan {
  const hasButton = retrievedSymbols.includes('ApexButton');
  const hasCard = retrievedSymbols.includes('ApexCard');
  const hasSearch = retrievedSymbols.includes('ApexSearchBar');
  const hasHeader = retrievedSymbols.includes('SectionHeader');

  const components: ComposePlan['components'] = [];

  const walk = (node: any) => {
    if (node.type === 'button') {
      components.push({
        designNodeId: node.id,
        nodeType: 'button',
        implementation: hasButton ? 'ApexButton' : 'Button',
        isReused: hasButton,
        reason: hasButton ? 'Matched existing project ApexButton component' : 'Standard Compose Button',
      });
    } else if (node.type === 'card') {
      components.push({
        designNodeId: node.id,
        nodeType: 'card',
        implementation: hasCard ? 'ApexCard' : 'Card',
        isReused: hasCard,
        reason: hasCard ? 'Matched existing project ApexCard component' : 'Standard Compose Card',
      });
    } else if (node.type === 'input') {
      components.push({
        designNodeId: node.id,
        nodeType: 'input',
        implementation: hasSearch ? 'ApexSearchBar' : 'OutlinedTextField',
        isReused: hasSearch,
        reason: hasSearch ? 'Matched existing project ApexSearchBar' : 'Standard OutlinedTextField',
      });
    } else if (node.type === 'text' && (node.tag === 'h1' || node.tag === 'h2') && hasHeader) {
      components.push({
        designNodeId: node.id,
        nodeType: 'text',
        implementation: 'SectionHeader',
        isReused: true,
        reason: 'Matched existing project SectionHeader for title',
      });
    }
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  };

  walk(screen.root);

  return {
    root: 'Scaffold',
    components,
    themeTokens: {
      colors: ['MaterialTheme.colorScheme.primaryContainer', 'MaterialTheme.colorScheme.surface'],
      typography: ['MaterialTheme.typography.titleLarge', 'MaterialTheme.typography.bodyMedium'],
      spacing: ['16.dp', '8.dp', '24.dp'],
    },
    hierarchySummary: `Scaffold -> Column (vertical scroll) -> ${components.map((c) => c.implementation).join(' + ')}`,
  };
}

/**
 * Fallback Kotlin generator when LLM is unavailable or offline.
 */
function createFallbackComposeCode(
  screen: DesignScreen,
  plan: ComposePlan,
  reused: string[]
): ComposeGenerationResult {
  const screenName = screen.name?.replace(/[^a-zA-Z0-9]/g, '') || 'StitchGeneratedScreen';

  const imports = [
    'package com.cryptotrack.feature.stitch',
    '',
    'import androidx.compose.foundation.layout.*',
    'import androidx.compose.foundation.rememberScrollState',
    'import androidx.compose.foundation.verticalScroll',
    'import androidx.compose.material3.*',
    'import androidx.compose.runtime.*',
    'import androidx.compose.ui.Alignment',
    'import androidx.compose.ui.Modifier',
    'import androidx.compose.ui.unit.dp',
  ];

  if (reused.includes('ApexButton')) {
    imports.push('import com.cryptotrack.core.designsystem.component.ApexButton');
    imports.push('import com.cryptotrack.core.designsystem.component.ApexButtonStyle');
  }
  if (reused.includes('ApexCard') || reused.includes('SectionHeader')) {
    imports.push('import com.cryptotrack.core.designsystem.component.ApexCard');
    imports.push('import com.cryptotrack.core.designsystem.component.SectionHeader');
  }
  if (reused.includes('ApexSearchBar')) {
    imports.push('import com.cryptotrack.core.designsystem.component.ApexSearchBar');
  }
  imports.push('import com.cryptotrack.core.designsystem.theme.CryptoTrackTheme');

  const code = `${imports.join('\n')}

@Composable
fun ${screenName}(
    modifier: Modifier = Modifier,
    onNavigateBack: () -> Unit = {},
) {
    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            SectionHeader(
                title = "${screen.name || 'Screen'}",
                subtitle = "Сгенерировано из Google Stitch Design IR",
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            ApexCard(
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "Карточка контента",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text = "Структурированный интерфейс, отображаемый с соблюдением дизайн-системы проекта.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            ApexButton(
                text = "Подтвердить действие",
                onClick = { /* Handle action */ },
                style = ApexButtonStyle.Primary,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
`;

  return {
    screen: {
      name: screenName,
      file: `${screenName}.kt`,
    },
    reusedComponents: reused,
    newComponents: [],
    code,
    warnings: ['Сгенерировано с помощью шаблона дизайн-системы (автономный режим).'],
    plan,
  };
}

/**
 * Main Pipeline Function:
 * Google Stitch HTML -> Design IR -> Project RAG -> Compose Plan -> Jetpack Compose
 */
export async function generateComposeFromStitch(
  options: StitchToComposeOptions,
  activeAgent: Agent = agentInstance
): Promise<StitchToComposePipelineResult> {
  const startTime = Date.now();
  let irTime = 0;
  let ragTime = 0;
  let planTime = 0;
  let genTime = 0;

  // 1. Deterministic HTML -> Normalized DOM -> Design IR + Tokens
  options.onProgress?.('parsing', 'Парсинг HTML и построение нормализованного DOM...');
  const t0 = Date.now();
  const dom = parseHtmlToDom(options.html);

  const screenName = options.screenName || 'PortfolioScreen';

  options.onProgress?.('ir', 'Трансформация DOM в Design IR и извлечение дизайн-токенов...');
  const designScreen = convertDomToDesignScreen(dom, screenName);
  irTime = Date.now() - t0;

  // 2. Project RAG Indexing & Retrieval
  options.onProgress?.('rag', 'Поиск контекста и существующих компонентов в Android-проекте...');
  const t1 = Date.now();
  let index;
  let retrievalResult;
  try {
    index = await getOrBuildProjectIndex(options.projectId, options.projectPath);
    const ragQuery = buildRagQueryFromIR(designScreen);
    retrievalResult = retrieveRelevantChunks(index, ragQuery, options.topK || 8);
  } catch (err) {
    console.warn('[StitchToCompose] RAG indexing failed, proceeding with fallback:', err);
    retrievalResult = {
      query: { rawQuery: 'fallback', symbols: [], keywords: [], componentTypes: [] },
      chunks: [],
      totalCandidates: 0,
      fromCache: false,
    };
  }
  ragTime = Date.now() - t1;

  // Prepare RAG Context for LLM
  const retrievedChunks = retrievalResult.chunks.map((sc) => ({
    file: sc.chunk.file,
    symbol: sc.chunk.symbol,
    type: sc.chunk.type,
    content: sc.chunk.content,
    score: sc.score,
  }));

  const projectContextText = retrievedChunks
    .map(
      (c) =>
        `--- File: ${c.file} [${c.type.toUpperCase()}] Symbol: ${c.symbol} ---\n${c.content}`
    )
    .join('\n\n');

  const symbolsFound = retrievedChunks.map((c) => c.symbol);

  // 3. LLM Call 1: Compose Planning Stage
  options.onProgress?.('planning', 'LLM Call 1: Создание структурированного Compose плана...');
  const t2 = Date.now();

  const planPrompt = `Ты — ведущий Android/Kotlin архитектор. Твоя задача — создать ПЛАН реализации экрана в Jetpack Compose по предоставленному Design IR с МАКСИМАЛЬНЫМ переиспользованием существующих компонентов проекта.

### 1. DESIGN IR:
${JSON.stringify(designScreen, null, 2)}

### 2. РЕЛЕВАНТНЫЕ СУЩЕСТВУЮЩИЕ КОМПОНЕНТЫ ПРОЕКТА (RAG):
${projectContextText || 'Существующие компоненты не найдены.'}

### ВАЖНЫЕ ПРАВИЛА:
1. Если в Design IR есть кнопка, а в проекте есть "ApexButton" — ОБЯЗАТЕЛЬНО используй "ApexButton", а НЕ стандартный "Button".
2. Если в Design IR есть карточка, а в проекте есть "ApexCard" — ОБЯЗАТЕЛЬНО используй "ApexCard", а НЕ "Card".
3. Если есть поисковая строка или ввод, используй "ApexSearchBar" или существующие инпуты.
4. Ответь СТРОГО в формате JSON без дополнительного текста:
{
  "root": "Scaffold",
  "components": [
    {
      "designNodeId": "id узла из IR",
      "nodeType": "тип узла (button/card/text/etc)",
      "implementation": "Название компонента (например: ApexButton или HeroBanner)",
      "isReused": true/false,
      "reason": "почему выбран этот компонент"
    }
  ],
  "themeTokens": {
    "colors": ["список токенов"],
    "typography": ["список типографики"],
    "spacing": ["список отступов"]
  },
  "hierarchySummary": "Краткое описание дерева Compose"
}`;

  let plan: ComposePlan | null = null;
  const planCtrl = new AbortController();
  const planTimeout = setTimeout(() => planCtrl.abort(), 6000);

  try {
    const planRes = await activeAgent.callLLM(
      [
        { role: 'system', content: 'You are an expert Jetpack Compose Architect. Output valid JSON only.' },
        { role: 'user', content: planPrompt },
      ],
      options.model,
      undefined,
      planCtrl.signal
    );
    clearTimeout(planTimeout);
    plan = extractJsonFromResponse<ComposePlan>(planRes.content);
  } catch (e) {
    clearTimeout(planTimeout);
    console.warn('[StitchToCompose] LLM Plan call timed out or failed, using fallback:', e);
  }

  if (!plan) {
    plan = createFallbackPlan(designScreen, symbolsFound);
  }
  planTime = Date.now() - t2;

  // 4. LLM Call 2: Compose Generation Stage
  options.onProgress?.('generating', 'LLM Call 2: Генерация production-ready Jetpack Compose кода...');
  const t3 = Date.now();

  const genPrompt = `Ты — ведущий Android разработчик. Сгенерируй production-ready Kotlin Jetpack Compose код для экрана на основе Design IR и Compose Plan.

### 1. DESIGN IR:
${JSON.stringify(designScreen, null, 2)}

### 2. COMPOSE PLAN:
${JSON.stringify(plan, null, 2)}

### 3. РЕЛЕВАНТНЫЙ КОНТЕКСТ ПРОЕКТА (RAG):
${projectContextText || 'Стандартные Material 3 компоненты.'}

### ПРАВИЛА ГЕНЕРАЦИИ:
- Напиши чистый, компилируемый Kotlin Jetpack Compose код.
- Функция: @Composable fun ${designScreen.name || 'StitchScreen'}(...)
- ОБЯЗАТЕЛЬНО используй переиспользуемые компоненты: ${plan.components.filter((c) => c.isReused).map((c) => c.implementation).join(', ') || 'ApexButton, ApexCard'}.
- Никакого HTML, CSS, WebView или абсолютного позиционирования.
- Верни СТРОГО валидный JSON следующей схемы:
{
  "screen": {
    "name": "${designScreen.name || 'StitchScreen'}",
    "file": "${(designScreen.name || 'StitchScreen')}.kt"
  },
  "reusedComponents": [список названий переиспользованных компонентов проекта],
  "newComponents": [список созданных новых компонентов],
  "code": "полный исходный код на Kotlin со всеми импортами",
  "warnings": [замечания или рекомендации]
}`;

  let generationResult: ComposeGenerationResult | null = null;
  const genCtrl = new AbortController();
  const genTimeout = setTimeout(() => genCtrl.abort(), 6000);

  try {
    const genRes = await activeAgent.callLLM(
      [
        { role: 'system', content: 'You are an expert Android Kotlin Developer. Output valid JSON only.' },
        { role: 'user', content: genPrompt },
      ],
      options.model,
      undefined,
      genCtrl.signal
    );
    clearTimeout(genTimeout);
    generationResult = extractJsonFromResponse<ComposeGenerationResult>(genRes.content);
  } catch (e) {
    clearTimeout(genTimeout);
    console.warn('[StitchToCompose] LLM Generation call timed out or failed, using fallback:', e);
  }

  if (!generationResult || !generationResult.code) {
    const reusedList = plan.components.filter((c) => c.isReused).map((c) => c.implementation);
    generationResult = createFallbackComposeCode(designScreen, plan, reusedList);
  } else {
    generationResult.plan = plan;
  }
  genTime = Date.now() - t3;

  // 5. Write generated screen to project files if enabled
  let writtenFile: ProjectFileWriteResult | undefined;
  let fileWritingTime = 0;
  if (options.writeToProject !== false && generationResult?.code) {
    options.onProgress?.('writing', 'Запись сгенерированного экрана в проект CryptoTrack...');
    const tWrite = Date.now();
    try {
      writtenFile = await writeComposeScreenToProject(
        designScreen.name || options.screenName || 'StitchScreen',
        generationResult.code,
        options.projectPath
      );
    } catch (err: any) {
      console.warn('[StitchToCompose] Failed to write screen to project:', err);
      writtenFile = {
        filePath: '',
        relativePath: '',
        moduleName: '',
        bytesWritten: 0,
        linesCount: 0,
        isNew: false,
        status: 'error',
        error: String(err?.message || err),
      };
    }
    fileWritingTime = Date.now() - tWrite;
  }

  options.onProgress?.('done', 'Генерация Compose успешно завершена!');

  return {
    designScreen,
    ragContext: {
      query: retrievalResult.query.rawQuery,
      chunks: retrievedChunks,
      fromCache: retrievalResult.fromCache,
    },
    plan,
    result: generationResult,
    writtenFile,
    timingMs: {
      irParsing: irTime,
      ragRetrieval: ragTime,
      planning: planTime,
      generation: genTime,
      fileWriting: fileWritingTime,
      total: Date.now() - startTime,
    },
  };
}
