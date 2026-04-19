-- Performance indexes for sync/pull and sync/push endpoints.
-- Safe additive migration: indexes only, no drops.

CREATE INDEX IF NOT EXISTS idx_mums_documents_updated_at
  ON public.mums_documents(updated_at);

CREATE INDEX IF NOT EXISTS idx_mums_documents_updated_by_user_id
  ON public.mums_documents(updated_by_user_id);

CREATE INDEX IF NOT EXISTS idx_mums_documents_key
  ON public.mums_documents(key);

CREATE INDEX IF NOT EXISTS idx_mums_documents_updated_by_user_id_updated_at_desc
  ON public.mums_documents(updated_by_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_mums_profiles_user_id
  ON public.mums_profiles(user_id);
