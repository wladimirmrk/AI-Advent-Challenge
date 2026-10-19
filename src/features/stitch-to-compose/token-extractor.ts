/**
 * Frequency-based Design Token Extractor
 *
 * Extracts recurring design tokens (colors, spacing, font sizes, radii, shadows)
 * from the parsed Design IR tree.
 */

import { DesignNode, DesignTokens } from './types';

export function extractDesignTokens(root: DesignNode): DesignTokens {
  const colorCounts: Record<string, number> = {};
  const spacingCounts: Record<number, number> = {};
  const fontSizeCounts: Record<number, number> = {};
  const fontWeightCounts: Record<string, number> = {};
  const radiusCounts: Record<number, number> = {};
  const shadowCounts: Record<string, number> = {};

  const recordColor = (c?: string) => {
    if (!c || c === 'transparent' || c === 'inherit') return;
    const norm = c.trim().toLowerCase();
    colorCounts[norm] = (colorCounts[norm] || 0) + 1;
  };

  const recordSpacing = (val?: number) => {
    if (typeof val === 'number' && val > 0 && !isNaN(val)) {
      spacingCounts[val] = (spacingCounts[val] || 0) + 1;
    }
  };

  const recordFontSize = (val?: number) => {
    if (typeof val === 'number' && val > 0 && !isNaN(val)) {
      fontSizeCounts[val] = (fontSizeCounts[val] || 0) + 1;
    }
  };

  const recordFontWeight = (w?: string | number) => {
    if (w !== undefined && w !== null && w !== '') {
      const key = String(w).toLowerCase();
      fontWeightCounts[key] = (fontWeightCounts[key] || 0) + 1;
    }
  };

  const recordRadius = (r?: number) => {
    if (typeof r === 'number' && r > 0 && !isNaN(r)) {
      radiusCounts[r] = (radiusCounts[r] || 0) + 1;
    }
  };

  const recordShadow = (s?: string) => {
    if (s && s !== 'none') {
      const norm = s.trim();
      shadowCounts[norm] = (shadowCounts[norm] || 0) + 1;
    }
  };

  const traverse = (node: DesignNode) => {
    if (node.style) {
      recordColor(node.style.backgroundColor);
      recordColor(node.style.textColor);
      if (node.style.border?.color) {
        recordColor(node.style.border.color);
      }
      recordFontSize(node.style.fontSize);
      recordFontWeight(node.style.fontWeight);
      recordRadius(node.style.borderRadius);
      recordShadow(node.style.shadow);
    }

    if (node.layout) {
      recordSpacing(node.layout.gap);
      if (node.layout.padding) {
        recordSpacing(node.layout.padding.horizontal);
        recordSpacing(node.layout.padding.vertical);
        recordSpacing(node.layout.padding.top);
        recordSpacing(node.layout.padding.bottom);
        recordSpacing(node.layout.padding.left);
        recordSpacing(node.layout.padding.right);
      }
      if (node.layout.margin) {
        recordSpacing(node.layout.margin.top);
        recordSpacing(node.layout.margin.bottom);
        recordSpacing(node.layout.margin.left);
        recordSpacing(node.layout.margin.right);
      }
    }

    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  };

  traverse(root);

  // 1. Process Colors
  const sortedColors = Object.entries(colorCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([col]) => col);

  const colors: Record<string, string> = {};
  if (sortedColors.length > 0) {
    // If root has a background, use it as background
    const rootBg = root.style?.backgroundColor?.toLowerCase();
    if (rootBg && sortedColors.includes(rootBg)) {
      colors['background'] = rootBg;
    } else {
      colors['background'] = sortedColors[0];
    }

    let pIndex = 1;
    for (const col of sortedColors) {
      if (col === colors['background']) continue;
      if (!colors['primary']) {
        colors['primary'] = col;
      } else if (!colors['surface']) {
        colors['surface'] = col;
      } else if (!colors['textPrimary']) {
        colors['textPrimary'] = col;
      } else {
        colors[`accent_${pIndex++}`] = col;
      }
    }
  }

  // 2. Process Spacing
  const sortedSpacing = Object.keys(spacingCounts)
    .map(Number)
    .sort((a, b) => a - b);

  const spacing: Record<string, number> = {};
  const spacingLabels = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'];
  sortedSpacing.forEach((val, idx) => {
    const label = idx < spacingLabels.length ? spacingLabels[idx] : `spacing_${val}`;
    spacing[label] = val;
  });

  // 3. Process Font Sizes
  const sortedFontSizes = Object.keys(fontSizeCounts)
    .map(Number)
    .sort((a, b) => a - b);
  const fontSizes: Record<string, number> = {};
  const fontLabels = ['caption', 'bodySmall', 'bodyMedium', 'titleMedium', 'headlineSmall', 'headlineMedium'];
  sortedFontSizes.forEach((val, idx) => {
    const label = idx < fontLabels.length ? fontLabels[idx] : `size_${val}`;
    fontSizes[label] = val;
  });

  // 4. Process Font Weights
  const fontWeights: Record<string, string | number> = {};
  for (const [w] of Object.entries(fontWeightCounts).sort((a, b) => b[1] - a[1])) {
    const num = Number(w);
    if (!isNaN(num)) {
      if (num >= 700) fontWeights['bold'] = num;
      else if (num >= 600) fontWeights['semibold'] = num;
      else if (num >= 500) fontWeights['medium'] = num;
      else fontWeights['regular'] = num;
    } else {
      fontWeights[w] = w;
    }
  }

  // 5. Process Radii
  const sortedRadii = Object.keys(radiusCounts)
    .map(Number)
    .sort((a, b) => a - b);
  const radii: Record<string, number> = {};
  const radiusLabels = ['small', 'medium', 'large', 'pill'];
  sortedRadii.forEach((val, idx) => {
    const label = idx < radiusLabels.length ? radiusLabels[idx] : `radius_${val}`;
    radii[label] = val;
  });

  // 6. Process Shadows
  const shadows: Record<string, string> = {};
  Object.keys(shadowCounts).forEach((s, idx) => {
    shadows[`elevation_${idx + 1}`] = s;
  });

  return {
    colors,
    spacing,
    fontSizes,
    fontWeights,
    radii,
    shadows,
  };
}
