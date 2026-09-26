import {
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
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

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [scrollWidth, setScrollWidth] = useState(0);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const measure = useCallback(() => {
    const pre = preRef.current;
    if (!pre) return;
    const overflow = pre.scrollWidth > pre.clientWidth + 1;
    setHasOverflow(overflow);
    if (overflow) setScrollWidth(pre.scrollWidth);
  }, []);

  useEffect(() => {
    measure();
    const pre = preRef.current;
    if (!pre || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(pre);
    return () => observer.disconnect();
  }, [measure]);

  const syncBarFromPre = () => {
    if (preRef.current && barRef.current) {
      barRef.current.scrollLeft = preRef.current.scrollLeft;
    }
  };

  const syncPreFromBar = () => {
    if (preRef.current && barRef.current) {
      preRef.current.scrollLeft = barRef.current.scrollLeft;
    }
  };

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
    <div className="md-codeblock">
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
      {hasOverflow && (
        <div
          className="md-codeblock-scrollbar"
          ref={barRef}
          onScroll={syncPreFromBar}
        >
          <div className="md-codeblock-scrollbar-filler" style={{ width: scrollWidth }} />
        </div>
      )}
      <pre ref={preRef} onScroll={syncBarFromPre}>
        {children}
      </pre>
    </div>
  );
}

const markdownComponents: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
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
