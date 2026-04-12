interface AppConfig {
  port: number;
  ghl?: {
    apiKey?: string;
    locationId?: string;
    dryRun?: boolean;
  };
}

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  cached = {
    port: Number(process.env.PORT ?? 3100),
    ghl: {
      apiKey: process.env.GHL_API_KEY,
      locationId: process.env.GHL_LOCATION_ID,
      dryRun: process.env.GHL_DRY_RUN === "true" || !process.env.GHL_API_KEY,
    },
  };
  return cached;
}
