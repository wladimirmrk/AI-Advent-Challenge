/**
 * Normalized DOM to Design IR Converter
 *
 * Deterministically transforms a parsed DOM tree into a clean, compact
 * Design IR (DesignScreen & DesignNode) ready for Compose Planning & RAG.
 */

import { ParsedDomNode } from './html-parser';
import {
  DesignNode,
  DesignNodeType,
  DesignScreen,
  LayoutSpec,
  StyleSpec,
  LayoutPadding,
  LayoutMargin,
} from './types';
import { extractDesignTokens } from './token-extractor';

let nodeCounter = 0;

function generateId(prefix: string): string {
  nodeCounter += 1;
  return `${prefix}_${nodeCounter}`;
}

/**
 * Parses pixel/rem numeric values from strings like "16px", "1.5rem", "16", "24dp".
 */
function parseDimension(val?: string | number): number | undefined {
  if (typeof val === 'number') return val;
  if (!val || typeof val !== 'string') return undefined;

  const trimmed = val.trim();
  if (trimmed.endsWith('px')) {
    const num = parseFloat(trimmed);
    return isNaN(num) ? undefined : num;
  }
  if (trimmed.endsWith('rem')) {
    const num = parseFloat(trimmed);
    return isNaN(num) ? undefined : Math.round(num * 16);
  }
  if (trimmed.endsWith('dp')) {
    const num = parseFloat(trimmed);
    return isNaN(num) ? undefined : num;
  }
  const directNum = parseFloat(trimmed);
  return isNaN(directNum) ? undefined : directNum;
}

/**
 * Maps Tailwind spacing units (e.g. "4" -> 16px, "2" -> 8px, "0.5" -> 2px)
 */
function tailwindSpacing(unitStr: string): number {
  const n = parseFloat(unitStr);
  if (isNaN(n)) return 0;
  return Math.round(n * 4);
}

/**
 * Extracts LayoutSpec from DOM node styles and classes.
 */
