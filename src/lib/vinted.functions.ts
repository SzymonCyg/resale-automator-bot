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

export const listAllItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("vinted_items")
      .select("*, vinted_accounts(label,country,vinted_username)")
      .order("created_at_vinted", { ascending: false, nullsFirst: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    return data;
  });

// ============ DASHBOARD ============

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [accounts, items] = await Promise.all([
      context.supabase.from("vinted_accounts").select("id", { count: "exact", head: true }),
      context.supabase.from("vinted_items").select("id", { count: "exact", head: true }),
    ]);
    return {
      accountsCount: accounts.count ?? 0,
      itemsCount: items.count ?? 0,
    };
  });

// ============ TASKS ============

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string; type: string; payload: Record<string, unknown>; scheduledFor?: string }) =>
    z.object({
      accountId: z.string().uuid(),
      type: z.string(),
      payload: z.record(z.unknown()),
      scheduledFor: z.string().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { error, data: task } = await context.supabase.from("tasks").insert({
      account_id: data.accountId,
      user_id: context.userId,
      type: data.type,
      payload: data.payload as never,
      scheduled_for: data.scheduledFor || new Date().toISOString(),
      status: "pending",
    }).select().single();
    if (error) throw new Error(error.message);
    return task;
  });

export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string }) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tasks")
      .select("*")
      .eq("account_id", data.accountId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return rows;
  });

export const listActionLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string }) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("action_logs")
      .select("*")
      .eq("account_id", data.accountId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return rows;
  });

export const runTaskRunner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const SUPABASE_URL = process.env.SUPABASE_URL!;
    const SUPABASE_ANON = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const { data: { session } } = await context.supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/task-runner`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session?.access_token ?? ""}`,
        "apikey": SUPABASE_ANON,
      },
    });
    return await res.json();
  });

export const deleteItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string; itemId: string; vintedItemId: string; title?: string }) =>
    z.object({ accountId: z.string().uuid(), itemId: z.string().uuid(), vintedItemId: z.string(), title: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: task } = await context.supabase.from("tasks").insert({
      account_id: data.accountId,
      user_id: context.userId,
      type: "delete_item",
      payload: { item_id: data.itemId, vinted_item_id: data.vintedItemId, title: data.title },
      status: "pending",
    }).select().single();
    return { ok: true, taskId: task?.id };
  });

export const bumpItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string; itemId: string; vintedItemId: string }) =>
    z.object({ accountId: z.string().uuid(), itemId: z.string().uuid(), vintedItemId: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase.from("tasks").insert({
      account_id: data.accountId,
      user_id: context.userId,
      type: "bump_item",
      payload: { item_id: data.itemId, vinted_item_id: data.vintedItemId },
      status: "pending",
    });
    return { ok: true };
  });
