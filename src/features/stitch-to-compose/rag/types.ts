/**
 * RAG Types for Android/Kotlin Codebase Indexing & Retrieval
 */

export type ChunkType =
  | 'composable'
  | 'class'
  | 'interface'
  | 'object'
  | 'function'
  | 'theme'
  | 'markdown'
  | 'xml_resource'
  | 'config';

export type ChunkLanguage = 'kotlin' | 'markdown' | 'xml' | 'json' | 'other';

export interface CodeChunk {
  id: string;
  file: string;
  symbol: string;
  type: ChunkType;
  language: ChunkLanguage;
  content: string;
  startLine: number;
  endLine: number;
  tags: string[];
  metadata?: {
    packageName?: string;
    isComposable?: boolean;
    isDesignSystem?: boolean;
    hasPreview?: boolean;
    parameters?: string[];
  };
}

export interface ProjectIndex {
  projectId: string;
  projectPath: string;
  versionHash: string;
  indexedAt: number;
  totalFiles: number;
  totalChunks: number;
  chunks: CodeChunk[];
}

export interface RagQuery {
  rawQuery: string;
  screenType?: string;
  symbols: string[];
  keywords: string[];
  componentTypes: string[];
  tokensNeeded?: {
    colors?: boolean;
    typography?: boolean;
    spacing?: boolean;
  };
}

export interface ScoredChunk {
  chunk: CodeChunk;
  score: number;
  matchedSymbols: string[];
  matchedKeywords: string[];
}

export interface RetrievalResult {
  query: RagQuery;
  chunks: ScoredChunk[];
  totalCandidates: number;
  fromCache?: boolean;
}
