import type { TaskHandler } from 'payload';
import { UsageAccumulator, AggregateDailyInput, AggregateDailyOutput } from '@/custom-types';
import { getLimaDayUTCWindow } from '@/shared/time_converting/limaTypes';

export const aggregateResourceUsageDailyHandler: TaskHandler<'aggregate_resource_usage_daily'> = async ({ input, req }) => {
  const { startUtc, endUtcExcl, usageDateUtcISO } = getLimaDayUTCWindow((input as AggregateDailyInput | undefined)?.usage_date);
  req.payload.logger.info(`[aggregate_resource_usage_daily job executed] window= from ${startUtc.toISOString()} ---→ ${endUtcExcl.toISOString()}`);

  // Acumular por tenant
  const accByTenant = new Map<string, UsageAccumulator>();

  const LIMIT = 350;
  let page = 1;

  // Paginado defensivo + orden determinístico (evita saltos si entran docs nuevos)
  for (;;) {
    const batch = await req.payload.find({
      collection: 'encryption_operations',
      depth: 0,
      limit: LIMIT,
      page,
      // orden determinístico (coincide con el índice compuesto)
      sort: ['operation_timestamp', 'createdAt'],
      where: {
        and: [{ operation_timestamp: { greater_than_equal: startUtc.toISOString() } }, { operation_timestamp: { less_than: endUtcExcl.toISOString() } }]
      }
    });

    const docs = (batch?.docs ?? []) as Array<{
      tenant_id: string | { id?: string; value?: string };
      operation_type: 'encrypt' | 'decrypt';
      file_count: number;
      total_size_mb: number;
      processing_time_ms: number;
      success: boolean;
      file_types_count?: Record<string, number>;
      file_types?: Array<{ value: string }>;
    }>;

    if (!docs.length) break;

    for (const doc of docs) {
      const tenantId = typeof doc.tenant_id === 'string' ? doc.tenant_id : (doc.tenant_id?.id ?? doc.tenant_id?.value ?? '');

      if (!tenantId) continue;

      let acc = accByTenant.get(tenantId);
      if (!acc) {
        acc = {
          tenant_id: tenantId,
          total_operations: 0,
          encrypt_operations: 0,
          decrypt_operations: 0,
          total_mb_processed: 0, // MB
          total_files_processed: 0,
          failed_operations: 0,
          sum_processing_time_ms: 0,
          file_type_breakdown: {}
        };
        accByTenant.set(tenantId, acc);
      }

      acc.total_operations += 1;
      acc.total_files_processed += Number.isFinite(doc.file_count) ? doc.file_count : 0;
      acc.sum_processing_time_ms += Number.isFinite(doc.processing_time_ms) ? doc.processing_time_ms : 0;
      if (doc.operation_type === 'encrypt') acc.encrypt_operations += 1;
      if (doc.operation_type === 'decrypt') acc.decrypt_operations += 1;
      if (doc.success === false) acc.failed_operations += 1;

      // ⬇️ Sumar en MB (no convertir a bytes)
      const mb = Number.isFinite(doc.total_size_mb) ? Number(doc.total_size_mb) : 0;
      acc.total_mb_processed += Math.max(0, mb);

      // Merge de conteos por tipo
      if (doc.file_types_count && typeof doc.file_types_count === 'object') {
        for (const [ext, count] of Object.entries(doc.file_types_count)) {
          acc.file_type_breakdown[ext] = (acc.file_type_breakdown[ext] ?? 0) + (Number(count) || 0);
        }
      } else if (Array.isArray(doc.file_types)) {
        for (const ft of doc.file_types) {
          const ext = (ft?.value || '').toLowerCase();
          if (!ext) continue;
          acc.file_type_breakdown[ext] = (acc.file_type_breakdown[ext] ?? 0) + 1;
        }
      }
    }

    if (!batch.hasNextPage) break;
    page += 1;
  }

  // 🚩 salida temprana si no hubo operaciones en la ventana
  if (accByTenant.size === 0) {
    req.payload.logger.info(`[aggregate_resource_usage_daily] no ops in window ${startUtc.toISOString()} → ${endUtcExcl.toISOString()}`);
    return {
      output: {
        usage_date_utc: usageDateUtcISO,
        tenants_processed: 0,
        docs_upserted: 0
      } as AggregateDailyOutput
    };
  }

  // Upsert por tenant en resource_usage_daily
  let docs_upserted = 0;

  for (const [, acc] of accByTenant) {
    const avg = acc.total_operations > 0 ? Math.round(acc.sum_processing_time_ms / acc.total_operations) : 0;

    const existing = await req.payload.find({
      collection: 'resource_usage_daily',
      depth: 0,
      limit: 1,
      where: {
        and: [{ tenant_id: { equals: acc.tenant_id } }, { usage_date: { equals: usageDateUtcISO } }]
      }
    });

    const data = {
      tenant_id: acc.tenant_id,
      usage_date: usageDateUtcISO,
      total_operations: acc.total_operations,
      encrypt_operations: acc.encrypt_operations,
      decrypt_operations: acc.decrypt_operations,
      total_mb_processed: Number(acc.total_mb_processed.toFixed(4)),
      total_files_processed: acc.total_files_processed,
      failed_operations: acc.failed_operations,
      avg_processing_time: avg,
      file_type_breakdown: acc.file_type_breakdown
    };

    if (existing.docs?.[0]) {
      await req.payload.update({
        id: (existing.docs[0] as any).id,
        collection: 'resource_usage_daily',
        data
      });
    } else {
      await req.payload.create({
        collection: 'resource_usage_daily',
        data
      });
    }

    docs_upserted += 1;
  }

  req.payload.logger.info(
    `[aggregate_resource_usage_daily result] upserts=${docs_upserted} tenants=${accByTenant.size} window= from ${startUtc.toISOString()} ---→ ${endUtcExcl.toISOString()}`
  );

  return {
    output: {
      usage_date_utc: usageDateUtcISO,
      tenants_processed: accByTenant.size,
      docs_upserted
    } as AggregateDailyOutput
  };
};
