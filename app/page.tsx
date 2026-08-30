'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sun,
  Sunrise,
  Sunset,
  Trash2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type City = {
  id: number;
  name: string;
  admin1?: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

type WeatherSnapshot = {
  temperature: number;
  apparentTemperature: number;
  weatherCode: number;
  isDay: boolean;
  high: number;
  low: number;
  rainChance: number | null;
  sunrise: string;
  sunset: string;
};

type SearchResult = {
  id: number;
  name: string;
  admin1?: string;
  country?: string;
  country_code?: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

type ForecastResponse = {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    is_day: number;
  };
  daily: {
    sunrise: string[];
    sunset: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max?: (number | null)[];
  };
};

const DEFAULT_CITIES: (City | null)[] = [
  {
    id: 5391959,
    name: 'San Francisco',
    admin1: 'California',
    country: 'United States',
    countryCode: 'US',
    latitude: 37.7749,
    longitude: -122.4194,
    timezone: 'America/Los_Angeles',
  },
  {
    id: 5128581,
    name: 'New York',
    admin1: 'New York',
    country: 'United States',
    countryCode: 'US',
    latitude: 40.7128,
    longitude: -74.006,
    timezone: 'America/New_York',
  },
  {
    id: 2643743,
    name: 'London',
    country: 'United Kingdom',
    countryCode: 'GB',
    latitude: 51.5074,
    longitude: -0.1278,
    timezone: 'Europe/London',
  },
  {
    id: 1850147,
    name: 'Tokyo',
    country: 'Japan',
    countryCode: 'JP',
    latitude: 35.6762,
    longitude: 139.6503,
    timezone: 'Asia/Tokyo',
  },
];

const WEATHER_LABELS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Heavy showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorms',
  96: 'Storms with hail',
  99: 'Storms with hail',
};

function weatherLabel(code: number) {
  return WEATHER_LABELS[code] ?? 'Conditions unavailable';
}

function WeatherIcon({ code, isDay, className }: { code: number; isDay: boolean; className?: string }) {
  if (code === 0) return isDay ? <Sun className={className} /> : <CloudSun className={className} />;
  if (code <= 3) return <CloudSun className={className} />;
  if (code <= 48) return <CloudFog className={className} />;
  if (code >= 95) return <CloudLightning className={className} />;
  if ((code >= 71 && code <= 77) || code >= 85) return <CloudSnow className={className} />;
  if (code >= 51) return <CloudRain className={className} />;
  return <Cloud className={className} />;
}

function formatClock(date: Date | null, timezone: string, includeSeconds = false) {
  if (!date) return includeSeconds ? '—:—:—' : '—:—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined,
    hour12: false,
  }).format(date);
}

function formatTileDate(date: Date | null, timezone: string, compact = false) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: compact ? 'short' : 'long',
    month: compact ? 'short' : 'long',
    day: 'numeric',
  }).format(date);
}

function shortSolarTime(value: string) {
  const time = value.split('T')[1];
  return time?.slice(0, 5) ?? '—:—';
}

function celsius(fahrenheit: number) {
  return Math.round((fahrenheit - 32) * 5 / 9);
}

function minutesFromSolarTime(value: string) {
  const time = value.split('T')[1]?.slice(0, 5);
  if (!time) return null;
  const [hours, minutes] = time.split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
}

function minutesInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hours = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minutes = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hours * 60 + minutes;
}

function isDaylight(date: Date | null, timezone: string, weather: WeatherSnapshot | null) {
  if (!date) return true;
  const nowMinutes = minutesInTimezone(date, timezone);
  const sunriseMinutes = weather ? minutesFromSolarTime(weather.sunrise) : 6 * 60;
  const sunsetMinutes = weather ? minutesFromSolarTime(weather.sunset) : 18 * 60;
  if (sunriseMinutes === null || sunsetMinutes === null) return nowMinutes >= 6 * 60 && nowMinutes < 18 * 60;
  return nowMinutes >= sunriseMinutes && nowMinutes < sunsetMinutes;
}

