import { useEffect, useState } from 'react';
import { searchProducts } from '../lib/api';
import ProductCard from './ProductCard';
import { useUI } from '../context/UIContext';
import { Loader2, ArrowLeft, SlidersHorizontal } from 'lucide-react';

export default function CategoryPage() {
  const { viewParam, activeCategory, activeSubcategory, goShop, selectCategory } = useUI();
  
  const currentCategory = viewParam?.category || activeCategory || 'Electronics';
  const currentSubcategory = viewParam?.subcategory || activeSubcategory || null;

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSub, setSelectedSub] = useState(currentSubcategory);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await searchProducts({
          category: currentCategory,
          subcategory: selectedSub || undefined,
          limit: 30,
        });
        if (!cancelled) setProducts(res.products || []);
      } catch (err) {
        console.error('Failed to load category products:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentCategory, selectedSub]);

  // Extract unique subcategories from loaded items
  const subcategories = [...new Set(products.map((p) => p.subcategory).filter(Boolean))];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 min-h-[70vh]">
      {/* Navigation & Header */}
      <button
        onClick={goShop}
        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Store
      </button>

      <div className="bg-gradient-to-r from-slate-900 to-indigo-950 rounded-2xl p-6 sm:p-8 text-white mb-8 shadow-md">
        <span className="text-xs font-extrabold uppercase tracking-wider text-indigo-400">Category Browse</span>
        <h1 className="text-2xl sm:text-4xl font-extrabold text-white mt-1">{currentCategory}</h1>
        <p className="text-xs sm:text-sm text-slate-300 mt-1">
          Explore genuine items from verified brands in {currentCategory}.
        </p>
      </div>

      {/* Subcategory Filter Chips */}
      {subcategories.length > 0 && (
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2 no-scrollbar">
          <SlidersHorizontal className="w-4 h-4 text-slate-400 shrink-0" />
          <button
            onClick={() => setSelectedSub(null)}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
              !selectedSub
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            All {currentCategory}
          </button>

          {subcategories.map((sub) => (
            <button
              key={sub}
              onClick={() => setSelectedSub(sub === selectedSub ? null : sub)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                selectedSub === sub
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600'
              }`}
            >
              {sub}
            </button>
          ))}
        </div>
      )}

      {/* Products Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin mb-2 text-indigo-600" />
          <p className="text-sm font-medium">Loading {currentCategory} catalogue…</p>
        </div>
      ) : products.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <p className="text-base font-bold text-slate-800">No products available in this section</p>
          <p className="text-xs text-slate-500 mt-1">Check back soon for new arrivals.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
          {products.map((product) => (
            <ProductCard key={product.sku ?? product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
