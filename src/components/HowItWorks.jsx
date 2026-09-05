import { ShoppingCart, Handshake, Bot } from 'lucide-react';

const STEPS = [
  {
    number: '01',
    icon: <ShoppingCart className="w-6 h-6" />,
    title: 'Build Your Cart',
    description: 'Choose the products you want.',
    comingSoon: false,
  },
  {
    number: '02',
    icon: <Handshake className="w-6 h-6" />,
    title: 'Make Your Offer',
    description: "Tell DealAI what you'd like to pay.",
    comingSoon: false,
  },
  {
    number: '03',
    icon: <Bot className="w-6 h-6" />,
    title: 'Get Your Best Deal',
    description: "AI will negotiate within the merchant's rules.",
    comingSoon: true,
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-16 md:py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight">
            How It Works
          </h2>
          <p className="mt-3 text-gray-500 max-w-xl mx-auto">
            Three simple steps to smarter shopping.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          {/* Connector line — desktop only */}
          <div
            aria-hidden="true"
            className="hidden md:block absolute top-12 left-[calc(16.67%+24px)] right-[calc(16.67%+24px)] h-px bg-gray-200 z-0"
          />

          {STEPS.map((step) => (
            <div key={step.number} className="relative z-10 flex flex-col items-center text-center bg-white rounded-2xl border border-gray-100 p-8 shadow-sm">
              {/* Step number */}
              <div className="text-xs font-bold text-indigo-400 tracking-widest mb-4">
                {step.number}
              </div>

              {/* Icon circle */}
              <div
                className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-5 ${
                  step.comingSoon
                    ? 'bg-amber-50 text-amber-500'
                    : 'bg-indigo-50 text-indigo-600'
                }`}
              >
                {step.icon}
              </div>

              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-base font-bold text-gray-900">{step.title}</h3>
                {step.comingSoon && (
                  <span className="badge badge-coming-soon">Soon</span>
                )}
              </div>

              <p className="text-sm text-gray-500 leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