function useWeather(city: City | null, refreshToken: number) {
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    if (!city) {
      queueMicrotask(() => {
        setWeather(null);
        setStatus('idle');
      });
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      latitude: String(city.latitude),
      longitude: String(city.longitude),
      current: 'temperature_2m,apparent_temperature,is_day,weather_code',
      daily: 'sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      temperature_unit: 'fahrenheit',
      timezone: 'auto',
      forecast_days: '1',
    });

    queueMicrotask(() => setStatus('loading'));
    fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Weather request failed');
        return response.json() as Promise<ForecastResponse>;
      })
      .then((data) => {
        setWeather({
          temperature: data.current.temperature_2m,
          apparentTemperature: data.current.apparent_temperature,
          weatherCode: data.current.weather_code,
          isDay: Boolean(data.current.is_day),
          high: data.daily.temperature_2m_max[0],
          low: data.daily.temperature_2m_min[0],
          rainChance: data.daily.precipitation_probability_max?.[0] ?? null,
          sunrise: data.daily.sunrise[0],
          sunset: data.daily.sunset[0],
        });
        setStatus('ready');
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setStatus('error');
      });

    return () => controller.abort();
  }, [city, refreshToken]);

  return { weather, status };
}

function EmptyZone({ primary, onEdit }: { primary?: boolean; onEdit: () => void }) {
  return (
    <button
      onClick={onEdit}
      className={`group flex aspect-square h-full w-full flex-col items-center justify-center overflow-hidden border border-dashed text-center transition-colors hover:border-primary/50 hover:bg-card/75 ${
        primary
          ? 'rounded-[clamp(1.25rem,3vw,2rem)] border-foreground/20 bg-card/40 p-6'
          : 'rounded-[clamp(0.8rem,2vw,1.5rem)] bg-card/35 p-2 sm:p-4'
      }`}
    >
      <span className="grid size-11 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors group-hover:text-primary">
        <Plus className="size-4" />
      </span>
      <strong className="mt-3 font-heading text-sm font-medium sm:text-base">{primary ? 'Choose a primary place' : 'Add a place'}</strong>
      {primary && <span className="mt-1 max-w-52 text-xs leading-5 text-muted-foreground">Search any city to bring this zone to life.</span>}
    </button>
  );
}

