/**
 * Android/Kotlin Project Indexer & Cache
 *
 * Scans, chunks, and indexes Android projects (specifically Kotlin Compose,
 * Themes, and Design Systems).
 * Supports both filesystem discovery in Node.js / CLI and high-fidelity built-in
 * seeds in the browser.
 */

import { ProjectIndex, CodeChunk } from './types';
import { chunkFile } from './chunker';

export const DEFAULT_PROJECT_ID = 'cryptotrack';
export const DEFAULT_PROJECT_PATH = 'C:/Users/W/Projects/CryptoTrack';

// In-memory index cache: cacheKey -> ProjectIndex
const indexCache = new Map<string, ProjectIndex>();

/**
 * Built-in foundational chunks for CryptoTrack design system.
 * Guarantees instantaneous, zero-latency RAG retrieval in browser environments
 * even when Node fs is not accessible from the browser frontend.
 */
export const BUILTIN_CRYPTOTRACK_CHUNKS: CodeChunk[] = [
  {
    id: 'core/designsystem/component/ApexButton.kt#ApexButton_13',
    file: 'core/designsystem/component/ApexButton.kt',
    symbol: 'ApexButton',
    type: 'composable',
    language: 'kotlin',
    startLine: 13,
    endLine: 45,
    tags: ['composable', 'ui', 'designsystem', 'component', 'button', 'apexbutton'],
    content: `@Composable
fun ApexButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    style: ApexButtonStyle = ApexButtonStyle.Primary,
    enabled: Boolean = true,
) {
    when (style) {
        ApexButtonStyle.Primary -> Button(
            onClick = onClick,
            modifier = modifier,
            enabled = enabled,
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ),
        ) {
            Text(text = text, style = MaterialTheme.typography.titleMedium)
        }

        ApexButtonStyle.Secondary -> OutlinedButton(
            onClick = onClick,
            modifier = modifier,
            enabled = enabled,
        ) {
            Text(text = text, style = MaterialTheme.typography.titleMedium)
        }

        ApexButtonStyle.Ghost -> TextButton(onClick = onClick, modifier = modifier, enabled = enabled) {
            Text(text = text, style = MaterialTheme.typography.titleMedium)
        }
    }
}`,
    metadata: {
      packageName: 'com.cryptotrack.core.designsystem.component',
      isComposable: true,
      isDesignSystem: true,
    },
  },
  {
    id: 'core/designsystem/component/ApexButtonStyle.kt#ApexButtonStyle_1',
    file: 'core/designsystem/component/ApexButtonStyle.kt',
    symbol: 'ApexButtonStyle',
    type: 'class',
    language: 'kotlin',
    startLine: 1,
    endLine: 8,
    tags: ['designsystem', 'style', 'button', 'apexbuttonstyle'],
    content: `enum class ApexButtonStyle {
    Primary,
    Secondary,
    Ghost,
}`,
    metadata: {
      packageName: 'com.cryptotrack.core.designsystem.component',
      isDesignSystem: true,
    },
  },
  {
    id: 'core/designsystem/component/ApexCard.kt#ApexCard_21',
    file: 'core/designsystem/component/ApexCard.kt',
    symbol: 'ApexCard',
    type: 'composable',
    language: 'kotlin',
    startLine: 21,
    endLine: 35,
    tags: ['composable', 'ui', 'designsystem', 'component', 'card', 'apexcard'],
    content: `/** Карточка Level 1: белая заливка на светлом фоне, радиус 16, мягкая граница. */
@Composable
fun ApexCard(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Card(
        modifier = modifier,
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.apexExtra.cardContainer,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        content()
    }
}`,
    metadata: {
      packageName: 'com.cryptotrack.core.designsystem.component',
      isComposable: true,
      isDesignSystem: true,
    },
  },
  {
    id: 'core/designsystem/component/ApexCard.kt#SectionHeader_39',
    file: 'core/designsystem/component/ApexCard.kt',
    symbol: 'SectionHeader',
    type: 'composable',
    language: 'kotlin',
    startLine: 39,
    endLine: 64,
    tags: ['composable', 'ui', 'designsystem', 'component', 'header', 'title', 'sectionheader'],
    content: `/** Заголовок секции (headline-md) с опциональным action справа. */
@Composable
fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    action: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column {
            Text(text = title, style = MaterialTheme.typography.titleLarge)
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        action?.invoke()
    }
}`,
    metadata: {
      packageName: 'com.cryptotrack.core.designsystem.component',
      isComposable: true,
      isDesignSystem: true,
    },
  },
  {
    id: 'core/designsystem/component/ApexCard.kt#StatTile_68',
    file: 'core/designsystem/component/ApexCard.kt',
    symbol: 'StatTile',
    type: 'composable',
    language: 'kotlin',
    startLine: 68,
    endLine: 86,
    tags: ['composable', 'ui', 'designsystem', 'component', 'stat', 'stattile'],
    content: `/** Тайл статистики: label-caps сверху, значение моноширинным шрифтом. */
@Composable
fun StatTile(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(text = value, style = NumericTextStyle)
    }
}`,
    metadata: {
      packageName: 'com.cryptotrack.core.designsystem.component',
      isComposable: true,
      isDesignSystem: true,
    },
  },
  {
    id: 'core/designsystem/component/ApexSearchBar.kt#ApexSearchBar_1',
    file: 'core/designsystem/component/ApexSearchBar.kt',
    symbol: 'ApexSearchBar',
    type: 'composable',
    language: 'kotlin',
    startLine: 1,
    endLine: 40,
    tags: ['composable', 'ui', 'designsystem', 'component', 'input', 'search', 'apexsearchbar'],
    content: `@Composable
fun ApexSearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Поиск по активам...",
    onSearch: (String) -> Unit = {},
    active: Boolean = false,
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        modifier = modifier.fillMaxWidth(),
        placeholder = { Text(placeholder) },
        leadingIcon = { Icon(Icons.Default.Search, contentDescription = "Поиск") },
        shape = MaterialTheme.shapes.medium,
        singleLine = true,
    )
}`,
    metadata: {
      packageName: 'com.cryptotrack.core.designsystem.component',
      isComposable: true,
      isDesignSystem: true,
    },
  },
  {
    id: 'core/designsystem/theme/Theme.kt#CryptoTrackTheme_163',
    file: 'core/designsystem/theme/Theme.kt',
    symbol: 'CryptoTrackTheme',
    type: 'theme',
    language: 'kotlin',
    startLine: 163,
    endLine: 179,
    tags: ['theme', 'designsystem', 'cryptotracktheme', 'materialtheme', 'colors'],
    content: `@Composable
fun CryptoTrackTheme(
    darkTheme: Boolean = false,
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) ApexDarkColors else ApexLightColors,
        typography = ApexTypography,
        shapes = ApexShapes,
    ) {
        CompositionLocalProvider(
            LocalApexPriceColors provides if (darkTheme) DarkPriceColors else LightPriceColors,
            LocalApexExtraColors provides if (darkTheme) DarkExtraColors else LightExtraColors,
            content = content,
        )
    }
}`,
    metadata: {
      packageName: 'com.cryptotrack.core.designsystem.theme',
      isComposable: true,
      isDesignSystem: true,
    },
  },
  {
    id: 'core/designsystem/theme/Shape.kt#ApexShapes_1',
    file: 'core/designsystem/theme/Shape.kt',
    symbol: 'ApexShapes',
    type: 'theme',
    language: 'kotlin',
    startLine: 1,
    endLine: 15,
    tags: ['theme', 'shape', 'radii', 'apexshapes'],
    content: `val ApexShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(24.dp),
)`,
    metadata: {
      packageName: 'com.cryptotrack.core.designsystem.theme',
      isDesignSystem: true,
    },
  },
  {
    id: 'core/designsystem/component/CoinListItem.kt#CoinListItem_1',
    file: 'core/designsystem/component/CoinListItem.kt',
    symbol: 'CoinListItem',
    type: 'composable',
    language: 'kotlin',
    startLine: 1,
    endLine: 50,
    tags: ['composable', 'ui', 'designsystem', 'list', 'item', 'coinlistitem'],
    content: `@Composable
fun CoinListItem(
    name: String,
    symbol: String,
    price: String,
    priceChange: String,
    isPositive: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column {
            Text(text = name, style = MaterialTheme.typography.titleMedium)
            Text(text = symbol.uppercase(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(text = price, style = MaterialTheme.typography.titleMedium)
            Text(
                text = priceChange,
                style = MaterialTheme.typography.labelMedium,
                color = if (isPositive) MaterialTheme.colorScheme.priceColors.up else MaterialTheme.colorScheme.priceColors.down,
            )
        }
    }
}`,
    metadata: {
      packageName: 'com.cryptotrack.core.designsystem.component',
      isComposable: true,
      isDesignSystem: true,
    },
  },
];