function extractLayout(dom: ParsedDomNode, isRowDefault = false): LayoutSpec {
  const layout: LayoutSpec = {};
  const styles = dom.styles;
  const classes = dom.classes;

  // 1. Flex & Direction
  const display = styles.display || (classes.includes('flex') ? 'flex' : classes.includes('grid') ? 'grid' : undefined);
  const flexDir = styles.flexDirection || (classes.includes('flex-col') ? 'column' : classes.includes('flex-row') ? 'row' : undefined);

  if (flexDir === 'column') {
    layout.direction = 'column';
  } else if (flexDir === 'row' || (display === 'flex' && isRowDefault)) {
    layout.direction = 'row';
  }

  // 2. Width & Height
  const widthVal = parseDimension(styles.width);
  if (widthVal !== undefined) layout.width = widthVal;
  else if (classes.includes('w-full')) layout.width = '100%';
  else if (classes.includes('w-screen')) layout.width = '100vw';

  const heightVal = parseDimension(styles.height);
  if (heightVal !== undefined) layout.height = heightVal;
  else if (classes.includes('h-full')) layout.height = '100%';
  else if (classes.includes('h-screen')) layout.height = '100vh';

  // 3. Gap
  const gapVal = parseDimension(styles.gap);
  if (gapVal !== undefined) {
    layout.gap = gapVal;
  } else {
    const gapClass = classes.find((c) => c.startsWith('gap-'));
    if (gapClass) {
      const parts = gapClass.split('-');
      if (parts[1]) layout.gap = tailwindSpacing(parts[1]);
    }
  }

  // 4. Padding
  const padding: LayoutPadding = {};
  if (styles.padding) {
    const p = parseDimension(styles.padding);
    if (p !== undefined) {
      padding.horizontal = p;
      padding.vertical = p;
    }
  }
  if (styles.paddingLeft) padding.left = parseDimension(styles.paddingLeft);
  if (styles.paddingRight) padding.right = parseDimension(styles.paddingRight);
  if (styles.paddingTop) padding.top = parseDimension(styles.paddingTop);
  if (styles.paddingBottom) padding.bottom = parseDimension(styles.paddingBottom);

  // Check Tailwind padding classes
  for (const c of classes) {
    if (c.startsWith('p-')) {
      const p = tailwindSpacing(c.slice(2));
      padding.horizontal = p;
      padding.vertical = p;
    } else if (c.startsWith('px-')) {
      padding.horizontal = tailwindSpacing(c.slice(3));
    } else if (c.startsWith('py-')) {
      padding.vertical = tailwindSpacing(c.slice(3));
    } else if (c.startsWith('pt-')) {
      padding.top = tailwindSpacing(c.slice(3));
    } else if (c.startsWith('pb-')) {
      padding.bottom = tailwindSpacing(c.slice(3));
    } else if (c.startsWith('pl-')) {
      padding.left = tailwindSpacing(c.slice(3));
    } else if (c.startsWith('pr-')) {
      padding.right = tailwindSpacing(c.slice(3));
    }
  }

  if (Object.keys(padding).length > 0) {
    layout.padding = padding;
  }

  // 5. Margin
  const margin: LayoutMargin = {};
  if (styles.margin) {
    const m = parseDimension(styles.margin);
    if (m !== undefined) {
      margin.top = m;
      margin.bottom = m;
      margin.left = m;
      margin.right = m;
    }
  }
  if (styles.marginTop) margin.top = parseDimension(styles.marginTop);
  if (styles.marginBottom) margin.bottom = parseDimension(styles.marginBottom);
  if (styles.marginLeft) margin.left = parseDimension(styles.marginLeft);
  if (styles.marginRight) margin.right = parseDimension(styles.marginRight);

  for (const c of classes) {
    if (c.startsWith('m-')) {
      const m = tailwindSpacing(c.slice(2));
      margin.top = m;
      margin.bottom = m;
      margin.left = m;
      margin.right = m;
    } else if (c.startsWith('mt-')) margin.top = tailwindSpacing(c.slice(3));
    else if (c.startsWith('mb-')) margin.bottom = tailwindSpacing(c.slice(3));
    else if (c.startsWith('ml-')) margin.left = tailwindSpacing(c.slice(3));
    else if (c.startsWith('mr-')) margin.right = tailwindSpacing(c.slice(3));
  }

  if (Object.keys(margin).length > 0) {
    layout.margin = margin;
  }

  // 6. Alignment
  const alignItems = styles.alignItems;
  const justify = styles.justifyContent;
  if (alignItems || justify || classes.some((c) => c.startsWith('items-') || c.startsWith('justify-'))) {
    layout.alignment = {};
    if (alignItems === 'center' || classes.includes('items-center')) layout.alignment.vertical = 'center';
    else if (alignItems === 'flex-start' || classes.includes('items-start')) layout.alignment.vertical = 'top';
    else if (alignItems === 'flex-end' || classes.includes('items-end')) layout.alignment.vertical = 'bottom';

    if (justify === 'space-between' || classes.includes('justify-between')) layout.alignment.horizontal = 'space-between';
    else if (justify === 'center' || classes.includes('justify-center')) layout.alignment.horizontal = 'center';
    else if (justify === 'flex-start' || classes.includes('justify-start')) layout.alignment.horizontal = 'start';
    else if (justify === 'flex-end' || classes.includes('justify-end')) layout.alignment.horizontal = 'end';
  }

  return layout;
}

/**
 * Extracts StyleSpec from DOM node styles and classes.
 */
