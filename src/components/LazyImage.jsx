import { useState, useRef, useEffect, useMemo } from 'react';

/**
 * LazyImage - Optimized image component with:
 * - Smart Auto-Healing: Caches successful URLs to avoid re-testing broken links
 * - IntersectionObserver-based lazy loading
 * - Multiple URL fallbacks
 * - Skeleton shimmer while loading
 */
const LazyImage = ({
    src,
    urls,
    alt = '',
    className = '',
    objectFit = 'cover',
    fallback = null,
    padding = false,
    rootMargin = '200px',
    priority = false, // If true, load instantly and set high priority
    asBackground = false, // If true, render as a background image on a div
}) => {
    const containerRef = useRef(null);

    // Stable dependencies to avoid infinite re-renders
    const urlsDep = urls?.join(',') || '';

    const { urlsToTry, primaryKey } = useMemo(() => {
        const baseUrls = urls?.length ? urls : (src ? [src] : []);
        const pKey = baseUrls[0] || 'empty';

        if (!baseUrls.length) return { urlsToTry: [], primaryKey: pKey };

        try {
            const cachedWorkingUrl = localStorage.getItem(`WorkingImg_${pKey}`);
            if (cachedWorkingUrl) {
                // If we have a cached working URL, put it first, then list the rest (removing duplicates)
                return {
                    urlsToTry: [cachedWorkingUrl, ...baseUrls.filter(u => u !== cachedWorkingUrl)],
                    primaryKey: pKey
                };
            }
        } catch (e) { /* ignore localStorage errors */ }

        return { urlsToTry: baseUrls, primaryKey: pKey };
    }, [urlsDep, src]);

    const [isInView, setIsInView] = useState(priority);
    const [urlIndex, setUrlIndex] = useState(0);
    const [loaded, setLoaded] = useState(false);
    const [prevUrls, setPrevUrls] = useState(urlsToTry);

    // Reset state if underlying URLs change
    if (prevUrls !== urlsToTry) {
        setPrevUrls(urlsToTry);
        setUrlIndex(0);
        setLoaded(false);
    }

    const currentSrc = urlsToTry[urlIndex];
    const allFailed = urlIndex >= urlsToTry.length;
    const showFallback = urlsToTry.length === 0 || allFailed;

    // IntersectionObserver — start loading when card is near viewport
    useEffect(() => {
        // If priority is true, we don't need the observer
        if (priority) return;

        const node = containerRef.current;
        if (!node) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsInView(true);
                    observer.disconnect(); // only need to trigger once
                }
            },
            { rootMargin }
        );

        observer.observe(node);
        return () => observer.disconnect();
    }, [rootMargin, priority]);

    const handleError = () => {
        // Log only once per image (when first URL fails)
        if (urlIndex === 0) {
            console.warn(`⚠️ Image unavailable [${alt || 'Unknown'}]:`, currentSrc);
        }

        // If this URL was previously cached as "working", evict it
        try {
            const cachedUrl = localStorage.getItem(`WorkingImg_${primaryKey}`);
            if (cachedUrl === currentSrc) {
                console.log(`🧹 Evicting stale cache for [${alt || 'Unknown'}]`);
                localStorage.removeItem(`WorkingImg_${primaryKey}`);
            }
        } catch (_e) { /* ignore localStorage errors */ }

        if (urlIndex + 1 < urlsToTry.length) {
            setUrlIndex(i => i + 1);
            setLoaded(false);
        } else {
            // Downgrade to warn — this is a gracefully handled UX state (fallback UI shown)
            if (urlsToTry.length > 1) {
                console.warn(`⚠️ All ${urlsToTry.length} image sources failed for [${alt || 'Unknown'}] — showing fallback`);
            }
            setUrlIndex(urlsToTry.length); // triggers allFailed
        }
    };

    const handleSuccess = () => {
        setLoaded(true);
        // Save to cache so we don't have to fallback sequentially next time!
        try {
            localStorage.setItem(`WorkingImg_${primaryKey}`, currentSrc);
            if (urlIndex > 0) {
                console.log(`✅ Image Auto-Healed [${alt || 'Unknown'}]! Successfully loaded on fallback #${urlIndex + 1}:`, currentSrc);
            }
        } catch (_e) { /* ignore localStorage errors */ }
    };

    return (
        <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
            {/* Skeleton shimmer — visible while image hasn't loaded */}
            {!loaded && !showFallback && (
                <div
                    className="absolute inset-0"
                    style={{
                        background: 'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%)',
                        backgroundSize: '200% 100%',
                        animation: 'shimmer 1.5s infinite',
                    }}
                />
            )}

            {/* Image — only mount once in viewport, no loading="lazy" to avoid browser intervention */}
            {isInView && !showFallback && (
                <>
                    {asBackground ? (
                        <div
                            key={currentSrc}
                            style={{
                                backgroundImage: `url("${currentSrc}")`,
                                backgroundSize: objectFit === 'contain' ? 'contain' : 'cover',
                                backgroundPosition: 'center',
                                backgroundRepeat: 'no-repeat',
                                transition: 'opacity 0.2s ease',
                            }}
                            className={`w-full h-full ${loaded ? 'opacity-100' : 'opacity-0'}`}
                        >
                            {/* Hidden image to trigger load/error events for background mode */}
                            <img
                                src={currentSrc}
                                alt=""
                                className="hidden"
                                onLoad={handleSuccess}
                                onError={handleError}
                            />
                        </div>
                    ) : (
                        <img
                            key={currentSrc}        /* remount on URL change */
                            src={currentSrc}
                            alt={alt}
                            decoding="async"
                            fetchPriority={priority ? "high" : "auto"}
                            onLoad={handleSuccess}
                            onError={handleError}
                            style={{ transition: 'opacity 0.2s ease' }} // Faster fade-in for less layout shift delay
                            className={[
                                'w-full h-full',
                                loaded ? 'opacity-100' : 'opacity-0',
                                objectFit === 'contain' ? 'object-contain' : 'object-cover',
                                padding ? 'p-8' : '',
                            ].join(' ')}
                        />
                    )}
                </>
            )}

            {/* Fallback slot */}
            {showFallback && (
                <div className="w-full h-full flex items-center justify-center">
                    {fallback}
                </div>
            )}
        </div>
    );
};

export default LazyImage;
