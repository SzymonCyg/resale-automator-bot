
-- =====================
-- profiles
-- =====================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_select_own_profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "users_update_own_profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "users_insert_own_profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- updated_at helper
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_touch BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- auto profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================
-- vinted_accounts
-- =====================
CREATE TABLE public.vinted_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  vinted_user_id TEXT,
  vinted_username TEXT,
  country TEXT NOT NULL DEFAULT 'pl',
  status TEXT NOT NULL DEFAULT 'pending',
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vinted_accounts TO authenticated;
GRANT ALL ON public.vinted_accounts TO service_role;
ALTER TABLE public.vinted_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_accounts_all" ON public.vinted_accounts FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_vinted_accounts_touch BEFORE UPDATE ON public.vinted_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_vinted_accounts_user ON public.vinted_accounts(user_id);

-- =====================
-- vinted_items
-- =====================
CREATE TABLE public.vinted_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.vinted_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vinted_item_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  price NUMERIC(12,2),
  currency TEXT,
  brand TEXT,
  size_title TEXT,
  status TEXT,
  url TEXT,
  photo_url TEXT,
  views INT DEFAULT 0,
  favourite_count INT DEFAULT 0,
  created_at_vinted TIMESTAMPTZ,
  last_bumped_at TIMESTAMPTZ,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, vinted_item_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vinted_items TO authenticated;
GRANT ALL ON public.vinted_items TO service_role;
ALTER TABLE public.vinted_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_items_all" ON public.vinted_items FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_vinted_items_touch BEFORE UPDATE ON public.vinted_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_vinted_items_account ON public.vinted_items(account_id);
CREATE INDEX idx_vinted_items_user ON public.vinted_items(user_id);

-- =====================
-- auto_bump_settings
-- =====================
CREATE TABLE public.auto_bump_settings (
  account_id UUID PRIMARY KEY REFERENCES public.vinted_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  interval_hours INT NOT NULL DEFAULT 6 CHECK (interval_hours >= 3),
  item_ids UUID[] NOT NULL DEFAULT '{}',
  bump_all BOOLEAN NOT NULL DEFAULT false,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_bump_settings TO authenticated;
GRANT ALL ON public.auto_bump_settings TO service_role;
ALTER TABLE public.auto_bump_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_bump_all" ON public.auto_bump_settings FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_auto_bump_touch BEFORE UPDATE ON public.auto_bump_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =====================
-- reply_rules
-- =====================
CREATE TABLE public.reply_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.vinted_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  priority INT NOT NULL DEFAULT 0,
  match_type TEXT NOT NULL DEFAULT 'contains' CHECK (match_type IN ('contains','exact','regex','starts_with')),
  pattern TEXT NOT NULL,
  response_template TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reply_rules TO authenticated;
GRANT ALL ON public.reply_rules TO service_role;
ALTER TABLE public.reply_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_rules_all" ON public.reply_rules FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_reply_rules_touch BEFORE UPDATE ON public.reply_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_reply_rules_account ON public.reply_rules(account_id);

-- =====================
-- reply_fallback
-- =====================
CREATE TABLE public.reply_fallback (
  account_id UUID PRIMARY KEY REFERENCES public.vinted_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  template TEXT,
  auto_send BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reply_fallback TO authenticated;
GRANT ALL ON public.reply_fallback TO service_role;
ALTER TABLE public.reply_fallback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_fallback_all" ON public.reply_fallback FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_reply_fallback_touch BEFORE UPDATE ON public.reply_fallback
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =====================
-- action_logs
-- =====================
CREATE TABLE public.action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES public.vinted_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'info',
  item_id UUID REFERENCES public.vinted_items(id) ON DELETE SET NULL,
  message TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.action_logs TO authenticated;
GRANT ALL ON public.action_logs TO service_role;
ALTER TABLE public.action_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_logs_select" ON public.action_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own_logs_insert" ON public.action_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_logs_delete" ON public.action_logs FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_action_logs_user_created ON public.action_logs(user_id, created_at DESC);
CREATE INDEX idx_action_logs_account_created ON public.action_logs(account_id, created_at DESC);

-- =====================
-- extension_devices
-- =====================
CREATE TABLE public.extension_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  user_agent TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.extension_devices TO authenticated;
GRANT ALL ON public.extension_devices TO service_role;
ALTER TABLE public.extension_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_devices_all" ON public.extension_devices FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =====================
-- pairing_codes
-- =====================
CREATE TABLE public.pairing_codes (
  code TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pairing_codes TO authenticated;
GRANT ALL ON public.pairing_codes TO service_role;
ALTER TABLE public.pairing_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_pairing_all" ON public.pairing_codes FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =====================
-- tasks
-- =====================
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.vinted_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_tasks_all" ON public.tasks FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_tasks_user_status ON public.tasks(user_id, status, scheduled_for);
