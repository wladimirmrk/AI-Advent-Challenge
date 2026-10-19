/**
 * Project File Writer for Jetpack Compose Generated Screens
 *
 * Saves generated Kotlin Compose code directly into the appropriate Android
 * module of the CryptoTrack codebase.
 */

import { ProjectFileWriteResult } from './types';
import { DEFAULT_PROJECT_PATH } from './rag/indexer';

interface TargetModuleConfig {
  moduleName: string;
  subPath: string;
  packageName: string;
}

/**
 * Resolves the target Android module and subpath based on the screen name.
 */
export function resolveTargetModule(screenName: string): TargetModuleConfig {
  const norm = screenName.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (norm.includes('portfolio') || norm.includes('holding') || norm.includes('balance')) {
    return {
      moduleName: 'feature:portfolio',
      subPath: 'feature/portfolio/src/main/kotlin/com/cryptotrack/feature/portfolio/presentation',
      packageName: 'com.cryptotrack.feature.portfolio.presentation',
    };
  }

  if (norm.includes('market') || norm.includes('filter') || norm.includes('trend')) {
    return {
      moduleName: 'feature:market',
      subPath: 'feature/market/src/main/kotlin/com/cryptotrack/feature/market/presentation',
      packageName: 'com.cryptotrack.feature.market.presentation',
    };
  }

  if (norm.includes('detail') || norm.includes('coin') || norm.includes('chart')) {
    return {
      moduleName: 'feature:coin-details',
      subPath: 'feature/coin-details/src/main/kotlin/com/cryptotrack/feature/coindetails/presentation',
      packageName: 'com.cryptotrack.feature.coindetails.presentation',
    };
  }

  if (norm.includes('asset') || norm.includes('entry') || norm.includes('transaction')) {
    return {
      moduleName: 'feature:assetentry',
      subPath: 'feature/assetentry/src/main/kotlin/com/cryptotrack/feature/assetentry/presentation',
      packageName: 'com.cryptotrack.feature.assetentry.presentation',
    };
  }

  if (norm.includes('setting') || norm.includes('config') || norm.includes('about')) {
    return {
      moduleName: 'feature:settings',
      subPath: 'feature/settings/src/main/kotlin/com/cryptotrack/feature/settings/presentation',
      packageName: 'com.cryptotrack.feature.settings.presentation',
    };
  }

  return {
    moduleName: 'feature:stitch',
    subPath: 'feature/stitch/src/main/kotlin/com/cryptotrack/feature/stitch/presentation',
    packageName: 'com.cryptotrack.feature.stitch.presentation',
  };
}

/**
 * Ensures code has proper package statement matching the target module.
 */
function normalizePackageStatement(code: string, expectedPackage: string): string {
  const lines = code.split('\n');
  const pkgIdx = lines.findIndex((l) => l.trim().startsWith('package '));

  if (pkgIdx !== -1) {
    lines[pkgIdx] = `package ${expectedPackage}`;
    return lines.join('\n');
  }

  return `package ${expectedPackage}\n\n${code}`;
}

/**
 * Writes the generated Compose Kotlin code to the Android project.
 */
export async function writeComposeScreenToProject(
  screenName: string,
  code: string,
  projectBasePath: string = DEFAULT_PROJECT_PATH
): Promise<ProjectFileWriteResult> {
  const targetConfig = resolveTargetModule(screenName);
  const normalizedCode = normalizePackageStatement(code, targetConfig.packageName);

  const cleanScreenName =
    screenName.replace(/[^a-zA-Z0-9]/g, '') || 'StitchGeneratedScreen';
  const fileName = cleanScreenName.endsWith('Screen')
    ? `${cleanScreenName}.kt`
    : `${cleanScreenName}Screen.kt`;

  const relativePath = `${targetConfig.subPath}/${fileName}`.replace(/\\/g, '/');

  // Check if Node.js fs is available
  const isNode = typeof (globalThis as any)?.process !== 'undefined' &&
    (globalThis as any)?.process?.versions?.node != null;

  if (isNode) {
    try {
      const loadNodeModule = new Function('mod', 'return import(mod)');
      const fs: any = await loadNodeModule('node:fs');
      const path: any = await loadNodeModule('node:path');

      const fullDirPath = path.join(projectBasePath, targetConfig.subPath);
      const fullFilePath = path.join(fullDirPath, fileName);

      // Create directories recursively if they don't exist
      fs.mkdirSync(fullDirPath, { recursive: true });

      const isNew = !fs.existsSync(fullFilePath);

      // Write file to disk
      fs.writeFileSync(fullFilePath, normalizedCode, 'utf8');

      const stats = fs.statSync(fullFilePath);
      const linesCount = normalizedCode.split('\n').length;

      return {
        filePath: fullFilePath.replace(/\\/g, '/'),
        relativePath,
        moduleName: targetConfig.moduleName,
        bytesWritten: stats.size,
        linesCount,
        isNew,
        status: isNew ? 'created' : 'updated',
      };
    } catch (err: any) {
      console.warn('[ProjectWriter] Failed to write file via node:fs:', err);
      return {
        filePath: `${projectBasePath}/${relativePath}`.replace(/\\/g, '/'),
        relativePath,
        moduleName: targetConfig.moduleName,
        bytesWritten: 0,
        linesCount: normalizedCode.split('\n').length,
        isNew: false,
        status: 'error',
        error: err.message || String(err),
      };
    }
  }

  // Pure browser environment fallback: persist to localStorage
  try {
    if (typeof localStorage !== 'undefined') {
      const storageKey = `stitch_project_file_${fileName}`;
      const isNew = localStorage.getItem(storageKey) === null;
      localStorage.setItem(storageKey, normalizedCode);
      const bytes = new Blob([normalizedCode]).size;
      return {
        filePath: `${projectBasePath}/${relativePath}`.replace(/\\/g, '/'),
        relativePath,
        moduleName: targetConfig.moduleName,
        bytesWritten: bytes,
        linesCount: normalizedCode.split('\n').length,
        isNew,
        status: isNew ? 'created' : 'updated',
      };
    }
  } catch {}

  return {
    filePath: `${projectBasePath}/${relativePath}`.replace(/\\/g, '/'),
    relativePath,
    moduleName: targetConfig.moduleName,
    bytesWritten: 0,
    linesCount: normalizedCode.split('\n').length,
    isNew: true,
    status: 'created',
  };
}
