// Razorpay Checkout loader (Day 8).
//
// Loads the official Razorpay Checkout script on demand and opens the payment
// modal. NOTHING sensitive lives here — the Key Secret never reaches the browser;
// we receive only the public Key ID and a server-created order id + amount. The
// amount shown/collected is the SERVER's authoritative total (paise); this file
// never computes or trusts a price.

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

let loadPromise = null;

/**
 * Ensure the Razorpay Checkout script is present. Resolves true when
 * window.Razorpay is available, false if the script could not be loaded
 * (offline, blocked, etc.) so callers can degrade gracefully.
 * @returns {Promise<boolean>}
 */
export function loadRazorpayScript() {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${CHECKOUT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(Boolean(window.Razorpay)));
      existing.addEventListener('error', () => resolve(false));
      if (window.Razorpay) resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => {
      loadPromise = null; // allow a later retry
      resolve(false);
    };
    document.body.appendChild(script);
  });
  return loadPromise;
}

/**
 * Open the Razorpay Checkout modal.
 * @param {object} options - Razorpay options (key, order_id, amount, currency,
 *   name, description, prefill, handler, modal.ondismiss, theme...).
 * @returns {boolean} true if the modal was opened.
 */
export function openRazorpayCheckout(options) {
  if (typeof window === 'undefined' || !window.Razorpay) return false;
  const rzp = new window.Razorpay(options);
  // Surface a failed/declined payment without leaving the user stuck.
  if (typeof rzp.on === 'function' && typeof options.onFailure === 'function') {
    rzp.on('payment.failed', options.onFailure);
  }
  rzp.open();
  return true;
}
