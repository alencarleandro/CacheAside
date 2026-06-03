function CacheAsideMark({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="Cache Aside">
      <path className="cache-layer cache-layer-back" d="M8 21 32 9l24 12-24 12L8 21Z" />
      <path className="cache-layer cache-layer-mid" d="M8 32 32 20l24 12-24 12L8 32Z" />
      <path className="cache-layer cache-layer-front" d="M8 43 32 31l24 12-24 12L8 43Z" />
    </svg>
  );
}

export default CacheAsideMark;
