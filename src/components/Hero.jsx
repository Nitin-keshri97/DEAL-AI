import { useEffect, useMemo, useRef } from 'react';
import {
  ArrowRight,
  Bot,
  LineChart,
  Handshake,
  BadgeCheck,
  ShieldCheck,
  Search,
  Scale,
  Sparkles,
  Smartphone,
  Headphones,
  Laptop,
  Shirt,
  Footprints,
  House,
  Dumbbell,
} from 'lucide-react';
import { useUI } from '../context/UIContext';
import { useAgentActivity } from '../context/AgentActivityContext';
import { products } from '../data/products';

const inr = (n) => Number(n || 0).toLocaleString('en-IN');

const POPULAR_CATEGORIES = [
  { name: 'Mobiles', icon: Smartphone },
  { name: 'Electronics', icon: Headphones },
  { name: 'Laptops', icon: Laptop },
  { name: 'Fashion', icon: Shirt },
  { name: 'Footwear', icon: Footprints },
  { name: 'Beauty', icon: Sparkles },
  { name: 'Home', icon: House },
  { name: 'Sports', icon: Dumbbell },
];

const FEATURES = [
  { icon: LineChart, label: 'Real-time Price Comparison' },
  { icon: Handshake, label: 'Automatic Bargaining' },
  { icon: BadgeCheck, label: 'Verified Sellers' },
  { icon: ShieldCheck, label: 'Secure Checkout' },
];

// The single most-discounted REAL catalogue product — powers the floating hero
// deal card. Computed once from live product data (no fabricated numbers).
const BEST_DEAL = (() => {
  const disc = (p) => (p && p.originalPrice > p.price ? (p.originalPrice - p.price) / p.originalPrice : 0);
  return products.reduce((best, p) => (disc(p) > disc(best) ? p : best), products[0]);
})();

const scrollToDeals = () =>
  document.getElementById('deals')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

