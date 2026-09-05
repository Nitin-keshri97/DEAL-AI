import { useEffect, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CartProvider, useCart } from './context/CartContext';
import { WishlistProvider } from './context/WishlistContext';
import { UIProvider, useUI, VIEWS } from './context/UIContext';
import { AgentActivityProvider } from './context/AgentActivityContext';
import { getMyCart, saveMyCart, getProductDetails } from './lib/api';
import Layout from './components/Layout';
import Hero from './components/Hero';
import ProductGrid from './components/ProductGrid';
import CartDrawer from './components/CartDrawer';
import DealModal from './components/DealModal';
import AgentPanel from './components/AgentPanel';
import VoiceAgent from './components/VoiceAgent';
import ProductDetailModal from './components/ProductDetailModal';
import HowItWorks from './components/HowItWorks';
import FeatureSection from './components/FeatureSection';
import AuthModal from './components/AuthModal';
import ProfilePage from './components/ProfilePage';
import OrdersPage from './components/OrdersPage';
import OrderDetailPage from './components/OrderDetailPage';
import CheckoutPage from './components/CheckoutPage';
import SearchPage from './components/SearchPage';
import CategoryPage from './components/CategoryPage';
import WishlistPage from './components/WishlistPage';

function CartSync() {
  const { isAuthed, token } = useAuth();
  const { cartItems, addToCart } = useCart();
  const hydratedForToken = useRef(null);

  useEffect(() => {
    if (!isAuthed || !token) return;
    if (hydratedForToken.current === token) return;
    hydratedForToken.current = token;
    (async () => {
      try {
        const serverCart = await getMyCart();
        if (cartItems.length === 0 && serverCart.length > 0) {
          for (const line of serverCart) {
            try {
              const base = await getProductDetails(line.productId);
              if (base) {
                addToCart({
                  id: base.sku,
                  name: base.name,
                  price: base.price,
                  originalPrice: base.originalPrice ?? base.price,
                  image: base.image,
                  category: base.category,
                }, line.quantity);
              }
            } catch { /* skip missing items */ }
          }
        }
      } catch { /* best-effort */ }
    })();
  }, [isAuthed, token]);

  useEffect(() => {
    if (!isAuthed || !token) return;
    const t = setTimeout(() => {
      saveMyCart(cartItems.map((i) => ({ productId: i.id, quantity: i.quantity }))).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [isAuthed, token, cartItems]);

  return null;
}

function CurrentView() {
  const { view } = useUI();
  switch (view) {
    case VIEWS.PROFILE:
      return <ProfilePage />;
    case VIEWS.ORDERS:
      return <OrdersPage />;
    case VIEWS.ORDER:
      return <OrderDetailPage />;
    case VIEWS.CHECKOUT:
      return <CheckoutPage />;
    case VIEWS.SEARCH:
      return <SearchPage />;
    case VIEWS.CATEGORY:
      return <CategoryPage />;
    case VIEWS.WISHLIST:
      return <WishlistPage />;
    case VIEWS.SHOP:
    default:
      return (
        <>
          <Hero />
          <ProductGrid />
          <HowItWorks />
          <FeatureSection />
        </>
      );
  }
}

function AppContent() {
  const [cartOpen, setCartOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);

  return (
    <>
      <CartSync />

      <Layout onCartOpen={() => setCartOpen(true)}>
        <CurrentView />
      </Layout>

      <CartDrawer
        isOpen={cartOpen}
        onClose={() => setCartOpen(false)}
        onDealOpen={() => setDealOpen(true)}
      />
      <DealModal isOpen={dealOpen} onClose={() => setDealOpen(false)} />

      <AgentPanel />
      <VoiceAgent />
      <ProductDetailModal />
      <AuthModal />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <WishlistProvider>
          <UIProvider>
            <AgentActivityProvider>
              <AppContent />
            </AgentActivityProvider>
          </UIProvider>
        </WishlistProvider>
      </CartProvider>
    </AuthProvider>
  );
}
