CREATE TABLE IF NOT EXISTS public.vinted_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vinted_user_id text NOT NULL,
  vinted_username text NOT NULL DEFAULT '',
  vinted_domain text NOT NULL DEFAULT 'vinted.pl',
  access_token text NOT NULL,
  refresh_token text,
  token_type text DEFAULT 'Bearer',
  expires_at timestamptz,
  raw_cookies text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, vinted_domain)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vinted_tokens TO authenticated;
GRANT ALL ON public.vinted_tokens TO service_role;

ALTER TABLE public.vinted_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own tokens" ON public.vinted_tokens
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER vinted_tokens_touch_updated_at
  BEFORE UPDATE ON public.vinted_tokens
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();