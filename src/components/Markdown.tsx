import {
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';

function nodeToString(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeToString).join('');
  if (isValidElement(node)) {
    return nodeToString((node.props as { children?: ReactNode }).children);
  }
  return '';
}

/**
 * Proxy horizontal scrollbar pinned to the visible bottom edge of a tall
 * overflowing block. Syncs scrollLeft with the target in both directions and
 * renders only while the target actually overflows horizontally. The sticky
 * binding must escape to the chat scroller, so the block wrapper must not
 * create a scroll container (overflow: clip, never hidden).
 */
function ScrollXBar({
  containerRef,
  selector,
}: {
  containerRef: RefObject<HTMLElement | null>;
  selector: string;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [scrollWidth, setScrollWidth] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const target = container?.querySelector(selector);
    if (!(target instanceof HTMLElement)) return;

    const measure = () => {
      setOverflowing(target.scrollWidth > target.clientWidth + 1);
      setScrollWidth(target.scrollWidth);
    };

    const syncBar = () => {
      const bar = barRef.current;
      if (bar && bar.scrollLeft !== target.scrollLeft) {
        bar.scrollLeft = target.scrollLeft;
      }
    };

    measure();
    target.addEventListener('scroll', syncBar, { passive: true });

    const observer = new ResizeObserver(measure);
    observer.observe(target);
    if (target.firstElementChild) observer.observe(target.firstElementChild);

    return () => {
      target.removeEventListener('scroll', syncBar);
      observer.disconnect();
    };
  }, [containerRef, selector]);

  useEffect(() => {
    if (!overflowing) return;
    const container = containerRef.current;
    const target = container?.querySelector(selector);
    const bar = barRef.current;
    if (!(target instanceof HTMLElement) || !bar) return;

    if (bar.scrollLeft !== target.scrollLeft) {
      bar.scrollLeft = target.scrollLeft;
    }
    const syncTarget = () => {
      if (target.scrollLeft !== bar.scrollLeft) {
        target.scrollLeft = bar.scrollLeft;
      }
    };
    bar.addEventListener('scroll', syncTarget, { passive: true });
    return () => bar.removeEventListener('scroll', syncTarget);
  }, [overflowing, containerRef, selector]);

  if (!overflowing) return null;

  return (
    <div className="md-scrollx-bar" ref={barRef}>
      <div className="md-scrollx-bar-spacer" style={{ width: scrollWidth }} />
    </div>
  );
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  let language = '';
  let code = '';
  const first = Array.isArray(children) ? children[0] : children;
  if (isValidElement(first)) {
    const props = first.props as { className?: string; children?: ReactNode };
    const match = /language-([\w+#.-]+)/.exec(props.className ?? '');
    if (match) language = match[1];
    code = nodeToString(props.children);
  }

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — keep silent */
    }
  }, [code]);

  return (
    <div className="md-codeblock" ref={containerRef}>
      <div className="md-codeblock-header">
        <span className="md-codeblock-lang">{language || 'text'}</span>
        <button
          type="button"
          className={`md-codeblock-copy${copied ? ' copied' : ''}`}
          onClick={handleCopy}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{children}</pre>
      <ScrollXBar containerRef={containerRef} selector="pre" />
    </div>
  );
}

function TableBlock({ children }: { children?: ReactNode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  return (
    <div className="md-table-scrollx" ref={containerRef}>
      <table>{children}</table>
      <ScrollXBar containerRef={containerRef} selector="table" />
    </div>
  );
}

const markdownComponents: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => <TableBlock>{children}</TableBlock>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

interface MarkdownProps {
  content: string;
}

function Markdown({ content }: MarkdownProps) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
