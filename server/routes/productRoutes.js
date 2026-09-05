import { Router } from 'express';
import { listProducts, getProduct, getProductReviews, searchProducts, getCategories, getRelatedProducts } from '../controllers/productController.js';

const router = Router();

// GET /api/products              — full catalogue (safe)
router.get('/', listProducts);
// GET /api/products/search       — filtered + paginated search (MUST be before /:id)
router.get('/search', searchProducts);
// GET /api/products/categories   — unique categories + subcategories (MUST be before /:id)
router.get('/categories', getCategories);
// GET /api/products/:id          — one product's detail
router.get('/:id', getProduct);
// GET /api/products/:id/reviews  — reviews + factual summary
router.get('/:id/reviews', getProductReviews);
// GET /api/products/:id/related  — related products in same category
router.get('/:id/related', getRelatedProducts);

export default router;
