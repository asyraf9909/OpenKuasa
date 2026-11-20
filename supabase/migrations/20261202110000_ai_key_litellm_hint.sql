-- Workspace AI keys: the hint's shape follows the key the app now stores.
--
-- What changes. The app stopped asking for an OpenRouter key (`sk-or-v1-…`) and
-- stores a key for the LiteLLM proxy that serves the models, whose master and
-- virtual keys both begin `sk-`. Only the hint's pattern changes: it was
-- `^sk-or-…[A-Za-z0-9_-]{4}$`, which refuses every LiteLLM key, and is now
-- `^sk-…[A-Za-z0-9_-]{4}$`. The sealed value's own check, the length cap and
-- everything else in the function are the text of 20261103110000, which this
-- migration replaces.
--
-- Why a new file and not an edit. A migration that has been applied is history;
-- the function it left in the database is what this replaces, so an install that
-- has run 20261103110000 and one that has not both end up with the same function.
--
-- Safe with the deployed app, in either order. Before it is applied, saving a
-- LiteLLM key fails the way saving any key failed before 20261103110000 (the
-- hint is refused) while chat and agents keep reading and opening keys already
-- stored; after it, saving works. Existing OpenRouter-shaped hints still satisfy
-- the new pattern (`sk-or-…aaaa` matches `^sk-…[A-Za-z0-9_-]{4}$`), so a
-- workspace that saved a key under the old app is not locked out.
--
-- Only the server may call it; the grants are stated again so this file says so
-- on its own.

create or replace function public.set_org_ai_key(
  p_org uuid,
  p_actor uuid,
  p_ciphertext text,
  p_hint text
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'not allowed';
  end if;
  if p_org is null or p_actor is null or not exists (
    select 1 from public.org_members m
     where m.org_id = p_org and m.user_id = p_actor and m.role in ('owner', 'admin')
  ) then
    raise exception 'not allowed';
  end if;
  -- v2.<12-byte iv>.<16-byte tag>.<ciphertext>, base64url parts. No bound in
  -- the pattern may pass 255, so the size is capped on the whole value.
  if (p_ciphertext ~ '^v2\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$') is not true
     or length(p_ciphertext) > 2000
     or (p_hint ~ '^sk-…[A-Za-z0-9_-]{4}$') is not true then
    raise exception 'invalid key';
  end if;

  insert into public.org_ai_keys (org_id, ciphertext, key_hint, updated_by, updated_at)
  values (p_org, p_ciphertext, p_hint, p_actor, now())
  on conflict (org_id) do update
    set ciphertext = excluded.ciphertext,
        key_hint = excluded.key_hint,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  insert into public.activity_log (org_id, actor_id, actor_name, action, target, category)
  values (p_org, p_actor, private.display_name(p_actor), 'Set the workspace AI key', p_hint, 'security');
end; $$;

-- As 20261103110000 left them. `create or replace` keeps a function's grants;
-- they are stated again so this file says on its own who may call it.
revoke all on function public.set_org_ai_key(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_org_ai_key(uuid, uuid, text, text) to service_role;
