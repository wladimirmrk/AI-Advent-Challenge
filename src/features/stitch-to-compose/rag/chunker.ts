/**
 * Semantic Code Chunker for Android Kotlin & Compose Projects
 *
 * Preserves semantic boundaries:
 * - Kotlin: @Composable fun, class, interface, object, function
 * - Markdown: Headings (#, ##, ###)
 * - XML: Resource definitions
 */

import { CodeChunk, ChunkType } from './types';

function extractPackage(content: string): string | undefined {
  const match = content.match(/^package\s+([a-zA-Z0-9_.]+)/m);
  return match ? match[1] : undefined;
}

/**
 * Splits Kotlin source code into semantic chunks preserving Composable functions,
 * classes, interfaces, and theme objects.
 */
export function chunkKotlinFile(filePath: string, content: string): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const lines = content.split('\n');
  const packageName = extractPackage(content);
  const isDesignSystem = filePath.toLowerCase().includes('designsystem') || filePath.toLowerCase().includes('theme');

  // Normalize file path for display
  const normFile = filePath.replace(/\\/g, '/');

  // 1. Check for entire file as theme/tokens if small and cohesive (e.g. Type.kt, Shape.kt, Theme.kt)
  const isThemeFile = /theme|type|color|shape/i.test(normFile);

  // Regexes for top-level declaration boundaries
  const composableRegex = /@Composable\s+(?:(?:inline|private|public|internal)\s+)*fun\s+([a-zA-Z0-9_]+)/;
  const functionRegex = /^(?:(?:inline|private|public|internal)\s+)*fun\s+([a-zA-Z0-9_]+)/;
  const classRegex = /^(?:(?:sealed|data|open|abstract|private|internal)\s+)*(?:class|interface|object)\s+([a-zA-Z0-9_]+)/;

  let currentChunkLines: string[] = [];
  let currentStartLine = 1;
  let currentSymbol = isThemeFile ? 'ThemeDefinition' : 'TopLevel';
  let currentType: ChunkType = isThemeFile ? 'theme' : 'class';
  let isComposable = false;
  let braceDepth = 0;
  let inDeclaration = false;

  const flushChunk = (endLine: number) => {
    if (currentChunkLines.length === 0) return;
    const body = currentChunkLines.join('\n').trim();
    if (body.length < 20) return; // ignore trivial snippets

    const tags: string[] = [];
    if (isComposable) tags.push('composable', 'ui');
    if (isDesignSystem) tags.push('designsystem', 'component');
    if (isThemeFile) tags.push('theme');
    tags.push(currentSymbol.toLowerCase());

    chunks.push({
      id: `${normFile}#${currentSymbol}_${currentStartLine}`,
      file: normFile,
      symbol: currentSymbol,
      type: currentType,
      language: 'kotlin',
      content: body,
      startLine: currentStartLine,
      endLine,
      tags,
      metadata: {
        packageName,
        isComposable,
        isDesignSystem,
      },
    });

    currentChunkLines = [];
    inDeclaration = false;
    isComposable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineNum = i + 1;

    // Track annotations preceding a function or class
    if (braceDepth <= 0 && trimmed.startsWith('@Composable')) {
      isComposable = true;
    }

    // Check if line starts a new Composable or declaration at top-level (braceDepth <= 0)
    if (braceDepth <= 0) {
      const compMatch = trimmed.match(composableRegex);
      const clsMatch = trimmed.match(classRegex);
      const fnMatch = trimmed.match(functionRegex);

      if (compMatch || clsMatch || fnMatch) {
        if (inDeclaration && currentChunkLines.length > 0) {
          flushChunk(lineNum - 1);
        }

        currentStartLine = lineNum;
        inDeclaration = true;

        if (compMatch || (fnMatch && isComposable)) {
          currentSymbol = compMatch ? compMatch[1] : fnMatch![1];
          currentType = 'composable';
          isComposable = true;
        } else if (clsMatch) {
          currentSymbol = clsMatch[1];
          currentType = isThemeFile ? 'theme' : 'class';
          isComposable = false;
        } else if (fnMatch) {
          currentSymbol = fnMatch[1];
          currentType = 'function';
          isComposable = false;
        }
      }
    }

    currentChunkLines.push(line);

    // Track braces
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '{') braceDepth++;
      else if (char === '}') braceDepth--;
    }

    // If declaration ended
    if (inDeclaration && braceDepth === 0 && (trimmed === '}' || trimmed.endsWith('}'))) {
      flushChunk(lineNum);
    }
  }

  // Flush any remaining lines
  if (currentChunkLines.length > 0) {
    flushChunk(lines.length);
  }

  // If no semantic chunks were extracted (e.g. single file script or declaration), chunk entire file
  if (chunks.length === 0 && content.trim().length > 0) {
    chunks.push({
      id: `${normFile}#full`,
      file: normFile,
      symbol: normFile.split('/').pop()?.replace('.kt', '') || 'File',
      type: isThemeFile ? 'theme' : 'class',
      language: 'kotlin',
      content: content.trim(),
      startLine: 1,
      endLine: lines.length,
      tags: ['kotlin', isDesignSystem ? 'designsystem' : 'code'],
      metadata: {
        packageName,
        isComposable: content.includes('@Composable'),
        isDesignSystem,
      },
    });
  }

  return chunks;
}

/**
 * Splits Markdown files by section headings (#, ##, ###).
 */
export function chunkMarkdownFile(filePath: string, content: string): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const lines = content.split('\n');
  const normFile = filePath.replace(/\\/g, '/');

  let currentHeading = normFile.split('/').pop()?.replace('.md', '') || 'Overview';
  let currentLines: string[] = [];
  let currentStart = 1;

  const flush = (endLine: number) => {
    if (currentLines.length === 0) return;
    const body = currentLines.join('\n').trim();
    if (body.length > 10) {
      chunks.push({
        id: `${normFile}#${currentHeading.replace(/\s+/g, '_')}_${currentStart}`,
        file: normFile,
        symbol: currentHeading,
        type: 'markdown',
        language: 'markdown',
        content: body,
        startLine: currentStart,
        endLine,
        tags: ['doc', 'markdown', currentHeading.toLowerCase()],
      });
    }
    currentLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      if (currentLines.length > 0) {
        flush(i);
      }
      currentHeading = trimmed.replace(/^#+\s*/, '').trim();
      currentStart = i + 1;
    }
    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    flush(lines.length);
  }

  return chunks;
}

/**
 * Dispatches file chunking based on extension.
 */
export function chunkFile(filePath: string, content: string): CodeChunk[] {
  const norm = filePath.toLowerCase();
  if (norm.endsWith('.kt') || norm.endsWith('.kts')) {
    return chunkKotlinFile(filePath, content);
  }
  if (norm.endsWith('.md')) {
    return chunkMarkdownFile(filePath, content);
  }
  // Generic single chunk for other files (xml, json)
  const normFile = filePath.replace(/\\/g, '/');
  return [
    {
      id: `${normFile}#full`,
      file: normFile,
      symbol: normFile.split('/').pop() || 'Resource',
      type: norm.endsWith('.xml') ? 'xml_resource' : 'config',
      language: norm.endsWith('.xml') ? 'xml' : norm.endsWith('.json') ? 'json' : 'other',
      content: content.trim(),
      startLine: 1,
      endLine: content.split('\n').length,
      tags: ['resource'],
    },
  ];
}