function extractStyle(dom: ParsedDomNode): StyleSpec {
  const style: StyleSpec = {};
  const styles = dom.styles;
  const classes = dom.classes;

  // Background
  if (styles.backgroundColor) {
    style.backgroundColor = styles.backgroundColor;
  } else if (styles.background) {
    style.backgroundColor = styles.background;
  } else {
    for (const c of classes) {
      if (c === 'bg-white') style.backgroundColor = '#FFFFFF';
      else if (c === 'bg-black') style.backgroundColor = '#000000';
      else if (c === 'bg-slate-950') style.backgroundColor = '#020617';
      else if (c === 'bg-slate-900') style.backgroundColor = '#0F172A';
      else if (c === 'bg-slate-800') style.backgroundColor = '#1E293B';
      else if (c === 'bg-blue-600') style.backgroundColor = '#2563EB';
      else if (c === 'bg-emerald-500') style.backgroundColor = '#10B981';
      else if (c.startsWith('bg-')) style.backgroundColor = c.replace('bg-', '#');
    }
  }

  // Text color
  if (styles.color) {
    style.textColor = styles.color;
  } else {
    for (const c of classes) {
      if (c === 'text-white') style.textColor = '#FFFFFF';
      else if (c === 'text-black') style.textColor = '#000000';
      else if (c === 'text-slate-400') style.textColor = '#94A3B8';
      else if (c === 'text-slate-300') style.textColor = '#CBD5E1';
      else if (c === 'text-slate-200') style.textColor = '#E2E8F0';
      else if (c === 'text-emerald-400') style.textColor = '#34D399';
      else if (c === 'text-emerald-500') style.textColor = '#10B981';
      else if (c.startsWith('text-') && !c.includes('-xs') && !c.includes('-sm') && !c.includes('-base') && !c.includes('-lg') && !c.includes('-xl') && !c.includes('-2xl') && !c.includes('-3xl')) {
        style.textColor = c.replace('text-', '#');
      }
    }
  }

  // Font size
  const fs = parseDimension(styles.fontSize);
  if (fs !== undefined) {
    style.fontSize = fs;
  } else {
    for (const c of classes) {
      if (c === 'text-xs') style.fontSize = 12;
      else if (c === 'text-sm') style.fontSize = 14;
      else if (c === 'text-base') style.fontSize = 16;
      else if (c === 'text-lg') style.fontSize = 18;
      else if (c === 'text-xl') style.fontSize = 20;
      else if (c === 'text-2xl') style.fontSize = 24;
      else if (c === 'text-3xl') style.fontSize = 30;
    }
  }

  // Font weight
  if (styles.fontWeight) {
    style.fontWeight = styles.fontWeight;
  } else {
    if (classes.includes('font-bold')) style.fontWeight = 700;
    else if (classes.includes('font-semibold')) style.fontWeight = 600;
    else if (classes.includes('font-medium')) style.fontWeight = 500;
    else if (classes.includes('font-normal')) style.fontWeight = 400;
  }

  // Border radius
  const br = parseDimension(styles.borderRadius);
  if (br !== undefined) {
    style.borderRadius = br;
  } else {
    for (const c of classes) {
      if (c === 'rounded-sm') style.borderRadius = 4;
      else if (c === 'rounded' || c === 'rounded-md') style.borderRadius = 8;
      else if (c === 'rounded-lg') style.borderRadius = 12;
      else if (c === 'rounded-xl') style.borderRadius = 16;
      else if (c === 'rounded-2xl') style.borderRadius = 24;
      else if (c === 'rounded-full') style.borderRadius = 9999;
    }
  }

  // Border
  if (styles.border || styles.borderColor || styles.borderWidth) {
    style.border = {
      width: parseDimension(styles.borderWidth) || 1,
      color: styles.borderColor || styles.border?.split(' ').pop(),
      style: styles.borderStyle || 'solid',
    };
  }

  // Opacity
  if (styles.opacity) {
    const op = parseFloat(styles.opacity);
    if (!isNaN(op)) style.opacity = op;
  }

  // Box shadow
  if (styles.boxShadow) {
    style.shadow = styles.boxShadow;
  }

  return style;
}

/**
 * Determines the DesignNodeType of a given DOM node.
 */
function classifyNodeType(dom: ParsedDomNode, isRoot: boolean): DesignNodeType {
  if (isRoot) return 'screen';

  const tag = dom.tag;
  const role = dom.attributes['role'];
  const classes = dom.classes.join(' ').toLowerCase();

  // Button
  if (
    tag === 'button' ||
    role === 'button' ||
    classes.includes('btn') ||
    classes.includes('button')
  ) {
    return 'button';
  }

  // Input
  if (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    role === 'searchbox' ||
    role === 'textbox' ||
    classes.includes('input') ||
    classes.includes('search-bar')
  ) {
    return 'input';
  }

  // Image
  if (tag === 'img' || dom.attributes['src']) {
    return 'image';
  }

  // Icon
  if (
    tag === 'svg' ||
    classes.includes('icon') ||
    classes.includes('lucide') ||
    classes.includes('material-icons') ||
    dom.attributes['data-icon']
  ) {
    return 'icon';
  }

  // Divider
  if (tag === 'hr' || classes.includes('divider') || classes.includes('separator')) {
    return 'divider';
  }

  // Text
  if (
    tag === 'p' ||
    tag === 'span' ||
    tag === 'label' ||
    tag === 'h1' ||
    tag === 'h2' ||
    tag === 'h3' ||
    tag === 'h4' ||
    tag === 'h5' ||
    tag === 'h6' ||
    tag === 'small' ||
    tag === 'b' ||
    tag === 'strong'
  ) {
    // If it has children that are complex elements, it might be a container
    if (dom.children.length === 0 || (dom.children.length === 1 && dom.children[0].tag === 'span')) {
      return 'text';
    }
  }

  // Card
  if (
    classes.includes('card') ||
    classes.includes('surface') ||
    classes.includes('elevation') ||
    (dom.styles.borderRadius && dom.styles.backgroundColor) ||
    dom.classes.some((c) => c.startsWith('rounded-') && (c.includes('bg-') || dom.classes.includes('shadow')))
  ) {
    return 'card';
  }

  // Row vs Column vs Container
  const display = dom.styles.display || (classes.includes('flex') ? 'flex' : undefined);
  const flexDir = dom.styles.flexDirection || (classes.includes('flex-col') ? 'column' : classes.includes('flex-row') ? 'row' : undefined);

  if (flexDir === 'column') return 'column';
  if (flexDir === 'row') return 'row';
  if (display === 'flex') return 'row';

  if (dom.children.length > 0) {
    return 'container';
  }

  if (dom.textContent && dom.textContent.trim().length > 0) {
    return 'text';
  }

  return 'container';
}

