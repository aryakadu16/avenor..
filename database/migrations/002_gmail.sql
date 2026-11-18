-- Gmail integration. Run after 001_schema.sql.
alter table emails add column gmail_message_id text, add column gmail_thread_id text, add column labels jsonb not null default '[]',
 add column body_preview text generated always as (left(body,2000)) stored;
create unique index emails_gmail_uq on emails(user_id,gmail_message_id);
create index emails_thread_idx on emails(user_id,gmail_thread_id);
create table gmail_connections(user_id uuid primary key references auth.users(id) on delete cascade,google_email text not null,refresh_token_enc text not null,scopes text not null default '',
 status text not null default 'connected' check(status in('connected','revoked','error')),history_id text,last_synced_at timestamptz,last_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table oauth_states(state_hash text primary key,user_id uuid not null references auth.users(id) on delete cascade,expires_at timestamptz not null,created_at timestamptz not null default now());
create trigger t_upd before update on gmail_connections for each row execute function set_updated_at();
-- Tokens are never readable from the browser: RLS on, NO policies, all grants revoked. Only the backend's service-role key can access these tables.
alter table gmail_connections enable row level security;alter table oauth_states enable row level security;
revoke all on gmail_connections,oauth_states from anon,authenticated;
