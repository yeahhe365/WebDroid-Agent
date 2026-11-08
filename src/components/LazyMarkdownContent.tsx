import { memo, Suspense } from 'react'
import { lazyWithRetry } from '../lib/lazyWithRetry'

export type LazyMarkdownContentProps = {
  className?: string
  content: string
}

const LazyLoadedMarkdownContent = lazyWithRetry(() =>
  import('./MarkdownContent').then((module) => ({ default: module.MarkdownContent })),
)

export const LazyMarkdownContent = memo(function LazyMarkdownContent({
  className,
  content,
}: LazyMarkdownContentProps) {
  return (
    <Suspense fallback={<PlainTextContent className={className} content={content} />}>
      <LazyLoadedMarkdownContent className={className} content={content} />
    </Suspense>
  )
})

function PlainTextContent({ className, content }: LazyMarkdownContentProps) {
  return (
    <div className={['markdown-content', className].filter(Boolean).join(' ')}>
      <p>{content}</p>
    </div>
  )
}
