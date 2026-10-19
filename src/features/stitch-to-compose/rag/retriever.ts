/**
 * Hybrid RAG Retriever for Design-to-Compose
 *
 * Constructs structured RAG queries from Design IR and performs hybrid
 * retrieval (exact symbol/component matching + semantic token overlap).
 * TopK = 8 chunks.
 */

import { DesignScreen, DesignNode } from '../types';
import { ProjectIndex, RagQuery, RetrievalResult, ScoredChunk } from './types';

// In-memory retrieval cache: `${projectId}::${designIrHash}` -> RetrievalResult
const retrievalCache = new Map<string, RetrievalResult>();

/**
 * Creates a lightweight deterministic hash of the DesignScreen structure.
 */
export function hashDesignScreen(screen: DesignScreen): string {
  const parts: string[] = [screen.name || ''];
  const walk = (node: DesignNode) => {
    parts.push(node.type);
    if (node.text) parts.push(node.text.slice(0, 15));
    if (node.layout?.direction) parts.push(node.layout.direction);
    if (node.style?.backgroundColor) parts.push(node.style.backgroundColor);
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  };
  walk(screen.root);
  return 'ir_' + parts.join('|').slice(0, 200);
}

/**
 * Constructs a structured RAG query from Design IR.
 * Extracts:
 * - Screen layout (vertical layout, list, card grid)
 * - Required component types (button, card, input, app bar, icon, text)
 * - Theme and token needs
 */
export function buildRagQueryFromIR(screen: DesignScreen): RagQuery {
  const componentTypes = new Set<string>();
  const symbols = new Set<string>();
  const keywords = new Set<string>();

  // Always look for theme and typography
  symbols.add('Theme');
  symbols.add('CryptoTrackTheme');
  symbols.add('ApexTypography');
  symbols.add('ApexShapes');
  keywords.add('MaterialTheme');
  keywords.add('colorScheme');

  let hasVertical = false;
  let hasHorizontal = false;

  const traverse = (node: DesignNode) => {
    componentTypes.add(node.type);

    if (node.type === 'button') {
      symbols.add('ApexButton');
      symbols.add('Button');
      keywords.add('button');
      keywords.add('primary');
      keywords.add('onClick');
    } else if (node.type === 'card') {
      symbols.add('ApexCard');
      symbols.add('Card');
      symbols.add('SectionHeader');
      symbols.add('StatTile');
      keywords.add('card');
      keywords.add('elevation');
      keywords.add('surface');
    } else if (node.type === 'input') {
      symbols.add('ApexSearchBar');
      symbols.add('OutlinedTextField');
      keywords.add('search');
      keywords.add('input');
      keywords.add('text field');
    } else if (node.type === 'divider') {
      keywords.add('HorizontalDivider');
      keywords.add('Divider');
    } else if (node.type === 'icon') {
      keywords.add('Icon');
      keywords.add('CoinIcon');
      if (node.iconName) {
        keywords.add(node.iconName);
      }
    } else if (node.type === 'image') {
      keywords.add('AsyncImage');
      keywords.add('Image');
    }

    if (node.layout?.direction === 'column') hasVertical = true;
    if (node.layout?.direction === 'row') hasHorizontal = true;

    // Check texts for semantic keywords (price, crypto, search, header)
    if (node.text) {
      const lower = node.text.toLowerCase();
      if (lower.includes('$') || lower.includes('%') || lower.includes('usd') || lower.includes('btc') || lower.includes('eth')) {
        symbols.add('PriceTexts');
        symbols.add('CoinListItem');
        keywords.add('price');
        keywords.add('market');
      }
      if (lower.includes('search') || lower.includes('поиск')) {
        symbols.add('ApexSearchBar');
      }
    }

    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  };

  traverse(screen.root);

  const rawQuery = [
    `Screen: ${screen.name || 'Screen'}`,
    hasVertical ? 'vertical column layout' : '',
    hasHorizontal ? 'horizontal row elements' : '',
    Array.from(componentTypes).join(', '),
    'existing design system components and tokens',
  ]
    .filter(Boolean)
    .join(' | ');

  return {
    rawQuery,
    screenType: hasVertical ? 'column' : 'container',
    symbols: Array.from(symbols),
    keywords: Array.from(keywords),
    componentTypes: Array.from(componentTypes),
    tokensNeeded: {
      colors: true,
      typography: true,
      spacing: true,
    },
  };
}

/**
 * Executes hybrid retrieval across project index.
 */
export function retrieveRelevantChunks(
  index: ProjectIndex,
  query: RagQuery,
  topK = 8
): RetrievalResult {
  const irHash = query.rawQuery;
  const cacheKey = `${index.projectId}::${irHash}`;

  if (retrievalCache.has(cacheKey)) {
    const cached = retrievalCache.get(cacheKey)!;
    return {
      ...cached,
      fromCache: true,
    };
  }

  const scored: ScoredChunk[] = [];
  const queryTerms = [
    ...query.symbols.map((s) => s.toLowerCase()),
    ...query.keywords.map((k) => k.toLowerCase()),
    ...query.componentTypes.map((c) => c.toLowerCase()),
  ];

  for (const chunk of index.chunks) {
    let score = 0;
    const matchedSymbols: string[] = [];
    const matchedKeywords: string[] = [];

    const chunkSymbolLower = chunk.symbol.toLowerCase();
    const chunkContentLower = chunk.content.toLowerCase();
    const chunkFileLower = chunk.file.toLowerCase();

    // 1. Exact or partial symbol match (Highest Boost)
    for (const sym of query.symbols) {
      const symLower = sym.toLowerCase();
      if (chunkSymbolLower === symLower) {
        score += 10.0;
        matchedSymbols.push(sym);
      } else if (chunkSymbolLower.includes(symLower) || symLower.includes(chunkSymbolLower)) {
        score += 5.0;
        matchedSymbols.push(sym);
      }
    }

    // 2. Design System / Component Boost
    if (chunk.metadata?.isDesignSystem || chunkFileLower.includes('designsystem')) {
      score += 3.0;
    }

    // 3. Composable Boost for UI components
    if (chunk.type === 'composable') {
      score += 2.0;
    }

    // 4. Keyword & Term Overlap
    for (const kw of query.keywords) {
      const kwLower = kw.toLowerCase();
      if (chunkContentLower.includes(kwLower) || chunk.tags.includes(kwLower)) {
        score += 1.5;
        if (!matchedKeywords.includes(kw)) matchedKeywords.push(kw);
      }
    }

    // 5. Additional term overlap
    for (const term of queryTerms) {
      if (chunkContentLower.includes(term)) {
        score += 0.5;
      }
    }

    if (score > 0) {
      scored.push({
        chunk,
        score: Math.round(score * 100) / 100,
        matchedSymbols,
        matchedKeywords,
      });
    }
  }

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // Take topK
  const topChunks = scored.slice(0, topK);

  const result: RetrievalResult = {
    query,
    chunks: topChunks,
    totalCandidates: scored.length,
    fromCache: false,
  };

  retrievalCache.set(cacheKey, result);
  return result;
}
