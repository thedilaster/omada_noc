import { Pool } from 'pg';

let globalPool: Pool | null = null;
let fallbackToMemory = false;

/**
 * Whether the in-memory store may stand in for PostgreSQL. ALLOW_MEMORY_FALLBACK ('true'/'false')
 * wins when set; otherwise only non-production builds may fall back. In production the memory
 * store would hide real users and expose the public default admin password, so DB errors surface.
 */
export function isMemoryFallbackAllowed(): boolean {
  const flag = process.env.ALLOW_MEMORY_FALLBACK?.trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

export function isMemoryFallbackActive(): boolean {
  return fallbackToMemory && isMemoryFallbackAllowed();
}

/**
 * Switches all queries to the in-memory store. Returns false (and stays on PostgreSQL)
 * when memory fallback is not allowed in this environment.
 */
export function activateMemoryFallback(reason?: string): boolean {
  if (!isMemoryFallbackAllowed()) {
    if (reason) {
      console.error(`[Database] PostgreSQL error (memory fallback disabled): ${reason}`);
    }
    return false;
  }
  if (!fallbackToMemory) {
    fallbackToMemory = true;
    if (reason) {
      console.warn(`⚠️ [Database] Activating In-Memory Store fallback: ${reason}`);
    }
  }
  return true;
}

export function resetMemoryFallback(): void {
  fallbackToMemory = false;
}

/**
 * Evaluates whether an error is caused by missing database, authentication mismatch,
 * or connection refusal that should trigger transparent in-memory fallback in dev.
 */
export function isConnectionOrAuthError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err as Error).message ? (err as Error).message.toLowerCase() : '';
  const code = (err as { code?: string }).code || '';
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === '28P01' || // password authentication failed
    code === '3D000' || // database does not exist
    code === '28000' || // invalid authorization specification
    code === '42P01' || // table does not exist
    msg.includes('connection refused') ||
    msg.includes('connection terminated') ||
    msg.includes('password authentication failed') ||
    msg.includes('authentication failed') ||
    msg.includes('auth failed') ||
    msg.includes('does not exist') ||
    msg.includes('sasl') ||
    msg.includes('no pg_hba') ||
    msg.includes('timeout')
  );
}

/**
 * Single decision point for query catch blocks: true (and fallback activated) when the error
 * is a connection/auth failure and memory fallback is allowed; false means rethrow.
 */
export function shouldFallbackToMemory(err: unknown): boolean {
  if (!isConnectionOrAuthError(err)) return false;
  return activateMemoryFallback((err as Error).message);
}

/**
 * Returns a singleton PostgreSQL connection pool.
 */
export function getDbPool(): Pool {
  if (!globalPool) {
    const connectionString =
      process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/noc_dash';

    globalPool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
    });

    globalPool.on('error', (err) => {
      if (isConnectionOrAuthError(err) && isMemoryFallbackAllowed()) {
        activateMemoryFallback(err.message);
      } else {
        console.error('Unexpected error on idle PostgreSQL client pool:', err);
      }
    });
  }

  return globalPool;
}

/**
 * Closes the database pool (useful for test tear-downs).
 */
export async function closeDbPool(): Promise<void> {
  if (globalPool) {
    await globalPool.end().catch(() => {});
    globalPool = null;
  }
}
