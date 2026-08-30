import { env } from 'cloudflare:workers';

const schemaSql = `CREATE TABLE IF NOT EXISTS preferences (
  id INTEGER PRIMARY KEY,
  cities_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

async function ensureSchema() {
  await env.DB.prepare(schemaSql).run();
}

function isValidCity(value: unknown) {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const city = value as Record<string, unknown>;
  return (
    typeof city.id === 'number' &&
    typeof city.name === 'string' && city.name.length > 0 && city.name.length < 160 &&
    typeof city.country === 'string' && city.country.length < 160 &&
    typeof city.countryCode === 'string' && city.countryCode.length <= 3 &&
    typeof city.latitude === 'number' && Number.isFinite(city.latitude) && city.latitude >= -90 && city.latitude <= 90 &&
    typeof city.longitude === 'number' && Number.isFinite(city.longitude) && city.longitude >= -180 && city.longitude <= 180 &&
    typeof city.timezone === 'string' && city.timezone.length > 0 && city.timezone.length < 100 &&
    (city.admin1 === undefined || (typeof city.admin1 === 'string' && city.admin1.length < 160))
  );
}

export async function GET() {
  await ensureSchema();
  const row = await env.DB.prepare('SELECT cities_json FROM preferences WHERE id = ?').bind(1).first<{ cities_json: string }>();
  return Response.json({ cities: row ? JSON.parse(row.cities_json) : null });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null) as { cities?: unknown } | null;
  if (!body || !Array.isArray(body.cities) || body.cities.length !== 4 || !body.cities.every(isValidCity)) {
    return Response.json({ error: 'Invalid city configuration' }, { status: 400 });
  }

  const citiesJson = JSON.stringify(body.cities);
  if (citiesJson.length > 20_000) {
    return Response.json({ error: 'City configuration is too large' }, { status: 413 });
  }

  await ensureSchema();
  await env.DB.prepare(
    `INSERT INTO preferences (id, cities_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET cities_json = excluded.cities_json, updated_at = excluded.updated_at`,
  ).bind(1, citiesJson, new Date().toISOString()).run();

  return Response.json({ ok: true });
}
