import { useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useCart } from '../context/CartContext';

export default function CartItem({ item }) {
  const { removeFromCart, increaseQuantity, decreaseQuantity } = useCart();
  const [imgError, setImgError] = useState(false);

  const itemTotal = item.price * item.quantity;

  return (
    <div className="flex gap-3 py-4 border-b border-gray-100 last:border-0">
      {/* Image */}
      <div className="w-16 h-16 rounded-xl bg-gray-50 overflow-hidden shrink-0">
        {imgError ? (
          <div className="w-full h-full flex items-center justify-center text-2xl" aria-hidden="true">
            🛍️
          </div>
        ) : (
          <img
            src={item.image}
            alt={item.name}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{item.name}</p>
        <p className="text-xs text-gray-400 mt-0.5">{item.category}</p>
        <p className="text-sm font-bold text-gray-900 mt-1">
          ₹{item.price.toLocaleString('en-IN')}
        </p>

        {/* Quantity controls */}
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={() => decreaseQuantity(item.id)}
            aria-label={`Decrease quantity of ${item.name}`}
            className="w-7 h-7 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <Minus className="w-3 h-3" />
          </button>
          <span
            className="text-sm font-semibold w-5 text-center"
            aria-label={`Quantity: ${item.quantity}`}
          >
            {item.quantity}
          </span>
          <button
            type="button"
            onClick={() => increaseQuantity(item.id)}
            aria-label={`Increase quantity of ${item.name}`}
            className="w-7 h-7 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Right: item total + remove */}
      <div className="flex flex-col items-end justify-between shrink-0">
        <p className="text-sm font-bold text-gray-900">
          ₹{itemTotal.toLocaleString('en-IN')}
        </p>
        <button
          type="button"
          onClick={() => removeFromCart(item.id)}
          aria-label={`Remove ${item.name} from cart`}
          className="text-gray-300 hover:text-red-500 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
