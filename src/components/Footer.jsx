import { Zap, Heart, ShieldCheck, Truck, Headphones, Lock } from 'lucide-react';
import { useUI } from '../context/UIContext';

export default function Footer() {
  const { selectCategory, goShop } = useUI();

  return (
    <footer className="bg-slate-900 text-slate-400 text-xs border-t border-slate-800">
      {/* Guarantees Strip */}
      <div className="border-b border-slate-800 py-6 bg-slate-950/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 shrink-0">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-white text-xs">Free Delivery</p>
              <p className="text-[11px] text-slate-500">On all orders across India</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-white text-xs">Verified Products</p>
              <p className="text-[11px] text-slate-500">100% authentic catalogue</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400 shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-white text-xs">AI Negotiation</p>
              <p className="text-[11px] text-slate-500">Merchant-protected deals</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-400 shrink-0">
              <Headphones className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-white text-xs">24/7 AI Support</p>
              <p className="text-[11px] text-slate-500">Ask DealAI anytime</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Footer Links */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="space-y-3">
            <button onClick={goShop} className="flex items-center gap-2 group">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                <Zap className="w-4 h-4 text-white" fill="white" />
              </div>
              <span className="text-white font-extrabold text-xl">
                Deal<span className="text-indigo-400">AI</span>
              </span>
            </button>
            <p className="leading-relaxed text-slate-400">
              Next-generation Indian e-commerce powered by autonomous AI price negotiation & smart product discovery.
            </p>
          </div>

          {/* Categories */}
          <div>
            <p className="font-bold uppercase tracking-wider text-slate-200 mb-3 text-[11px]">Popular Categories</p>
            <ul className="space-y-2">
              {['Mobiles', 'Electronics', 'Laptops', 'Clothing', 'Footwear', 'Beauty', 'Home'].map((cat) => (
                <li key={cat}>
                  <button
                    onClick={() => selectCategory(cat)}
                    className="hover:text-white transition-colors"
                  >
                    {cat}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Quick Links */}
          <div>
            <p className="font-bold uppercase tracking-wider text-slate-200 mb-3 text-[11px]">Quick Links</p>
            <ul className="space-y-2">
              <li><button onClick={goShop} className="hover:text-white">Shop Catalogue</button></li>
              <li><a href="#trending-section" className="hover:text-white">Best Deals</a></li>
              <li><a href="#how-it-works" className="hover:text-white">How AI Bargaining Works</a></li>
              <li><span className="text-slate-500">Order Tracking</span></li>
              <li><span className="text-slate-500">Return Policy</span></li>
            </ul>
          </div>

          {/* Tech & AI Stack */}
          <div>
            <p className="font-bold uppercase tracking-wider text-slate-200 mb-3 text-[11px]">Powered By</p>
            <ul className="space-y-2">
              <li className="flex items-center gap-1.5 text-slate-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Groq AI LLM Engine
              </li>
              <li className="flex items-center gap-1.5 text-slate-300">
                <span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" /> MongoDB Atlas Database
              </li>
              <li className="flex items-center gap-1.5 text-slate-300">
                <span className="w-2 h-2 rounded-full bg-sky-400 inline-block" /> Node.js &amp; Express API
              </li>
              <li className="flex items-center gap-1.5 text-slate-300">
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> React &amp; Tailwind Architecture
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-800 mt-10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-slate-500 text-[11px]">
          <p>© {new Date().getFullYear()} DealAI E-Commerce. All rights reserved.</p>
          <p className="flex items-center gap-1 text-slate-400">
            Built with <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" /> for modern Indian online shoppers.
          </p>
        </div>
      </div>
    </footer>
  );
}
