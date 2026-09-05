import { useState } from 'react';
import { ShoppingCart, Check, Star, Eye, Heart, Sparkles } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';
import { useUI } from '../context/UIContext';

const inr = (n) => Number(n).toLocaleString('en-IN');

function StarRating({ rating }) {
  if (typeof rating !== 'number') return null;
  return (
    <div className="flex items-center gap-1" aria-label={`Rating: ${rating} out of 5`}>
      <Star className="w-3.5 h-3.5 fill-amber-400 stroke-amber-400" />
      <span className="text-xs font-semibold text-ink-soft">{rating}</span>
    </div>
  );
}

export default function ProductCard({ product }) {
  const { addToCart, cartItems } = useCart();
  const { toggleWishlist, isInWishlist } = useWishlist();
  const { openProductDetail } = useUI();
  const [justAdded, setJustAdded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const sku = Number(product.sku ?? product.id);
  const inCart = cartItems.some((item) => Number(item.id) === sku);
  const isWished = isInWishlist(sku);

  const hasDeal = product.originalPrice && product.originalPrice > product.price;
  const discount = hasDeal
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : 0;
  // "AI Saved" is the REAL delta between the listed original and current price.
  const saved = hasDeal ? product.originalPrice - product.price : 0;

  function handleAdd(e) {
    e.stopPropagation();
    addToCart({
      id: sku,
      name: product.name,
      price: product.price,
      originalPrice: product.originalPrice ?? product.price,
      image: product.image,
      category: product.category,
    });
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1600);
  }

  function handleWish(e) {
    e.stopPropagation();
    toggleWishlist(sku);
  }

  return (
    <article className="product-card bg-paper rounded-2xl border border-line overflow-hidden flex flex-col relative group">
      {/* Wishlist */}
      <button
        type="button"
        onClick={handleWish}
        aria-label={isWished ? 'Remove from wishlist' : 'Add to wishlist'}
        className={`absolute top-2.5 right-2.5 z-10 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
          isWished
            ? 'bg-rose-50 text-rose-600 shadow-sm'
            : 'bg-paper/80 text-faint hover:text-rose-500 hover:bg-paper backdrop-blur-sm'
        }`}
      >
        <Heart className={`w-4 h-4 ${isWished ? 'fill-rose-500' : ''}`} />
      </button>

      {/* Discount badge */}
      {discount > 0 && (
        <span className="absolute top-2.5 left-2.5 z-10 bg-ink text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
          {discount}% OFF
        </span>
      )}

      {/* Image */}
      <button
        type="button"
        onClick={() => openProductDetail(sku)}
        aria-label={`View details for ${product.name}`}
        className="relative overflow-hidden bg-canvas aspect-square w-full"
      >
        {imgError ? (
          <div className="w-full h-full flex items-center justify-center text-faint text-4xl select-none">
            🛍️
          </div>
        ) : (
          <img
            src={product.image}
            alt={product.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        )}
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 py-2 bg-ink/60 text-white text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
          <Eye className="w-3.5 h-3.5" /> Quick View
        </span>
      </button>

      {/* Content */}
      <div className="flex flex-col flex-1 p-3.5 gap-2">
        <div className="flex items-center justify-between gap-1 text-[11px]">
          <span className="font-semibold uppercase tracking-wider text-faint truncate">
            {product.subcategory || product.category}
          </span>
          {product.brand && (
            <span className="font-medium text-faint truncate max-w-[50%]">{product.brand}</span>
          )}
        </div>

        <h3 className="text-sm font-semibold text-ink line-clamp-2 leading-snug">
          <button
            type="button"
            onClick={() => openProductDetail(sku)}
            className="text-left hover:text-accent transition-colors"
          >
            {product.name}
          </button>
        </h3>

        <div className="flex items-center gap-2 mt-0.5">
          <StarRating rating={product.rating} />
          {typeof product.reviewCount === 'number' && product.reviewCount > 0 && (
            <span className="text-xs text-faint">({product.reviewCount})</span>
          )}
        </div>

        {/* Pricing */}
        <div className="flex items-baseline gap-2 mt-auto pt-1">
          <span className="text-base font-extrabold text-ink">₹{inr(product.price)}</span>
          {hasDeal && <span className="text-xs text-faint line-through">₹{inr(product.originalPrice)}</span>}
        </div>

        {/* Real AI savings */}
        {saved > 0 && (
          <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent">
            <Sparkles className="w-3 h-3" />
            AI Saved ₹{inr(saved)}
          </div>
        )}

        {/* Add to cart */}
        <button
          onClick={handleAdd}
          aria-label={`Add ${product.name} to cart`}
          className={`mt-1.5 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
            justAdded
              ? 'bg-accent text-white'
              : inCart
              ? 'bg-accent-soft text-accent-ink hover:bg-accent-soft/70 border border-accent/20'
              : 'bg-ink text-white hover:bg-ink-soft'
          }`}
        >
          {justAdded ? (
            <>
              <Check className="w-3.5 h-3.5" /> Added!
            </>
          ) : inCart ? (
            <>
              <ShoppingCart className="w-3.5 h-3.5" /> Add Again
            </>
          ) : (
            <>
              <ShoppingCart className="w-3.5 h-3.5" /> Add to Cart
            </>
          )}
        </button>
      </div>
    </article>
  );
}
