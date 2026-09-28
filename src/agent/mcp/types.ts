export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  transport: 'sse' | 'http';
  headers?: Record<string, string>;
  headersRaw?: string;
  enabled: boolean;
  createdAt: number;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
}

export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpConnectionResult {
  success: boolean;
  serverName: string;
  tools: McpToolInfo[];
  error?: string;
  latencyMs?: number;
}
