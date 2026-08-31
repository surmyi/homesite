declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    AUTH_MODE?: 'sites' | 'google';
    AUTH_SESSION_SECRET?: string;
    FINANCE_INGEST_TOKEN_SHA256?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GOOGLE_REDIRECT_URI?: string;
    APP_ORIGIN?: string;
  }
}
