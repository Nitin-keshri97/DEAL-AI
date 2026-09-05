import { Router } from 'express';
import { chat, stream } from '../controllers/agentController.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// POST /api/agent/chat — talk to the DealAI shopping agent.
// optionalAuth: sets req.userId when a valid token is present (for
// personalization) but still lets guests chat anonymously.
router.post('/chat', optionalAuth, chat);

// POST /api/agent/stream — SSE real-time streaming endpoint for VoiceAgent
router.post('/stream', optionalAuth, stream);

export default router;
