import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ============ ACCOUNTS ============

export const listAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("vinted_accounts")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });

export const getAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string }) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: a, error } = await context.supabase
      .from("vinted_accounts")
      .select("*")
      .eq("id", data.accountId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!a) throw new Error("Konto nie znalezione");
    return a;
  });

export const createAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { label: string; country: string }) =>
    z.object({ label: z.string().min(1).max(80), country: z.string().min(2).max(8) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("vinted_accounts")
      .insert({ label: data.label, country: data.country, user_id: context.userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string }) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("vinted_accounts").delete().eq("id", data.accountId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ ITEMS ============

export const listItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string }) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("vinted_items")
      .select("*")
      .eq("account_id", data.accountId)
      .order("created_at_vinted", { ascending: false, nullsFirst: false });
    if (error) throw new Error(error.message);
    return rows;
  });

// ============ AUTO-BUMP ============

export const getBumpSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string }) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("auto_bump_settings")
      .select("*")
      .eq("account_id", data.accountId)
      .maybeSingle();
    return row;
  });

export const saveBumpSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    accountId: string;
    enabled: boolean;
    intervalHours: number;
    bumpAll: boolean;
    itemIds: string[];
  }) =>
    z
      .object({
        accountId: z.string().uuid(),
        enabled: z.boolean(),
        intervalHours: z.number().int().min(3).max(168),
        bumpAll: z.boolean(),
        itemIds: z.array(z.string().uuid()),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload = {
      account_id: data.accountId,
      user_id: context.userId,
      enabled: data.enabled,
      interval_hours: data.intervalHours,
      bump_all: data.bumpAll,
      item_ids: data.itemIds,
      next_run_at: data.enabled
        ? new Date(Date.now() + data.intervalHours * 3600_000).toISOString()
        : null,
    };
    const { data: row, error } = await context.supabase
      .from("auto_bump_settings")
      .upsert(payload, { onConflict: "account_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ============ REPLY RULES ============

export const listRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string }) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("reply_rules")
      .select("*")
      .eq("account_id", data.accountId)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows;
  });

export const saveRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id?: string;
    accountId: string;
    matchType: "contains" | "exact" | "regex" | "starts_with";
    pattern: string;
    responseTemplate: string;
    priority: number;
    enabled: boolean;
  }) =>
    z
      .object({
        id: z.string().uuid().optional(),
        accountId: z.string().uuid(),
        matchType: z.enum(["contains", "exact", "regex", "starts_with"]),
        pattern: z.string().min(1).max(500),
        responseTemplate: z.string().min(1).max(2000),
        priority: z.number().int().min(0).max(1000),
        enabled: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const row = {
      account_id: data.accountId,
      user_id: context.userId,
      match_type: data.matchType,
      pattern: data.pattern,
      response_template: data.responseTemplate,
      priority: data.priority,
      enabled: data.enabled,
    };
    if (data.id) {
      const { data: updated, error } = await context.supabase
        .from("reply_rules")
        .update(row)
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return updated;
    }
    const { data: inserted, error } = await context.supabase
      .from("reply_rules")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

export const deleteRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("reply_rules").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getFallback = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string }) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("reply_fallback")
      .select("*")
      .eq("account_id", data.accountId)
      .maybeSingle();
    return row;
  });

export const saveFallback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string; enabled: boolean; template: string; autoSend: boolean }) =>
    z
      .object({
        accountId: z.string().uuid(),
        enabled: z.boolean(),
        template: z.string().max(2000),
        autoSend: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("reply_fallback")
      .upsert(
        {
          account_id: data.accountId,
          user_id: context.userId,
          enabled: data.enabled,
          template: data.template,
          auto_send: data.autoSend,
        },
        { onConflict: "account_id" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ============ LOGS ============

export const listLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string; limit?: number }) =>
    z.object({ accountId: z.string().uuid(), limit: z.number().int().max(500).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("action_logs")
      .select("*")
      .eq("account_id", data.accountId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (error) throw new Error(error.message);
    return rows;
  });

// ============ EXTENSION PAIRING ============

export const generatePairingCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const code = Array.from({ length: 6 }, () =>
      "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".charAt(Math.floor(Math.random() * 32)),
    ).join("");
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error } = await context.supabase
      .from("pairing_codes")
      .insert({ code, user_id: context.userId, expires_at: expires });
    if (error) throw new Error(error.message);
    return { code, expiresAt: expires };
  });

export const listDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("extension_devices")
      .select("id,label,user_agent,last_seen_at,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });

export const revokeDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("extension_devices").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ DASHBOARD STATS ============

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [accounts, items, logs, devices] = await Promise.all([
      context.supabase.from("vinted_accounts").select("id", { count: "exact", head: true }),
      context.supabase.from("vinted_items").select("id", { count: "exact", head: true }),
      context.supabase
        .from("action_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10),
      context.supabase.from("extension_devices").select("id", { count: "exact", head: true }),
    ]);
    return {
      accountsCount: accounts.count ?? 0,
      itemsCount: items.count ?? 0,
      devicesCount: devices.count ?? 0,
      recentLogs: logs.data ?? [],
    };
  });
