import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { normalizeMarkdownMath } from '../utils/formatting';

export function MarkdownContent(props: { text: string; className?: string }) {
  return (
    <div className={`markdown-content ${props.className ?? ''}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {normalizeMarkdownMath(props.text)}
      </ReactMarkdown>
    </div>
  );
}