// A premium 3D-style shopping robot, built purely with SVG gradients + light
// (no WebGL, no external asset) so it's crisp and cheap to render. It floats,
// sways its head, drifts its arms and blinks calmly; when the REAL agent is live
// (`active`) its eye aura brightens and breathes. Never a bouncy game character.
function RobotFigure({ active = false }) {
  return (
    <svg
      viewBox="0 0 260 280"
      className="w-52 sm:w-64 lg:w-72 h-auto drop-shadow-2xl"
      role="img"
      aria-label="DealAI shopping robot"
    >
      <defs>
        <linearGradient id="da-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#e9ebf0" />
          <stop offset="1" stopColor="#c9cdd6" />
        </linearGradient>
        <linearGradient id="da-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#26262e" />
          <stop offset="1" stopColor="#0b0b0f" />
        </linearGradient>
        <radialGradient id="da-eye" cx="0.5" cy="0.45" r="0.6">
          <stop offset="0" stopColor="#c9c4ff" />
          <stop offset="0.5" stopColor="#6f63ff" />
          <stop offset="1" stopColor="#443ac9" />
        </radialGradient>
        <radialGradient id="da-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgba(90,80,220,0.45)" />
          <stop offset="1" stopColor="rgba(90,80,220,0)" />
        </radialGradient>
        <filter id="da-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>

      <ellipse cx="130" cy="130" rx="120" ry="128" fill="url(#da-halo)" />

      <g className="animate-floaty">
        <ellipse cx="130" cy="256" rx="66" ry="12" fill="rgba(0,0,0,0.35)" filter="url(#da-glow)" />

        {/* neck + body (steady) */}
        <rect x="113" y="150" width="34" height="24" rx="9" fill="url(#da-metal)" />
        <rect x="78" y="168" width="104" height="80" rx="30" fill="url(#da-metal)" stroke="#bfc4ce" strokeWidth="1.2" />
        <circle cx="130" cy="210" r="16" fill="#0d0d12" />
        <circle cx="130" cy="210" r="9" fill="url(#da-eye)" filter="url(#da-glow)" />
        <circle cx="130" cy="210" r="9" fill="url(#da-eye)" />

        {/* arms — gentle, independent drift */}
        <g className="da-arm-l">
          <rect x="60" y="180" width="16" height="46" rx="8" fill="url(#da-metal)" stroke="#bfc4ce" strokeWidth="1" />
        </g>
        <g className="da-arm-r">
          <rect x="184" y="180" width="16" height="46" rx="8" fill="url(#da-metal)" stroke="#bfc4ce" strokeWidth="1" />
        </g>

        {/* head assembly — slow, calm sway around the neck */}
        <g className="da-sway">
          <rect x="62" y="52" width="136" height="110" rx="36" fill="url(#da-metal)" stroke="#bfc4ce" strokeWidth="1.4" />
          <rect x="76" y="60" width="108" height="30" rx="15" fill="#ffffff" opacity="0.55" />

          {/* side pods */}
          <rect x="50" y="94" width="14" height="34" rx="7" fill="url(#da-metal)" stroke="#bfc4ce" strokeWidth="1" />
          <rect x="196" y="94" width="14" height="34" rx="7" fill="url(#da-metal)" stroke="#bfc4ce" strokeWidth="1" />

          {/* glossy dark face */}
          <rect x="80" y="76" width="100" height="70" rx="26" fill="url(#da-face)" />
          <rect x="80" y="76" width="100" height="70" rx="26" fill="none" stroke="#000000" strokeOpacity="0.4" strokeWidth="1" />

          {/* eye aura — brightens + breathes only when the agent is live */}
          <g className={active ? 'da-breathe' : undefined} style={{ opacity: active ? 0.75 : 0.22 }}>
            <ellipse cx="108" cy="108" rx="20" ry="22" fill="url(#da-eye)" filter="url(#da-glow)" />
            <ellipse cx="152" cy="108" rx="20" ry="22" fill="url(#da-eye)" filter="url(#da-glow)" />
          </g>

          {/* glowing eyes */}
          <g className="animate-blink">
            <ellipse cx="108" cy="108" rx="12" ry="14" fill="url(#da-eye)" filter="url(#da-glow)" />
            <ellipse cx="152" cy="108" rx="12" ry="14" fill="url(#da-eye)" filter="url(#da-glow)" />
            <ellipse cx="108" cy="108" rx="12" ry="14" fill="url(#da-eye)" />
            <ellipse cx="152" cy="108" rx="12" ry="14" fill="url(#da-eye)" />
            <circle cx="104" cy="103" r="3.2" fill="#ffffff" opacity="0.85" />
            <circle cx="148" cy="103" r="3.2" fill="#ffffff" opacity="0.85" />
          </g>

          <path d="M112 128 Q130 138 148 128" stroke="#7b6fff" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.85" />

          {/* antenna */}
          <line x1="130" y1="52" x2="130" y2="34" stroke="#c3c7ce" strokeWidth="4" strokeLinecap="round" />
          <circle cx="130" cy="30" r="6.5" fill="url(#da-eye)" filter="url(#da-glow)" className="animate-aiglow" />
          <circle cx="130" cy="30" r="6.5" fill="url(#da-eye)" className="animate-aiglow" />
        </g>
      </g>
    </svg>
  );
}

