import { useState } from 'react';
import Sidebar from './Sidebar';
import Navbar from './Navbar';
import Footer from './Footer';

// ─────────────────────────────────────────────────────────────────────────
// Layout — the app shell: persistent left Sidebar + sticky TopBar + content.
// Owns the mobile drawer open/close state; content offsets by the rail width
// on large screens (lg:pl-64) while inner pages keep their own max-w centering.
// ─────────────────────────────────────────────────────────────────────────

export default function Layout({ children, onCartOpen }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <Sidebar mobileOpen={drawerOpen} onClose={() => setDrawerOpen(false)} onCartOpen={onCartOpen} />

      <div className="lg:pl-64 flex flex-col min-h-screen">
        <Navbar onMenu={() => setDrawerOpen(true)} onCartOpen={onCartOpen} />
        <main className="flex-1">{children}</main>
        <Footer />
      </div>
    </div>
  );
}
