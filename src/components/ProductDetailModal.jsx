import { useEffect, useState } from 'react';
import { X, Star, Check, ShoppingCart, Bot, Heart, Truck, RotateCcw, Award } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';
import { useUI } from '../context/UIContext';
import { getProductDetails, getProductReviews, getRelatedProducts } from '../lib/api';

const inr = (n) => Number(n || 0).toLocaleString('en-IN');
const MAX_QTY = 10;

function Stars({ rating }) {
  if (typeof rating !== 'number') return null;
  return (
    <div className="flex items-center gap-1" aria-label={`Rating: ${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className="w-4 h-4"
          fill={s <= Math.round(rating) ? '#f59e0b' : 'none'}
          stroke={s <= Math.round(rating) ? '#f59e0b' : '#d1d5db'}
        />
      ))}
      <span className="text-sm text-slate-600 ml-1 font-semibold">{rating}</span>
    </div>
  );
}

export default function ProductDetailModal() {
  const { detailId, closeProductDetail, openAgent } = useUI();
  const { addToCart } = useCart();
  const { toggleWishlist, isInWishlist } = useWishlist();

  const [product, setProduct] = useState(null);
  const [reviewsData, setReviewsData] = useState(null);
  const [related, setRelated] = useState([]);
  const [selectedImg, setSelectedImg] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedSize, setSelectedSize] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState('');

  const isOpen = detailId !== null;

  useEffect(() => {
    if (!detailId) {
      setProduct(null);
      setReviewsData(null);
      setRelated([]);
      setError('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');

    (async () => {
      try {
        const [p, r, rel] = await Promise.all([
          getProductDetails(detailId),
          getProductReviews(detailId).catch(() => null),
          getRelatedProducts(detailId).catch(() => []),
        ]);

        if (cancelled) return;
        setProduct(p);
        setReviewsData(r);
        setRelated(rel);
        setSelectedImg(p?.image || '');
        if (p?.colors?.length) setSelectedColor(p.colors[0]);
        if (p?.sizes?.length) setSelectedSize(p.sizes[0]);
        setQuantity(1);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load product details.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [detailId]);

  if (!isOpen) return null;

  const isWished = product ? isInWishlist(product.sku) : false;

  const handleAddToCart = () => {
    if (!product) return;
    addToCart({
      id: product.sku,
      name: product.name,
      price: product.price,
      originalPrice: product.originalPrice ?? product.price,
      image: product.image,
      category: product.category,
      color: selectedColor,
      size: selectedSize,
    }, quantity);

    setAdded(true);
    setTimeout(() => setAdded(false), 1600);
  };

  const handleAskAIAboutProduct = () => {
    if (!product) return;
    closeProductDetail();
    openAgent(`Tell me about ${product.name} (₹${product.price}). Is it worth buying?`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs modal-overlay overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-8 modal-content">
        {/* Close Button */}
        <button
          onClick={closeProductDetail}
          className="absolute top-4 right-4 z-20 w-9 h-9 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {loading ? (
          <div className="p-16 text-center text-slate-400">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm font-semibold">Loading product details…</p>
          </div>
        ) : error || !product ? (
          <div className="p-12 text-center">
            <p className="text-sm text-rose-600 font-bold mb-4">{error || 'Product not found.'}</p>
            <button onClick={closeProductDetail} className="btn-outline text-xs">
              Close Window
            </button>
          </div>
        ) : (
          <div className="p-6 sm:p-8 max-h-[85vh] overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Left Column: Image Gallery */}
              <div className="space-y-4">
                <div className="aspect-square rounded-2xl bg-slate-50 border border-slate-200 overflow-hidden relative group">
                  <img
                    src={selectedImg || product.image}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => toggleWishlist(product.sku)}
                    className={`absolute top-3 right-3 z-10 w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                      isWished ? 'bg-rose-50 text-rose-600' : 'bg-white/80 text-slate-400 hover:text-rose-500'
                    }`}
                  >
                    <Heart className={`w-5 h-5 ${isWished ? 'fill-rose-500' : ''}`} />
                  </button>
                </div>

                {/* Thumbnails */}
                {Array.isArray(product.images) && product.images.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {product.images.map((img, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedImg(img)}
                        className={`w-16 h-16 rounded-xl border-2 overflow-hidden shrink-0 transition-all ${
                          selectedImg === img ? 'border-indigo-600 scale-95' : 'border-slate-200 opacity-70 hover:opacity-100'
                        }`}
                      >
                        <img src={img} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Right Column: Product Details */}
              <div className="space-y-5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                      {product.subcategory || product.category}
                    </span>
                    {product.brand && (
                      <span className="text-xs font-semibold text-slate-400">· {product.brand}</span>
                    )}
                  </div>
                  <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">{product.name}</h1>

                  {/* Rating */}
                  <div className="flex items-center gap-2 mt-2">
                    <Stars rating={product.rating} />
                    {typeof product.reviewCount === 'number' && (
                      <span className="text-xs text-slate-400 font-medium">
                        ({product.reviewCount} customer reviews)
                      </span>
                    )}
                  </div>
                </div>

                {/* Price */}
                <div className="flex items-baseline gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                  <span className="text-2xl font-extrabold text-slate-900">₹{inr(product.price)}</span>
                  {product.originalPrice && product.originalPrice > product.price && (
                    <>
                      <span className="text-base text-slate-400 line-through">₹{inr(product.originalPrice)}</span>
                      <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                        Save ₹{inr(product.originalPrice - product.price)} (
                        {Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}% OFF)
                      </span>
                    </>
                  )}
                </div>

                {/* Color Selector */}
                {Array.isArray(product.colors) && product.colors.length > 0 && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                      Color: <span className="text-indigo-600">{selectedColor}</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {product.colors.map((c) => (
                        <button
                          key={c}
                          onClick={() => setSelectedColor(c)}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                            selectedColor === c
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                          }`}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Size Selector */}
                {Array.isArray(product.sizes) && product.sizes.length > 0 && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                      Size: <span className="text-indigo-600">{selectedSize}</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {product.sizes.map((s) => (
                        <button
                          key={s}
                          onClick={() => setSelectedSize(s)}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                            selectedSize === s
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quantity + Actions */}
                <div className="flex items-center gap-3 pt-2">
                  <div className="flex items-center border border-slate-300 rounded-xl overflow-hidden h-11 bg-slate-50">
                    <button
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      className="px-3 text-slate-600 hover:bg-slate-200 text-sm font-bold"
                    >
                      −
                    </button>
                    <span className="px-3 text-sm font-bold text-slate-900">{quantity}</span>
                    <button
                      onClick={() => setQuantity((q) => Math.min(MAX_QTY, q + 1))}
                      className="px-3 text-slate-600 hover:bg-slate-200 text-sm font-bold"
                    >
                      +
                    </button>
                  </div>

                  <button
                    onClick={handleAddToCart}
                    className={`flex-1 h-11 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${
                      added
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-900 text-white hover:bg-slate-800 shadow-xs'
                    }`}
                  >
                    {added ? <Check className="w-4 h-4" /> : <ShoppingCart className="w-4 h-4" />}
                    {added ? 'Added to Cart' : 'Add to Cart'}
                  </button>
                </div>

                {/* Ask AI about this product */}
                <button
                  onClick={handleAskAIAboutProduct}
                  className="w-full py-2.5 px-4 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  <Bot className="w-4 h-4" /> Ask DealAI about this product
                </button>

                {/* Trust Badges */}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-[11px] text-slate-600">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Truck className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>{product.delivery || 'Fast Delivery'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 font-medium">
                    <Award className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{product.warranty || 'Verified Quality'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 font-medium">
                    <RotateCcw className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>{product.returnPolicy || '7-Day Return'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Description & Features */}
            <div className="mt-8 pt-8 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider mb-2">Description</h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{product.description}</p>

                {Array.isArray(product.features) && product.features.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-xs font-bold text-slate-800 uppercase mb-2">Key Features</h4>
                    <ul className="space-y-1.5 text-xs text-slate-600">
                      {product.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Specifications */}
              {product.specifications && Object.keys(product.specifications).length > 0 && (
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider mb-2">Specifications</h3>
                  <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-200 text-xs">
                    {Object.entries(product.specifications).map(([k, v]) => (
                      <div key={k} className="flex px-3.5 py-2">
                        <span className="font-semibold text-slate-500 w-1/3 shrink-0">{k}</span>
                        <span className="text-slate-900 font-medium">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Related Products */}
            {related.length > 0 && (
              <div className="mt-8 pt-8 border-t border-slate-200">
                <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider mb-4">Related Products</h3>
                <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
                  {related.map((rel) => (
                    <button
                      key={rel.sku}
                      onClick={() => openProductDetail(rel.sku)}
                      className="w-36 shrink-0 text-left bg-slate-50 p-2.5 rounded-xl border border-slate-200 hover:border-indigo-500 transition-all"
                    >
                      <img src={rel.image} alt={rel.name} className="w-full aspect-square object-cover rounded-lg mb-2" />
                      <p className="text-xs font-bold text-slate-900 truncate">{rel.name}</p>
                      <p className="text-xs font-extrabold text-indigo-600 mt-0.5">₹{inr(rel.price)}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
