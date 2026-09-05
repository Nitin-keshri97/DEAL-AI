import { useEffect, useState } from 'react';
import { Search, SlidersHorizontal, Loader2, ArrowLeft, Filter } from 'lucide-react';
import { searchProducts, getCategories } from '../lib/api';
import ProductCard from './ProductCard';
import { useUI } from '../context/UIContext';

export default function SearchPage() {
  const { viewParam, goShop, searchFor } = useUI();
  const initialQuery = viewParam?.q || '';

  const [query, setQuery] = useState(initialQuery);
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState([]);

  // Filters state
  const [category, setCategory] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minRating, setMinRating] = useState('');
  const [sort, setSort] = useState('relevance');
  const [page, setPage] = useState(1);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // Load the REAL category list from the backend so the dropdown never offers a
  // category that has no products (the old hardcoded list had "Mobiles"/"Laptops"
  // which don't exist in the DB and always returned zero results).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cats = await getCategories();
        if (!cancelled) setCategories(cats || []);
      } catch (err) {
        console.error('Failed to load categories:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (viewParam?.q !== undefined) {
      setQuery(viewParam.q);
    }
  }, [viewParam]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await searchProducts({
          q: query,
          category,
          minPrice: minPrice || undefined,
          maxPrice: maxPrice || undefined,
          rating: minRating || undefined,
          sort,
          page,
          limit: 20,
        });
        if (!cancelled) {
          setProducts(res.products || []);
          setPagination(res.pagination || { page: 1, total: 0, totalPages: 1 });
        }
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [query, category, minPrice, maxPrice, minRating, sort, page]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    searchFor(query);
  };

  const clearFilters = () => {
    setCategory('');
    setMinPrice('');
    setMaxPrice('');
    setMinRating('');
    setSort('relevance');
    setPage(1);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 min-h-[70vh]">
      {/* Back button & Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <button
            onClick={goShop}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Store
          </button>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            {query ? `Search Results for "${query}"` : 'Product Search'}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Found {pagination.total} product{pagination.total !== 1 ? 's' : ''} in backend database
          </p>
        </div>

        {/* Search input in page */}
        <form onSubmit={handleSearchSubmit} className="flex gap-2 max-w-md w-full">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, brand, tag..."
              className="w-full h-10 pl-9 pr-4 rounded-xl bg-white border border-slate-300 text-sm focus:border-indigo-600 focus:outline-none"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
          </div>
          <button type="submit" className="btn-accent h-10 px-4 text-xs font-bold">
            Search
          </button>
        </form>
      </div>

      {/* Main Layout: Filters + Products */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Mobile Filter Toggle */}
        <div className="lg:hidden flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200">
          <button
            onClick={() => setShowMobileFilters((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold text-slate-700"
          >
            <Filter className="w-4 h-4 text-indigo-600" /> Filters &amp; Sorting
          </button>
          {(category || minPrice || maxPrice || minRating) && (
            <button onClick={clearFilters} className="text-xs text-indigo-600 font-bold">
              Reset Filters
            </button>
          )}
        </div>

        {/* Sidebar Filters */}
        <aside className={`lg:block ${showMobileFilters ? 'block' : 'hidden'} bg-white p-5 rounded-2xl border border-slate-200 h-fit space-y-6`}>
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-indigo-600" /> Filter &amp; Sort
            </h3>
            {(category || minPrice || maxPrice || minRating) && (
              <button onClick={clearFilters} className="text-xs text-indigo-600 hover:underline font-semibold">
                Clear all
              </button>
            )}
          </div>

          {/* Sort By */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Sort By</label>
            <select
              value={sort}
              onChange={(e) => { setSort(e.target.value); setPage(1); }}
              className="w-full h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
            >
              <option value="relevance">Relevance</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="rating">Highest Rated</option>
              <option value="newest">Newest First</option>
            </select>
          </div>

          {/* Category Filter */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Category</label>
            <select
              value={category}
              onChange={(e) => { setCategory(e.target.value); setPage(1); }}
              className="w-full h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}{typeof c.count === 'number' ? ` (${c.count})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Price Range */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Price Range (₹)</label>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Min"
                value={minPrice}
                onChange={(e) => { setMinPrice(e.target.value); setPage(1); }}
                className="w-1/2 h-9 px-3 rounded-lg border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:border-indigo-500"
              />
              <input
                type="number"
                placeholder="Max"
                value={maxPrice}
                onChange={(e) => { setMaxPrice(e.target.value); setPage(1); }}
                className="w-1/2 h-9 px-3 rounded-lg border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Rating */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Minimum Rating</label>
            <div className="flex flex-col gap-1.5">
              {[4.5, 4.0, 3.5].map((r) => (
                <label key={r} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    name="minRating"
                    checked={Number(minRating) === r}
                    onChange={() => { setMinRating(r); setPage(1); }}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>{r}★ &amp; above</span>
                </label>
              ))}
            </div>
          </div>
        </aside>

        {/* Product Grid & Pagination */}
        <main className="lg:col-span-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin mb-2 text-indigo-600" />
              <p className="text-sm font-medium">Searching database…</p>
            </div>
          ) : products.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
              <div className="text-4xl mb-3">🔍</div>
              <h3 className="text-lg font-bold text-slate-900">No matching products found</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Try adjusting your search terms or clearing your filter selections.
              </p>
              <button onClick={clearFilters} className="btn-outline mt-4 text-xs">
                Clear Filters
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 md:gap-5">
                {products.map((product) => (
                  <ProductCard key={product.sku ?? product.id} product={product} />
                ))}
              </div>

              {/* Pagination */}
              {pagination.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-10">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="btn-outline text-xs px-3 py-1.5 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="text-xs font-semibold text-slate-600 px-2">
                    Page {page} of {pagination.totalPages}
                  </span>
                  <button
                    disabled={page >= pagination.totalPages}
                    onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                    className="btn-outline text-xs px-3 py-1.5 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