/**
 * Recursively converts a parsed DOM tree into a DesignNode tree.
 */
function convertDomToNode(dom: ParsedDomNode, isRoot: boolean): DesignNode {
  const type = classifyNodeType(dom, isRoot);
  const id = dom.attributes['id'] || generateId(type);

  const layout = extractLayout(dom, type === 'row');
  const style = extractStyle(dom);

  const node: DesignNode = {
    id,
    type,
    tag: dom.tag,
    rawClasses: dom.classes.length > 0 ? dom.classes : undefined,
    rawStyles: Object.keys(dom.styles).length > 0 ? dom.styles : undefined,
  };

  // Text content
  if (dom.textContent && dom.textContent.trim().length > 0) {
    node.text = dom.textContent.trim();
  }

  // Image URL
  if (dom.attributes['src']) {
    node.imageUrl = dom.attributes['src'];
  }

  // Icon Name
  if (type === 'icon') {
    node.iconName =
      dom.attributes['data-icon'] ||
      dom.attributes['aria-label'] ||
      dom.classes.find((c) => c.startsWith('icon-') || c.startsWith('lucide-')) ||
      'icon';
  }

  // Accessibility label
  if (dom.attributes['aria-label'] || dom.attributes['alt'] || dom.attributes['title']) {
    node.accessibilityLabel =
      dom.attributes['aria-label'] || dom.attributes['alt'] || dom.attributes['title'];
  }

  if (Object.keys(layout).length > 0) {
    node.layout = layout;
  }
  if (Object.keys(style).length > 0) {
    node.style = style;
  }

  // Process children
  if (dom.children && dom.children.length > 0) {
    node.children = dom.children.map((c) => convertDomToNode(c, false));
  }

  return node;
}

/**
 * Calculates tree depth and total node count.
 */
function inspectTreeStats(root: DesignNode): { nodeCount: number; maxDepth: number } {
  let count = 0;
  let maxDepth = 0;

  const walk = (node: DesignNode, depth: number) => {
    count += 1;
    if (depth > maxDepth) maxDepth = depth;
    if (node.children) {
      for (const child of node.children) {
        walk(child, depth + 1);
      }
    }
  };

  walk(root, 1);
  return { nodeCount: count, maxDepth };
}

/**
 * Converts a parsed DOM tree into a complete DesignScreen with tokens.
 */
export function convertDomToDesignScreen(dom: ParsedDomNode, screenName = 'StitchScreen'): DesignScreen {
  nodeCounter = 0;
  const root = convertDomToNode(dom, true);
  root.type = 'screen';

  const tokens = extractDesignTokens(root);
  const stats = inspectTreeStats(root);

  return {
    id: `screen_${Date.now()}`,
    name: screenName,
    width: typeof root.layout?.width === 'number' ? root.layout.width : 360,
    height: typeof root.layout?.height === 'number' ? root.layout.height : 800,
    root,
    tokens,
    metadata: {
      source: 'google-stitch',
      nodeCount: stats.nodeCount,
      depth: stats.maxDepth,
      extractedAt: Date.now(),
    },
  };
}