function PrimaryZone({ city, now, refreshToken, onEdit }: { city: City | null; now: Date | null; refreshToken: number; onEdit: () => void }) {
  const { weather, status } = useWeather(city, refreshToken);
  if (!city) return <EmptyZone primary onEdit={onEdit} />;
  const daylight = isDaylight(now, city.timezone, weather);

  return (
    <article className={`zone-surface primary-zone relative aspect-square h-full overflow-hidden rounded-[clamp(1.25rem,3vw,2rem)] p-[clamp(1.25rem,4cqi,2.25rem)] ${daylight ? 'zone-surface-day' : 'zone-surface-night'}`}>
      <div className="relative z-10 flex h-full min-h-0 flex-col justify-between">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-[clamp(1.35rem,5cqi,2rem)] font-medium tracking-[-0.045em]">{city.name}</h2>
            <p className="zone-muted mt-1 text-[clamp(0.68rem,2cqi,0.875rem)]">{formatTileDate(now, city.timezone)}</p>
            <p className="zone-subtle mt-0.5 text-[clamp(0.6rem,1.8cqi,0.75rem)]">{city.admin1 ? `${city.admin1}, ` : ''}{city.country}</p>
          </div>
          <button onClick={onEdit} className="zone-control flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium backdrop-blur transition-colors" aria-label="Change primary city">
            <Settings2 className="size-3.5" /> Change
          </button>
        </div>

        <div className="py-[clamp(0.5rem,4cqi,2rem)]">
          <div className="flex items-end justify-between gap-6">
            <p className="font-heading text-[clamp(3.4rem,15cqi,8.5rem)] font-light leading-[0.8] tracking-[-0.09em]">{formatClock(now, city.timezone)}</p>
            <div className="min-w-24 pb-1 text-right">
              {status === 'loading' && <LoaderCircle className="zone-muted ml-auto mb-4 size-7 animate-spin" />}
              {status === 'error' && <Cloud className="zone-muted ml-auto mb-4 size-7" />}
              {weather && status === 'ready' && (
                <>
                  <WeatherIcon code={weather.weatherCode} isDay={weather.isDay} className="ml-auto mb-3 size-9 text-amber-200" />
                  <p className="font-heading text-[clamp(1.7rem,5cqi,2.5rem)] font-medium leading-none tracking-[-0.05em]">{Math.round(weather.temperature)}°F</p>
                  <p className="zone-muted mt-1 text-[clamp(0.7rem,2cqi,0.9rem)]">{celsius(weather.temperature)}°C</p>
                  <p className="zone-muted mt-1 max-w-28 truncate text-[clamp(0.65rem,2cqi,0.875rem)]">{weatherLabel(weather.weatherCode)}</p>
                </>
              )}
              {status === 'error' && <p className="zone-muted text-sm">Weather unavailable</p>}
            </div>
          </div>
          <p className="zone-muted mt-[clamp(0.5rem,3cqi,1.5rem)] text-[clamp(0.65rem,2cqi,0.875rem)]">{city.timezone.replaceAll('_', ' ')}</p>
        </div>

        <div className="zone-divider grid grid-cols-4 gap-[clamp(0.35rem,2cqi,1rem)] border-t pt-[clamp(0.65rem,3cqi,1.25rem)] text-[clamp(0.6rem,2cqi,0.875rem)]">
          <div className="flex items-center gap-2.5"><Sunrise className="size-4 text-amber-500" /><span><small className="zone-subtle block text-[10px] uppercase tracking-[0.12em]">Sunrise</small><strong className="font-medium">{weather ? shortSolarTime(weather.sunrise) : '—:—'}</strong></span></div>
          <div className="flex items-center gap-2.5"><Sunset className="size-4 text-orange-400" /><span><small className="zone-subtle block text-[10px] uppercase tracking-[0.12em]">Sunset</small><strong className="font-medium">{weather ? shortSolarTime(weather.sunset) : '—:—'}</strong></span></div>
          <div><small className="zone-subtle block text-[10px] uppercase tracking-[0.12em]">High / low</small><strong className="block font-medium">{weather ? `${Math.round(weather.high)}° / ${Math.round(weather.low)}°F` : '— / —'}</strong><span className="zone-muted block">{weather ? `${celsius(weather.high)}° / ${celsius(weather.low)}°C` : '— / —'}</span></div>
          <div><small className="zone-subtle block text-[10px] uppercase tracking-[0.12em]">Feels like</small><strong className="block font-medium">{weather ? `${Math.round(weather.apparentTemperature)}°F` : '—'}</strong><span className="zone-muted block">{weather ? `${celsius(weather.apparentTemperature)}°C` : '—'}</span></div>
        </div>
      </div>
    </article>
  );
}