// Tiny equalizer shown while the agent is listening/speaking (reflects real
// audio activity). Under reduced motion the bars simply rest at full height.
function Waveform() {
  return (
    <span className="inline-flex items-end gap-[2px] h-3" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="da-wave-bar block w-[3px] h-full rounded-full bg-accent"
          style={{ animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </span>
  );
}

// Floating glass card — reflects the REAL live agent state (phase + last real
// tool step) published by the VoiceAgent. When idle it shows capabilities
// (never fabricated progress, never timers). When active a scan line sweeps and
// the current stage icon pulses.
function ActivityCard({ active, listening, speaking, statusText, stageLabel, StageIcon, lastStep }) {
  const capabilities = [
    { icon: Search, label: 'Searching' },
    { icon: Scale, label: 'Comparing' },
    { icon: Handshake, label: 'Negotiating' },
  ];

  return (
    <div className="relative overflow-hidden glass rounded-2xl shadow-xl w-[190px] sm:w-[210px] p-3.5">
      {active && (
        <span
          aria-hidden
          className="da-scan pointer-events-none absolute left-3 right-3 top-9 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent opacity-0"
        />
      )}

      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          {active && (
            <span className="animate-aiglow absolute inline-flex h-full w-full rounded-full bg-accent/60" />
          )}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${active ? 'bg-accent' : 'bg-faint'}`} />
        </span>
        <span className="text-xs font-bold text-ink">DealAI Agent</span>
        <span className="ml-auto text-[10px] font-semibold text-muted">{statusText}</span>
      </div>

      {active ? (
        <div className="mt-2.5">
          <div className="flex items-center gap-2">
            <StageIcon className="w-3.5 h-3.5 text-accent animate-aiglow" />
            <span className="text-[11px] font-semibold text-ink">{stageLabel}</span>
            {(listening || speaking) && (
              <span className="ml-auto">
                <Waveform />
              </span>
            )}
          </div>
          {lastStep && (
            <p className="mt-1.5 text-[11px] font-medium text-muted leading-snug line-clamp-2">{lastStep}</p>
          )}
        </div>
      ) : (
        <div className="mt-2.5 space-y-1.5">
          {capabilities.map((c) => (
            <div key={c.label} className="flex items-center gap-2 text-[11px] font-medium text-muted">
              <c.icon className="w-3.5 h-3.5 text-accent/70" />
              {c.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// One floating, softly-tilted glass deal card using a REAL catalogue product.
function DealCard() {
  const pct = Math.round((1 - BEST_DEAL.price / BEST_DEAL.originalPrice) * 100);
  return (
    <div className="w-[148px] sm:w-[166px] glass rounded-2xl shadow-xl overflow-hidden">
      <div className="relative">
        <img src={BEST_DEAL.image} alt="" loading="lazy" className="w-full h-[74px] object-cover" />
        <span className="absolute top-1.5 right-1.5 rounded-full bg-ink/85 text-white text-[9px] font-bold px-1.5 py-0.5 backdrop-blur">
          {pct}% OFF
        </span>
      </div>
      <div className="p-2.5">
        <p className="text-[11px] font-bold text-ink truncate">{BEST_DEAL.name}</p>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-sm font-extrabold text-ink">₹{inr(BEST_DEAL.price)}</span>
          <span className="text-[10px] text-faint line-through">₹{inr(BEST_DEAL.originalPrice)}</span>
        </div>
        <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-accent">
          <Sparkles className="w-3 h-3" /> AI best deal
        </div>
      </div>
    </div>
  );
}

// A small glass data chip — shown ONLY while the real agent is active.
function DataChip({ icon: Icon, text }) {
  return (
    <div className="inline-flex items-center gap-1.5 glass rounded-full pl-2 pr-3 py-1.5 shadow-lg">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/15">
        <Icon className="w-3 h-3 text-accent" />
      </span>
      <span className="text-[10px] font-semibold text-ink whitespace-nowrap">{text}</span>
    </div>
  );
}

// The interactive hero visual layer: robot + live activity card + floating deal
// card + connection flow + real-state data chip, with mouse parallax. Reads the
// shared agent activity ONCE here and drives every element from real phase/steps
// (never timers). This is the only component that subscribes to activity, so a
// phase change re-renders just this subtree — the product grid is untouched.
function AgentStage() {
  const { activity } = useAgentActivity();
  const phase = activity?.phase || 'idle';
  const steps = activity?.steps || [];
  const listening = phase === 'listening';
  const speaking = phase === 'speaking';
  const processing = phase === 'processing';
  const active = listening || speaking || processing;
  const lastStep = steps.length ? steps[steps.length - 1] : '';

  const statusText = listening ? 'Listening' : processing ? 'Working' : speaking ? 'Speaking' : 'Ready';

  // Reflect the REAL last tool step into a stage label/icon/chip. Pure mapping
  // of already-completed work — no fabricated progress.
  const s = lastStep.toLowerCase();
  const stage = /negoti|bargain|deal|discount/.test(s)
    ? 'negotiate'
    : /compar/.test(s)
    ? 'compare'
    : /search|find|catalog|look|browse/.test(s)
    ? 'search'
    : speaking
    ? 'best'
    : 'search';

  const STAGE = {
    search: { icon: Search, label: 'Searching', chip: `Searching ${products.length} products` },
    compare: { icon: Scale, label: 'Comparing', chip: 'Comparing prices' },
    negotiate: { icon: Handshake, label: 'Negotiating', chip: 'Negotiating best price' },
    best: { icon: Sparkles, label: 'Finding best deal', chip: 'Best deal found' },
  };
  const cur = STAGE[stage];

  const reduceMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  // Mouse parallax — writes CSS custom props (--px/--py) straight onto the stage
  // node inside a rAF-throttled pointer handler. No React state ⇒ zero re-renders
  // (the product grid never repaints). Only on fine pointers with motion allowed.
  const stageRef = useRef(null);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const motionOk = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const el = stageRef.current;
    if (!fine || !motionOk || !el) return undefined;

    let raf = 0;
    let nx = 0;
    let ny = 0;
    const apply = () => {
      raf = 0;
      el.style.setProperty('--px', nx.toFixed(3));
      el.style.setProperty('--py', ny.toFixed(3));
    };
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      nx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)));
      ny = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)));
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={stageRef} className="relative flex justify-center lg:justify-end" style={{ perspective: '1200px' }}>
      <div className="relative">
        {/* Agentic connection flow — extremely subtle, large screens only.
            A thin dotted line links the activity card → deal card, with one slow
            light particle traveling it (paused under reduced motion). */}
        <svg
          className="hidden lg:block absolute inset-0 h-full w-full pointer-events-none"
          viewBox="0 0 300 340"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path
            d="M64 250 C120 190 185 150 235 70"
            fill="none"
            stroke="rgba(139,128,255,0.20)"
            strokeWidth="1"
            strokeDasharray="1 7"
            strokeLinecap="round"
          />
          <path
            d="M64 250 C120 190 185 150 235 70"
            fill="none"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth="1"
            strokeDasharray="1 7"
            strokeLinecap="round"
          />
          {[
            [100, 214],
            [150, 150],
            [205, 96],
          ].map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2" fill="rgba(255,255,255,0.28)" />
          ))}
          {!reduceMotion && (
            <circle r="2.6" fill="#8b80ff" opacity="0.9">
              <animateMotion dur="5.5s" repeatCount="indefinite" path="M64 250 C120 190 185 150 235 70" />
            </circle>
          )}
        </svg>

        {/* Robot */}
        <div className="da-parallax relative z-10" style={{ '--mag': 6 }}>
          <RobotFigure active={active} />
        </div>

        {/* Live activity card — kept on every screen size */}
        <div className="da-parallax absolute -left-2 sm:left-0 bottom-2 sm:bottom-6 z-20" style={{ '--mag': 5 }}>
          <ActivityCard
            active={active}
            listening={listening}
            speaking={speaking}
            statusText={statusText}
            stageLabel={cur.label}
            StageIcon={cur.icon}
            lastStep={lastStep}
          />
        </div>

        {/* Floating real-deal card — softly tilted; hidden on the smallest screens */}
        <div className="hidden sm:block da-parallax absolute -right-3 lg:-right-7 top-1 lg:-top-2 z-20" style={{ '--mag': 12 }}>
          <div className="da-float-slow">
            <div style={{ transform: 'perspective(760px) rotateY(-7deg) rotateX(3deg)' }}>
              <DealCard />
            </div>
          </div>
        </div>

        {/* Live data chip — only while the REAL agent is active (large screens) */}
        {active && (
          <div className="hidden lg:block da-parallax absolute -left-8 top-8 z-20" style={{ '--mag': 10 }}>
            <div className="da-float-mid">
              <DataChip icon={cur.icon} text={cur.chip} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Hero() {
  const { selectCategory, openAgent } = useUI();

  return (
    <section className="px-4 sm:px-6 lg:px-8 pt-6 pb-2">
      <div className="max-w-7xl mx-auto">
        {/* ── Cinematic hero ── */}
        <div className="relative overflow-hidden rounded-3xl bg-[#141416] text-white shadow-2xl">
          {/* subtle indigo lighting — restrained, not neon; drifts slowly (8–15s) */}
          <div className="da-drift-1 pointer-events-none absolute -top-24 -right-16 w-96 h-96 rounded-full bg-accent/20 blur-3xl" />
          <div className="da-drift-2 pointer-events-none absolute bottom-0 left-1/3 w-72 h-72 rounded-full bg-accent/10 blur-3xl" />

          <div className="relative p-6 sm:p-10 lg:p-12">
            <div className="grid lg:grid-cols-2 gap-8 items-center">
              {/* Copy */}
              <div className="max-w-xl">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/80">
                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                  Your AI Shopping Agent
                </span>

                <h1 className="mt-4 text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-[1.08]">
                  Shop Smarter.
                  <br />
                  Let <span className="text-accent">AI Negotiate.</span>
                </h1>

                <p className="mt-4 text-sm sm:text-base text-white/65 leading-relaxed max-w-md">
                  DealAI compares prices across sellers, bargains on your behalf, and secures the best
                  deal — so you simply say what you want.
                </p>

                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <button onClick={() => openAgent()} className="btn-ai h-12 px-6 rounded-full text-sm">
                    <Bot className="w-[18px] h-[18px]" /> Ask AI Agent
                  </button>
                  <button
                    onClick={scrollToDeals}
                    className="inline-flex items-center gap-2 h-12 px-6 rounded-full border border-white/15 bg-white/5 text-white font-semibold text-sm hover:bg-white/10 transition-colors"
                  >
                    Explore Deals <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Robot + live activity */}
              <AgentStage />
            </div>

            {/* Feature bar */}
            <div className="mt-8 pt-6 border-t border-white/10 grid grid-cols-2 md:grid-cols-4 gap-4">
              {FEATURES.map((f) => (
                <div key={f.label} className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-white/8 flex items-center justify-center shrink-0">
                    <f.icon className="w-4 h-4 text-white/80" />
                  </span>
                  <span className="text-xs sm:text-[13px] font-medium text-white/75 leading-tight">{f.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Popular categories ── */}
        <div id="categories" className="mt-10 scroll-mt-20">
          <div className="flex items-end justify-between mb-4">
            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-ink">Popular Categories</h2>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2.5 sm:gap-3">
            {POPULAR_CATEGORIES.map((cat) => (
              <button
                key={cat.name}
                onClick={() => selectCategory(cat.name)}
                className="group flex flex-col items-center gap-2.5 rounded-2xl bg-paper border border-line p-3 sm:p-4 hover:border-transparent hover:shadow-lg hover:shadow-ink/5 hover:-translate-y-0.5 transition-all"
              >
                <span className="w-11 h-11 rounded-full bg-mist flex items-center justify-center group-hover:bg-accent-soft transition-colors">
                  <cat.icon className="w-5 h-5 text-ink group-hover:text-accent transition-colors" />
                </span>
                <span className="text-[11px] sm:text-xs font-semibold text-muted group-hover:text-ink truncate max-w-full transition-colors">
                  {cat.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
