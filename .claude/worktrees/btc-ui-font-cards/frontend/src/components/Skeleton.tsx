export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-dark-bg-hover rounded ${className}`} />
  )
}

export function SkeletonCard() {
  return (
    <div className="card p-5 space-y-3">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  )
}
