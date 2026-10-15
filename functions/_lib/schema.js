// Banco de dados do KIRA na Supabase: o painel mostra este SQL para o admin rodar uma vez no SQL Editor.
//
// Quem grava é só o servidor do KIRA: as políticas de escrita exigem o cabeçalho x-kira-server com a chave
// do servidor (o banco guarda só o SHA-256 dela). O navegador consegue apenas LER os próprios dados.
// Assim ninguém forja respostas da IA no histórico (que voltam como contexto) nem enche o banco por fora dos limites.

export const SCHEMA_VERSION = 1;

export function schemaSql(serverKeySha256) {
  if (!/^[0-9a-f]{64}$/.test(serverKeySha256)) throw new Error("hash inválido");
  return `-- KIRA: histórico das conversas, personalização e limites de uso.
-- Rode no SQL Editor da Supabase. Pode rodar de novo quando quiser: o script não apaga dados.

-- Conversas
create table if not exists public.kira_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'Nova conversa',
  summary text,               -- resumo das mensagens antigas (contexto de conversas longas)
  summary_until timestamptz,  -- o resumo cobre as mensagens até este momento
  active_reply uuid,          -- resposta sendo gerada agora (uma mais nova substitui a anterior)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kira_conversations_title_len check (char_length(title) <= 200)
);
-- Colunas novas em bancos criados por versões anteriores deste script
alter table public.kira_conversations add column if not exists active_reply uuid;
create index if not exists kira_conversations_user_updated_idx on public.kira_conversations (user_id, updated_at desc);

-- Mensagens
create table if not exists public.kira_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.kira_conversations (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role text not null,
  content text not null default '',
  thinking text,
  model text,
  status text not null default 'complete',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint kira_messages_role check (role in ('user', 'assistant')),
  constraint kira_messages_status check (status in ('complete', 'stopped', 'error'))
);
create index if not exists kira_messages_conversation_idx on public.kira_messages (conversation_id, created_at);
create index if not exists kira_messages_user_idx on public.kira_messages (user_id);

-- Personalização (o que o usuário conta sobre si para a KIRA)
create table if not exists public.kira_profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text,
  about text,
  updated_at timestamptz not null default now(),
  constraint kira_profiles_name_len check (char_length(display_name) <= 80),
  constraint kira_profiles_about_len check (char_length(about) <= 4000)
);

-- Uso de cada usuário (limites por hora e por dia)
create table if not exists public.kira_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null default 'message',
  created_at timestamptz not null default now()
);
create index if not exists kira_usage_user_idx on public.kira_usage (user_id, kind, created_at desc);

-- Versão do banco (o KIRA confere antes de usar)
create table if not exists public.kira_meta (key text primary key, value text not null);
insert into public.kira_meta (key, value) values ('schema', '${SCHEMA_VERSION}')
  on conflict (key) do update set value = excluded.value;

-- Chave do servidor: só o SHA-256, numa tabela que ninguém lê pela API
create table if not exists public.kira_secrets (key text primary key, value text not null);
insert into public.kira_secrets (key, value) values ('server_key_sha256', '${serverKeySha256}')
  on conflict (key) do update set value = excluded.value;

create or replace function public.kira_is_server() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.kira_secrets s
    where s.key = 'server_key_sha256'
      and s.value = encode(pg_catalog.sha256(convert_to(coalesce(
        nullif(current_setting('request.headers', true), '')::json ->> 'x-kira-server', ''), 'UTF8')), 'hex')
  );
$$;

-- A conversa sobe na lista quando recebe mensagem
create or replace function public.kira_touch_conversation() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.kira_conversations
     set updated_at = greatest(updated_at, new.created_at)
   where id = new.conversation_id;
  return new;
end;
$$;
drop trigger if exists kira_messages_touch on public.kira_messages;
create trigger kira_messages_touch after insert on public.kira_messages
  for each row execute function public.kira_touch_conversation();

-- Permissões: o navegador só lê os próprios dados; gravar exige a chave do servidor
alter table public.kira_conversations enable row level security;
alter table public.kira_messages enable row level security;
alter table public.kira_profiles enable row level security;
alter table public.kira_usage enable row level security;
alter table public.kira_meta enable row level security;
alter table public.kira_secrets enable row level security;

revoke all on public.kira_conversations, public.kira_messages, public.kira_profiles,
  public.kira_usage, public.kira_meta, public.kira_secrets from anon, authenticated;
grant select, insert, update, delete on public.kira_conversations, public.kira_messages, public.kira_profiles to authenticated;
grant select, insert, delete on public.kira_usage to authenticated;
grant select on public.kira_meta to anon, authenticated;

revoke all on function public.kira_is_server() from public;
grant execute on function public.kira_is_server() to anon, authenticated;
revoke all on function public.kira_touch_conversation() from public, anon, authenticated;

drop policy if exists kira_conversations_read on public.kira_conversations;
drop policy if exists kira_conversations_write on public.kira_conversations;
create policy kira_conversations_read on public.kira_conversations for select to authenticated
  using (user_id = (select auth.uid()));
create policy kira_conversations_write on public.kira_conversations for all to authenticated
  using (user_id = (select auth.uid()) and (select public.kira_is_server()))
  with check (user_id = (select auth.uid()) and (select public.kira_is_server()));

drop policy if exists kira_messages_read on public.kira_messages;
drop policy if exists kira_messages_write on public.kira_messages;
create policy kira_messages_read on public.kira_messages for select to authenticated
  using (user_id = (select auth.uid()));
create policy kira_messages_write on public.kira_messages for all to authenticated
  using (user_id = (select auth.uid()) and (select public.kira_is_server()))
  with check (
    user_id = (select auth.uid()) and (select public.kira_is_server())
    and exists (select 1 from public.kira_conversations c where c.id = conversation_id and c.user_id = (select auth.uid()))
  );

drop policy if exists kira_profiles_read on public.kira_profiles;
drop policy if exists kira_profiles_write on public.kira_profiles;
create policy kira_profiles_read on public.kira_profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy kira_profiles_write on public.kira_profiles for all to authenticated
  using (user_id = (select auth.uid()) and (select public.kira_is_server()))
  with check (user_id = (select auth.uid()) and (select public.kira_is_server()));

-- Uso: dá para registrar, mas não para apagar o recente (senão o limite seria burlado)
drop policy if exists kira_usage_read on public.kira_usage;
drop policy if exists kira_usage_insert on public.kira_usage;
drop policy if exists kira_usage_cleanup on public.kira_usage;
create policy kira_usage_read on public.kira_usage for select to authenticated
  using (user_id = (select auth.uid()));
create policy kira_usage_insert on public.kira_usage for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.kira_is_server()));
create policy kira_usage_cleanup on public.kira_usage for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.kira_is_server()) and created_at < now() - interval '2 days');

drop policy if exists kira_meta_read on public.kira_meta;
create policy kira_meta_read on public.kira_meta for select to anon, authenticated using (true);
`;
}
