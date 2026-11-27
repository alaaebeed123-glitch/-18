let readingPrefetched = false;

export function prefetchReadingProgram(): void {
  if (readingPrefetched || typeof document === 'undefined') return;
  readingPrefetched = true;
  const assets: Array<{ href: string; as?: string }> = [
    { href: '/reading-tailwind.css', as: 'style' },
    { href: '/noor-bayan-data.js', as: 'script' },
    { href: '/reading-program.html', as: 'document' },
  ];
  for (const asset of assets) {
    if (!document.head.querySelector(`link[rel="prefetch"][href="${asset.href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = asset.href;
      if (asset.as) link.as = asset.as;
      document.head.appendChild(link);
    }
  }
}