function SecondaryZone({ city, now, refreshToken, onEdit }: { city: City | null; now: Date | null; refreshToken: number; onEdit: () => void }) {
  const { weather, status } = useWeather(city, refreshToken);
  if (!city) return <EmptyZone onEdit={onEdit} />;
  const daylight = isDaylight(now, city.timezone, weather);

  return (
    <article className={`zone-surface secondary-zone flex aspect-square h-full min-h-0 flex-col justify-between overflow-hidden rounded-[clamp(0.8rem,2vw,1.5rem)] border p-[clamp(0.5rem,6cqi,1.35rem)] ${daylight ? 'zone-surface-day' : 'zone-surface-night'}`}>
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <h2 className="truncate font-heading text-[clamp(0.72rem,8cqi,1.25rem)] font-medium tracking-[-0.035em]">{city.name}</h2>
          <p className="zone-muted mt-0.5 truncate text-[clamp(0.46rem,5cqi,0.7rem)]">{formatTileDate(now, city.timezone, true)}</p>
        </div>
        <button onClick={onEdit} aria-label={`Change ${city.name}`} className="zone-control grid size-[clamp(1.25rem,14cqi,2rem)] shrink-0 place-items-center rounded-full border transition-colors"><Settings2 className="size-[clamp(0.65rem,7cqi,0.875rem)]" /></button>
      </div>
      <div className="flex items-end justify-between gap-1">
        <div>
          <p className="font-heading text-[clamp(1.2rem,18cqi,3rem)] font-light leading-none tracking-[-0.07em]">{formatClock(now, city.timezone)}</p>
        </div>
        <div className="min-w-0 text-right">
          {status === 'loading' && <LoaderCircle className="zone-muted ml-auto size-5 animate-spin" />}
          {status === 'error' && <span className="zone-muted text-xs">Unavailable</span>}
          {weather && status === 'ready' && (
            <>
              <WeatherIcon code={weather.weatherCode} isDay={weather.isDay} className="ml-auto mb-0.5 size-[clamp(0.75rem,9cqi,1.25rem)] text-primary" />
              <div className="flex items-baseline justify-end gap-[clamp(0.25rem,3cqi,0.55rem)] whitespace-nowrap">
                <p className="text-[clamp(0.7rem,8cqi,1.1rem)] font-medium leading-none">{Math.round(weather.temperature)}°F</p>
                <p className="zone-muted text-[clamp(0.48rem,5cqi,0.68rem)]">{celsius(weather.temperature)}°C</p>
              </div>
            </>
          )}
        </div>
      </div>
      <p className="zone-muted truncate text-[clamp(0.48rem,5.5cqi,0.75rem)]">{weather ? weatherLabel(weather.weatherCode) : city.country}</p>
      <div className="zone-divider zone-muted grid grid-cols-2 gap-1 border-t pt-[clamp(0.25rem,4cqi,0.75rem)] text-[clamp(0.46rem,5.2cqi,0.72rem)]">
        <span className="flex items-center gap-1"><Sunrise className="size-[1em]" /> {weather ? shortSolarTime(weather.sunrise) : '—:—'}</span>
        <span className="flex items-center justify-end gap-1"><Sunset className="size-[1em]" /> {weather ? shortSolarTime(weather.sunset) : '—:—'}</span>
        <span className="col-span-2 grid grid-cols-2 items-baseline whitespace-nowrap text-center" aria-label="High and low temperatures">
          <strong className="zone-divider truncate border-r pr-1 font-medium">{weather ? `${Math.round(weather.high)}° / ${Math.round(weather.low)}°F` : '— / —'}</strong>
          <span className="zone-subtle truncate pl-1">{weather ? `${celsius(weather.high)}° / ${celsius(weather.low)}°C` : '— / —'}</span>
        </span>
      </div>
    </article>
  );
}

