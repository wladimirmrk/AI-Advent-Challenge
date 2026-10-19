/**
 * Deterministic HTML Parser & Normalizer
 *
 * Parses raw HTML string from Google Stitch into a normalized DOM tree.
 * Works natively in both browser (DOMParser) and Node.js (pure TS parser fallback).
 */

export interface ParsedDomNode {
  tag: string;
  attributes: Record<string, string>;
  classes: string[];
  styles: Record<string, string>;
  textContent: string;
  children: ParsedDomNode[];
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * Parses inline CSS style string into a camelCase style object.
 * e.g. "background-color: #fff; padding-top: 12px;" -> { backgroundColor: "#fff", paddingTop: "12px" }
 */
export function parseInlineStyle(styleStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!styleStr || typeof styleStr !== 'string') return result;

  const declarations = styleStr.split(';');
  for (const decl of declarations) {
    const colonIndex = decl.indexOf(':');
    if (colonIndex <= 0) continue;
    const property = decl.slice(0, colonIndex).trim();
    const value = decl.slice(colonIndex + 1).trim();
    if (!property || !value) continue;

    // Convert kebab-case to camelCase
    const camel = property.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camel] = value;
  }
  return result;
}

/**
 * Normalizes CSS class list string into unique string array.
 */
export function parseClassList(classStr?: string): string[] {
  if (!classStr || typeof classStr !== 'string') return [];
  return classStr
    .split(/\s+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * Pure TypeScript HTML tokenizer and tree builder.
 * Works without window/DOM dependencies for Node CLI and unit tests.
 */
export function parseHtmlPure(html: string): ParsedDomNode {
  // Strip doctype and comments
  const cleanHtml = html
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();

  // Root virtual container
  const rootNode: ParsedDomNode = {
    tag: 'root',
    attributes: {},
    classes: [],
    styles: {},
    textContent: '',
    children: [],
  };

  const stack: ParsedDomNode[] = [rootNode];

  const tagRegex = /<(\/)?([a-zA-Z0-9:-]+)([^>]*)>|([^<]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(cleanHtml)) !== null) {
    const isClosing = Boolean(match[1]);
    const tagName = match[2]?.toLowerCase();
    const rawAttrs = match[3];
    const textSnippet = match[4];

    if (textSnippet) {
      const cleanText = textSnippet.replace(/\s+/g, ' ').trim();
      if (cleanText && stack.length > 0) {
        const current = stack[stack.length - 1];
        if (current.textContent) {
          current.textContent += ' ' + cleanText;
        } else {
          current.textContent = cleanText;
        }
      }
      continue;
    }

    if (!tagName) continue;

    // Skip script/style elements
    if (tagName === 'script' || tagName === 'style' || tagName === 'head') {
      if (!isClosing) {
        // Skip until closing tag
        const closingTag = `</${tagName}>`;
        const nextCloseIdx = cleanHtml.indexOf(closingTag, tagRegex.lastIndex);
        if (nextCloseIdx !== -1) {
          tagRegex.lastIndex = nextCloseIdx + closingTag.length;
        }
      }
      continue;
    }

    if (isClosing) {
      // Find matching tag in stack
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tagName) {
          stack.splice(i);
          break;
        }
      }
    } else {
      // Opening or self-closing tag
      const attributes: Record<string, string> = {};
      if (rawAttrs) {
        const attrRegex = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        let attrMatch: RegExpExecArray | null;
        while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
          const attrName = attrMatch[1].toLowerCase();
          const attrVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';
          attributes[attrName] = attrVal;
        }
      }

      const isSelfClosing =
        rawAttrs.endsWith('/') || VOID_TAGS.has(tagName);

      const classes = parseClassList(attributes['class'] || attributes['classname']);
      const styles = parseInlineStyle(attributes['style'] || '');

      const newNode: ParsedDomNode = {
        tag: tagName,
        attributes,
        classes,
        styles,
        textContent: '',
        children: [],
      };

      const parent = stack[stack.length - 1];
      parent.children.push(newNode);

      if (!isSelfClosing) {
        stack.push(newNode);
      }
    }
  }

  // If root has exactly 1 element child (e.g. <html> or <div class="screen">), return it
  if (rootNode.children.length === 1) {
    const singleChild = rootNode.children[0];
    if (singleChild.tag === 'html') {
      const body = singleChild.children.find((c) => c.tag === 'body');
      if (body) {
        return body.children.length === 1 ? body.children[0] : body;
      }
    }
    return singleChild;
  }

  return rootNode;
}

/**
 * Universal HTML parser that prefers native browser DOMParser when available,
 * and falls back to pure TS parser in Node / test environments.
 */
export function parseHtmlToDom(html: string): ParsedDomNode {
  if (typeof window !== 'undefined' && typeof window.DOMParser !== 'undefined') {
    try {
      const parser = new window.DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const convertElement = (el: Element): ParsedDomNode => {
        const attributes: Record<string, string> = {};
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          attributes[attr.name.toLowerCase()] = attr.value;
        }

        const classes = parseClassList(attributes['class'] || attributes['classname']);
        const styles = parseInlineStyle(attributes['style'] || '');

        // Direct text content
        let directText = '';
        el.childNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            directText += (node.textContent || '').trim() + ' ';
          }
        });

        const children: ParsedDomNode[] = [];
        for (let i = 0; i < el.children.length; i++) {
          children.push(convertElement(el.children[i]));
        }

        return {
          tag: el.tagName.toLowerCase(),
          attributes,
          classes,
          styles,
          textContent: directText.trim(),
          children,
        };
      };

      const body = doc.body;
      if (body) {
        if (body.children.length === 1) {
          return convertElement(body.children[0]);
        }
        return convertElement(body);
      }
    } catch {
      // Fallback to pure parser on any DOMParser error
    }
  }

  return parseHtmlPure(html);
}
