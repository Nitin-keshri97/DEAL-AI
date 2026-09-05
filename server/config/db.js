import mongoose from 'mongoose';
import { readEnv } from './loadEnv.js';

// Connect to MongoDB Atlas via MONGODB_URI. Designed to FAIL GRACEFULLY:
// - missing URI  → log a clear warning, do NOT crash (server still boots so
//                  /api/health works and requests get a clean 503).
// - bad URI      → log the error, keep the process alive.
//
// Whether the DB is usable is checked at request time via isDbConnected().
export async function connectDB() {
  const uri = readEnv('MONGODB_URI');

  if (!uri) {
    console.warn(
      '\n⚠️  MONGODB_URI is not set. DealAI will start, but database-backed\n' +
        '    routes (/api/deals/negotiate) will return 503 until you add a\n' +
        '    MongoDB Atlas connection string to server/.env\n'
    );
    return false;
  }

  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
    console.log('✅ MongoDB connected');
    return true;
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    console.error('   The server will keep running; DB routes will return 503.');
    return false;
  }
}

/** True only when a live, ready connection exists (readyState === 1). */
export function isDbConnected() {
  return mongoose.connection.readyState === 1;
}