function CityPicker({ open, current, primary, onOpenChange, onSelect }: { open: boolean; current: City | null; primary: boolean; onOpenChange: (open: boolean) => void; onSelect: (city: City | null) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<City[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) {
      queueMicrotask(() => {
        setQuery('');
        setResults([]);
        setError(false);
      });
      return;
    }
    if (query.trim().length < 2) {
      queueMicrotask(() => {
        setResults([]);
        setLoading(false);
      });
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(false);
      const params = new URLSearchParams({ name: query.trim(), count: '8', language: 'en', format: 'json' });
      fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error('Search failed');
          return response.json() as Promise<{ results?: SearchResult[] }>;
        })
        .then((data: { results?: SearchResult[] }) => {
          setResults((data.results ?? []).map((result) => ({
            id: result.id,
            name: result.name,
            admin1: result.admin1,
            country: result.country ?? 'Unknown country',
            countryCode: result.country_code ?? '',
            latitude: result.latitude,
            longitude: result.longitude,
            timezone: result.timezone,
          })));
          setLoading(false);
        })
        .catch((requestError) => {
          if (requestError.name !== 'AbortError') {
            setError(true);
            setLoading(false);
          }
        });
    }, 320);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  function choose(city: City | null) {
    onSelect(city);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-[1.5rem] p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border p-6 pb-5">
          <DialogTitle className="font-heading text-xl tracking-[-0.03em]">{current ? `Change ${current.name}` : 'Add a place'}</DialogTitle>
          <DialogDescription>{primary ? 'This place anchors your Today page.' : 'Choose a city for this space, or leave it open.'}</DialogDescription>
          <div className="relative pt-2">
            <Search className="absolute left-3 top-[1.05rem] size-4 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search city or postal code" className="h-11 rounded-xl bg-background pl-9 pr-9" />
            {query && <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-3 top-[1.05rem] text-muted-foreground"><X className="size-4" /></button>}
          </div>
        </DialogHeader>

        {query.trim().length >= 2 && <div className="max-h-[360px] overflow-y-auto p-3">
          {loading && <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Searching places</div>}
          {error && <div className="py-12 text-center text-sm text-muted-foreground">Search is unavailable right now. Try again shortly.</div>}
          {!loading && !error && results.length === 0 && <div className="py-12 text-center text-sm text-muted-foreground">No matching places found.</div>}
          {!loading && !error && results.map((city) => (
            <button key={`${city.id}-${city.latitude}`} onClick={() => choose(city)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground"><MapPin className="size-4" /></span>
              <span className="min-w-0 flex-1"><strong className="block truncate text-sm font-medium">{city.name}</strong><small className="block truncate text-xs text-muted-foreground">{city.admin1 ? `${city.admin1}, ` : ''}{city.country}</small></span>
              {current?.id === city.id && <Check className="size-4 text-primary" />}
            </button>
          ))}
        </div>}

        {current && (
          <div className="border-t border-border p-3">
            <Button variant="ghost" onClick={() => choose(null)} className="h-10 w-full justify-start rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive">
              <Trash2 data-icon="inline-start" /> Leave this zone empty
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Home() {
  const [cities, setCities] = useState<(City | null)[]>(DEFAULT_CITIES);
  const [now, setNow] = useState<Date | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const initialClock = window.setTimeout(() => setNow(new Date()), 0);
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.clearTimeout(initialClock);
      window.clearInterval(clock);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/preferences', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Preferences unavailable');
        return response.json() as Promise<{ cities?: (City | null)[] }>;
      })
      .then((data: { cities?: (City | null)[] }) => {
        if (Array.isArray(data.cities) && data.cities.length === 4) setCities(data.cities);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function updateCity(index: number, city: City | null) {
    const next = cities.map((item, itemIndex) => itemIndex === index ? city : item);
    setCities(next);
    try {
      const response = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cities: next }),
      });
      if (!response.ok) throw new Error('Save failed');
    } catch {}
  }

  return (
    <main className="h-dvh overflow-hidden bg-background px-4 text-foreground sm:px-8 lg:px-12">
      <header className="mx-auto flex h-16 max-w-[1480px] items-center justify-between border-b border-border/70">
        <Link href="/" className="font-heading text-lg font-semibold tracking-[-0.04em]">surmyi<span className="text-primary">.</span></Link>
        <nav aria-label="Primary navigation" className="flex items-center gap-1 text-sm">
          <a href="#home" className="rounded-full bg-foreground px-4 py-2 text-background">Home</a>
        </nav>
        <button onClick={() => setRefreshToken((token) => token + 1)} aria-label="Refresh weather" className="grid size-9 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground">
          <RefreshCw className="size-4" />
        </button>
      </header>

      <section id="home" className="mx-auto flex h-[calc(100dvh-4rem)] max-w-[1480px] min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="zone-board">
          <div className="zone-primary">
            <PrimaryZone city={cities[0]} now={now} refreshToken={refreshToken} onEdit={() => setEditingIndex(0)} />
          </div>
          <div className="zone-secondary-grid">
            {[1, 2, 3].map((index) => (
              <div className="zone-secondary-item" key={index}>
                <SecondaryZone city={cities[index]} now={now} refreshToken={refreshToken} onEdit={() => setEditingIndex(index)} />
              </div>
            ))}
          </div>
          </div>
        </div>
      </section>

      <a className="fixed bottom-1.5 right-3 text-[9px] text-muted-foreground/45 underline-offset-2 hover:underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather by Open-Meteo</a>

      <CityPicker
        open={editingIndex !== null}
        current={editingIndex === null ? null : cities[editingIndex]}
        primary={editingIndex === 0}
        onOpenChange={(open) => { if (!open) setEditingIndex(null); }}
        onSelect={(city) => { if (editingIndex !== null) void updateCity(editingIndex, city); }}
      />
    </main>
  );
}
