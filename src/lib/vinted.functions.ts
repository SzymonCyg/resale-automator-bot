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
