-- Cleanup: zostawiamy tylko profiles, vinted_accounts, vinted_items
DROP TABLE IF EXISTS public.action_logs CASCADE;
DROP TABLE IF EXISTS public.auto_bump_settings CASCADE;
DROP TABLE IF EXISTS public.reply_rules CASCADE;
DROP TABLE IF EXISTS public.reply_fallback CASCADE;
DROP TABLE IF EXISTS public.pairing_codes CASCADE;
DROP TABLE IF EXISTS public.extension_devices CASCADE;
DROP TABLE IF EXISTS public.tasks CASCADE;

-- Dodaj kolumnę plan na profilu (na razie domyślnie 'free', UI nieaktywny)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

-- Upewnij się że vinted_accounts ma unique (user_id, vinted_username) dla auto-upsertu
CREATE UNIQUE INDEX IF NOT EXISTS vinted_accounts_user_username_uniq
  ON public.vinted_accounts(user_id, vinted_username)
  WHERE vinted_username IS NOT NULL;
