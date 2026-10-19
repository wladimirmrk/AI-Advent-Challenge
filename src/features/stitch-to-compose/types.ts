/**
 * Design IR & Stitch-to-Compose Types
 *
 * Defines the stable intermediate representation (Design IR) connecting
 * Google Stitch screen exports to Android Jetpack Compose generation.
 */

export type DesignNodeType =
  | 'screen'
  | 'container'
  | 'row'
  | 'column'
  | 'text'
  | 'image'
  | 'icon'
  | 'button'
  | 'input'
  | 'card'
  | 'divider'
  | 'unknown';

export interface LayoutPadding {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  horizontal?: number;
  vertical?: number;
}

export interface LayoutMargin {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export interface LayoutAlignment {
  horizontal?: 'start' | 'center' | 'end' | 'space-between' | 'stretch';
  vertical?: 'top' | 'center' | 'bottom' | 'space-between' | 'stretch';
}

export interface LayoutSpec {
  width?: number | string;
  height?: number | string;
  padding?: LayoutPadding;
  margin?: LayoutMargin;
  gap?: number;
  direction?: 'row' | 'column';
  alignment?: LayoutAlignment;
  position?: 'relative' | 'absolute';
  flex?: number | string;
  grid?: { columns?: number; rows?: number };
}

export interface BorderSpec {
  width?: number;
  color?: string;
  style?: string;
}

export interface StyleSpec {
  backgroundColor?: string;
  textColor?: string;
  fontSize?: number;
  fontWeight?: string | number;
  lineHeight?: number;
  border?: BorderSpec;
  borderRadius?: number;
  opacity?: number;
  shadow?: string;
}

export interface DesignNode {
  id: string;
  type: DesignNodeType;
  text?: string;
  imageUrl?: string;
  iconName?: string;
  accessibilityLabel?: string;
  tag?: string;
  rawClasses?: string[];
  rawStyles?: Record<string, string>;
  layout?: LayoutSpec;
  style?: StyleSpec;
  children?: DesignNode[];
}

export interface DesignTokens {
  colors: Record<string, string>;
  spacing: Record<string, number>;
  fontSizes: Record<string, number>;
  fontWeights: Record<string, string | number>;
  radii: Record<string, number>;
  shadows: Record<string, string>;
}

export interface DesignScreen {
  id?: string;
  name?: string;
  width?: number;
  height?: number;
  root: DesignNode;
  tokens?: DesignTokens;
  metadata?: {
    source: 'google-stitch' | 'html-mock' | 'custom';
    nodeCount: number;
    depth: number;
    extractedAt: number;
  };
}

export interface ComposePlanComponent {
  designNodeId: string;
  nodeType: DesignNodeType;
  implementation: string;
  isReused: boolean;
  reason?: string;
}

export interface ComposePlan {
  root: string;
  components: ComposePlanComponent[];
  themeTokens?: {
    colors?: string[];
    typography?: string[];
    spacing?: string[];
  };
  hierarchySummary?: string;
}

export interface ComposeGenerationResult {
  screen: {
    name: string;
    file: string;
  };
  reusedComponents: string[];
  newComponents: string[];
  code: string;
  warnings: string[];
  plan?: ComposePlan;
}

export interface ProjectFileWriteResult {
  filePath: string;
  relativePath: string;
  moduleName: string;
  bytesWritten: number;
  linesCount: number;
  isNew: boolean;
  status: 'created' | 'updated' | 'error';
  error?: string;
}

/**
 * Hardcoded default Google Stitch Project ID for CryptoTrack
 */
export const DEFAULT_STITCH_PROJECT_ID = '5377012504763227664';

export interface StitchScreenPipelineInput {
  projectId?: string;
  screenName: string;
  agent: any; // Agent instance
}

export interface StitchScreenPipelineResult {
  projectId: string;
  screenId: string;
  screenName: string;
  screenData: unknown;
  html?: string;
  metadata?: Record<string, unknown>;
  toolName?: string;
  serverName?: string;
  fromMcp: boolean;
  latencyMs?: number;
  rawMcpCalls?: any[];
}

export interface StitchToComposeOptions {
  html: string;
  screenName?: string;
  screenId?: string;
  screenData?: unknown;
  projectId?: string;
  projectPath?: string;
  topK?: number;
  model?: string;
  writeToProject?: boolean;
  onProgress?: (
    stage: 'parsing' | 'ir' | 'rag' | 'planning' | 'generating' | 'writing' | 'done',
    message?: string
  ) => void;
}

export interface StitchToComposePipelineResult {
  designScreen: DesignScreen;
  ragContext: {
    query: string;
    chunks: Array<{
      file: string;
      symbol: string;
      type: string;
      content: string;
      score: number;
    }>;
    fromCache?: boolean;
  };
  plan: ComposePlan;
  result: ComposeGenerationResult;
  writtenFile?: ProjectFileWriteResult;
  timingMs: {
    irParsing: number;
    ragRetrieval: number;
    planning: number;
    generation: number;
    fileWriting?: number;
    total: number;
  };
}