/**
 * Creates default project index seeded with design system components.
 */
export function createDefaultSeedIndex(
  projectId: string = DEFAULT_PROJECT_ID,
  projectPath: string = DEFAULT_PROJECT_PATH
): ProjectIndex {
  return {
    projectId,
    projectPath,
    versionHash: 'seed_cryptotrack_v1',
    indexedAt: Date.now(),
    totalFiles: 12,
    totalChunks: BUILTIN_CRYPTOTRACK_CHUNKS.length,
    chunks: [...BUILTIN_CRYPTOTRACK_CHUNKS],
  };
}

/**
 * Checks if Node.js filesystem is available.
 */
function isNodeFsAvailable(): boolean {
  try {
    const gProcess = (globalThis as any)?.process;
    return Boolean(
      typeof gProcess !== 'undefined' &&
      gProcess.versions != null &&
      gProcess.versions.node != null
    );
  } catch {
    return false;
  }
}

/**
 * Dynamically scans and indexes a local project directory if running in Node.js.
 * If running in browser, returns cached or seed index.
 */
export async function getOrBuildProjectIndex(
  projectId: string = DEFAULT_PROJECT_ID,
  customPath?: string
): Promise<ProjectIndex> {
  const projectPath = customPath || DEFAULT_PROJECT_PATH;
  const cacheKey = `${projectId}::${projectPath}`;

  if (indexCache.has(cacheKey)) {
    return indexCache.get(cacheKey)!;
  }

  // If in browser or fs unavailable, use seed index
  if (!isNodeFsAvailable()) {
    const seed = createDefaultSeedIndex(projectId, projectPath);
    indexCache.set(cacheKey, seed);
    return seed;
  }

  // Node.js environment: scan files dynamically
  try {
    const loadNodeModule = new Function('mod', 'return import(mod)');
    const fs: any = await loadNodeModule('node:fs');
    const path: any = await loadNodeModule('node:path');

    if (!fs.existsSync(projectPath)) {
      console.warn(`[ProjectIndex] Path "${projectPath}" not found. Falling back to built-in seed index.`);
      const seed = createDefaultSeedIndex(projectId, projectPath);
      indexCache.set(cacheKey, seed);
      return seed;
    }

    const chunks: CodeChunk[] = [];
    const validExts = new Set(['.kt', '.kts', '.xml', '.md', '.json']);
    const skipDirs = new Set(['build', '.gradle', '.git', '.kotlin', '.zcode', 'intermediates']);

    let totalFilesScanned = 0;

    const walkDir = (dir: string) => {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        return;
      }

      for (const entry of entries) {
        if (skipDirs.has(entry)) continue;
        const fullPath = path.join(dir, entry);
        let stat;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          walkDir(fullPath);
        } else if (stat.isFile()) {
          const ext = path.extname(entry).toLowerCase();
          if (validExts.has(ext)) {
            totalFilesScanned++;
            // Limit scanning depth or size per file to 256KB
            if (stat.size < 256 * 1024) {
              try {
                const content = fs.readFileSync(fullPath, 'utf8');
                const relPath = path.relative(projectPath, fullPath).replace(/\\/g, '/');
                const fileChunks = chunkFile(relPath, content);
                chunks.push(...fileChunks);
              } catch {
                // Ignore read errors
              }
            }
          }
        }
      }
    };

    // Prioritize scanning designsystem, core, and docs first
    const prioritySubdirs = [
      path.join(projectPath, 'core', 'designsystem'),
      path.join(projectPath, 'docs'),
      path.join(projectPath, 'app', 'src', 'main'),
    ];

    for (const pSub of prioritySubdirs) {
      if (fs.existsSync(pSub)) {
        walkDir(pSub);
      }
    }

    // Then walk full root if chunks count is modest
    if (chunks.length < 50) {
      walkDir(projectPath);
    }

    // Merge with built-in seeds to ensure critical components are always present
    for (const seedChunk of BUILTIN_CRYPTOTRACK_CHUNKS) {
      if (!chunks.some((c) => c.symbol === seedChunk.symbol)) {
        chunks.push(seedChunk);
      }
    }

    const index: ProjectIndex = {
      projectId,
      projectPath,
      versionHash: `hash_${Date.now()}_${chunks.length}`,
      indexedAt: Date.now(),
      totalFiles: totalFilesScanned,
      totalChunks: chunks.length,
      chunks,
    };

    indexCache.set(cacheKey, index);
    return index;
  } catch (err) {
    console.warn('[ProjectIndex] Dynamic indexing failed, using seed:', err);
    const fallback = createDefaultSeedIndex(projectId, projectPath);
    indexCache.set(cacheKey, fallback);
    return fallback;
  }
}
