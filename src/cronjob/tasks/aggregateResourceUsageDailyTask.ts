// src/jobs/aggregate_resource_usage_daily.ts
import type { TaskConfig } from 'payload';
import { aggregateResourceUsageDailyHandler } from '@/cronjob/handler/aggregateResourceUsageDaily';

// ---------- Definición del Task con schedule a las 03:00 ----------
export const aggregateResourceUsageDailyTask: TaskConfig<'aggregate_resource_usage_daily'> = {
  slug: 'aggregate_resource_usage_daily',
  label: 'Aggregate Resource Usage (daily)',
  interfaceName: 'AggregateResourceUsageDailyTask',
  inputSchema: [{ name: 'usage_date', type: 'date', required: false }],
  outputSchema: [
    { name: 'usage_date_utc', type: 'text', required: true },
    { name: 'tenants_processed', type: 'number', required: true },
    { name: 'docs_upserted', type: 'number', required: true }
  ],
  // Encolar automáticamente un job cada día a las 03:00 (hora del servidor)
  schedule: [
    { cron: '0 3 * * *', queue: 'nightly' } // cron soportado en tasks; solo ENCOLA el job
  ],
  handler: aggregateResourceUsageDailyHandler
};
