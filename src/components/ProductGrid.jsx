import { useEffect, useState } from 'react';
import { Loader2, Sparkles, TrendingUp, Award, Clock } from 'lucide-react';
import { getProducts } from '../lib/api';
import ProductCard from './ProductCard';

const TABS = [
  { key: 'foryou', label: 'For You', icon: Sparkles },
  { key: 'best', label: 'Best Deals', icon: TrendingUp },
  { key: 'new', label: 'New Arrivals', icon: Clock },
  { key: 'top', label: 'Top Rated', icon: Award },
];

const discountRatio = (p) =>
  p.originalPrice && p.originalPrice > p.price ? (p.originalPrice - p.price) / p.originalPrice : 0;

// ─────────────────────────────────────────────────────────────────────────
// Deals for You — the shopping feed. Tabs are just different orderings/filters
// over the SAME real catalogue from the backend (getProducts). Nothing here is
// fabricated: "New Arrivals" sorts by real sku/id, "Top Rated" by real rating.
// ─────────────────────────────────────────────────────────────────────────

export default function ProductGrid() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('foryou');

  useEffect(() => {
    let unmounted = false;
    (async () => {
      try {
        const list = await getProducts();
        if (!unmounted) setProducts(list || []);
      } catch (err) {
        console.error('Failed to load catalogue:', err);
      } finally {
        if (!unmounted) setLoading(false);
      }
    })();
    return () => {
      unmounted = true;
    };
  }, []);

  const best = [...products]
    .filter((p) => discountRatio(p) >= 0.15 || p.isFeatured)
    .sort((a, b) => discountRatio(b) - discountRatio(a));
  const newArrivals = [...products].sort(
    (a, b) => Number(b.sku ?? b.id ?? 0) - Number(a.sku ?? a.id ?? 0)
  );
  const topRated = [...products]
    .filter((p) => p.rating >= 4.6)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0));

  const displayed =
    activeTab === 'best' ? best : activeTab === 'new' ? newArrivals : activeTab === 'top' ? topRated : products;

  return (
    <section id="deals" className="px-4 sm:px-6 lg:px-8 py-12 scroll-mt-20">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-ink">Deals for You</h2>
            <p className="mt-1 text-sm text-muted">
              Handpicked from live prices — add to cart, then let AI negotiate.
            </p>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 bg-mist p-1 rounded-full shrink-0 overflow-x-auto no-scrollbar">
            {TABS.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                    active ? 'bg-paper text-ink shadow-sm' : 'text-muted hover:text-ink'
                  }`}
                >
                  <tab.icon className={`w-3.5 h-3.5 ${active ? 'text-accent' : ''}`} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-faint">
            <Loader2 className="w-7 h-7 animate-spin mb-3 text-accent" />
            <p className="text-sm font-medium">Loading live catalogue…</p>
          </div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-16 bg-paper rounded-2xl border border-line p-8">
            <p className="text-base font-semibold text-ink">No products here yet</p>
            <p className="text-xs text-muted mt-1">Try another tab.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5 sm:gap-5">
            {displayed.map((product) => (
              <ProductCard key={product.sku ?? product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
