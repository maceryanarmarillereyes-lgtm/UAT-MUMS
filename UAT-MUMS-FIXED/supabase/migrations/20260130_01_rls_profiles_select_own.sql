DROP POLICY IF EXISTS profiles_select_own ON public.mums_profiles;
CREATE POLICY profiles_select_own
ON public.mums_profiles
FOR SELECT
USING (user_id = (select auth.uid()));
ALTER TABLE public.mums_profiles ENABLE ROW LEVEL SECURITY;
