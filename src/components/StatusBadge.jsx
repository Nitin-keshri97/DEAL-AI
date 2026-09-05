import { Clock, CheckCircle2, Package, Truck, Home, XCircle } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────
// StatusBadge — maps an order status to a coloured pill + icon.
//
// Statuses are SIMULATED for this demo (there is no real fulfilment pipeline);
// the UI is honest about that elsewhere. This component only renders the label.
// ─────────────────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  Placed: { cls: 'bg-indigo-50 text-indigo-700', Icon: Clock },
  Confirmed: { cls: 'bg-sky-50 text-sky-700', Icon: CheckCircle2 },
  Processing: { cls: 'bg-amber-50 text-amber-700', Icon: Package },
  Shipped: { cls: 'bg-violet-50 text-violet-700', Icon: Truck },
  Delivered: { cls: 'bg-green-50 text-green-700', Icon: Home },
  Cancelled: { cls: 'bg-red-50 text-red-700', Icon: XCircle },
};

export default function StatusBadge({ status, className = '' }) {
  const { cls, Icon } = STATUS_STYLES[status] || STATUS_STYLES.Placed;
  return (
    <span className={`badge ${cls} ${className}`}>
      <Icon className="w-3 h-3" aria-hidden="true" />
      {status || 'Placed'}
    </span>
  );
}
