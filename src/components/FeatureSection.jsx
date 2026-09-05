import { Sparkles, Package, TrendingUp } from 'lucide-react';

const FEATURES = [
  {
    icon: <Sparkles className="w-5 h-5" />,
    title: 'Personalized Deals',
    description: 'Every customer gets a unique offer based on their cart and intent.',
    comingSoon: false,
    color: 'indigo',
  },
  {
    icon: <Package className="w-5 h-5" />,
    title: 'Bundle Bargaining',
    description: 'Add more products to unlock smarter, deeper bundle discounts.',
    comingSoon: false,
    color: 'indigo',
  },
  {
    icon: <TrendingUp className="w-5 h-5" />,
    title: 'Margin-Aware AI',
    description: 'AI negotiates within merchant-defined limits — never below cost.',
    comingSoon: true,
    color: 'amber',
  },
];

export default function FeatureSection() {
  return (
    <section id="about" className="py-16 md:py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Heading */}
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight">
            Smart Deals. Protected Margins.
          </h2>
          <p className="mt-4 text-gray-500 max-w-2xl mx-auto">
            DealAI benefits both sides of the transaction — customers get personalized
            deals while merchants keep AI-enforced margins.
          </p>
        </div>

        {/* Two-sided value prop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-12">
          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-500 mb-2">
              For Customers
            </p>
            <p className="text-lg font-bold text-gray-900">
              Get personalized bundle deals.
            </p>
            <p className="text-sm text-gray-500 mt-2 leading-relaxed">
              No more fixed prices. Tell us what you want to pay and let AI find the
              best possible deal for your exact cart.
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-green-500 mb-2">
              For Merchants
            </p>
            <p className="text-lg font-bold text-gray-900">
              AI negotiates within your rules.
            </p>
            <p className="text-sm text-gray-500 mt-2 leading-relaxed">
              Define minimum margins, max discounts, and inventory triggers. DealAI
              will never breach your limits.
            </p>
          </div>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm"
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${
                  f.color === 'amber'
                    ? 'bg-amber-50 text-amber-500'
                    : 'bg-indigo-50 text-indigo-600'
                }`}
              >
                {f.icon}
              </div>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-bold text-gray-900">{f.title}</h3>
                {f.comingSoon && (
                  <span className="badge badge-coming-soon">Soon</span>
                )}
              </div>
              <p className="text-sm text-gray-500 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
