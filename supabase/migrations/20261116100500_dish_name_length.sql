-- Bound a dish name in the database to the same 80 characters the dish editor allows
-- (dish-editor.tsx maxLength, and the trimmed .max(80) in dashboard/actions.ts).
-- Until now only an empty name was refused (init.sql), so seed, SQL or a future import could save a
-- longer one (step 3 break-ui, wave-2-integration-report.md #2). Names are trimmed before they are
-- saved, so the editor never sends more than this allows.
-- Preflight: supabase/preflight/name-limit.sql lists any existing name over 80; this fails if one exists.
alter table public.dishes
  add constraint dishes_name_length check (char_length(name) <= 80);
