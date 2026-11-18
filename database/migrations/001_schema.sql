-- AVENOR schema. Run in the Supabase SQL editor (or `supabase db push`).
create extension if not exists pgcrypto;
create or replace function set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create table profiles(id uuid primary key references auth.users(id) on delete cascade,full_name text not null default '',email text not null default '',avatar_url text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table user_settings(user_id uuid primary key references auth.users(id) on delete cascade,theme text not null default 'system' check(theme in('light','dark','system')),
 notification_prefs jsonb not null default '{"approvals":true,"followups":true,"urgent":true,"ai":true}',ai_prefs jsonb not null default '{"autoSuggestReplies":true}',updated_at timestamptz not null default now());
create table email_categories(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,name text not null,description text,unique(user_id,name));
create table emails(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,category_id uuid references email_categories(id) on delete set null,
 sender_name text not null,sender_email text not null,recipient text not null default '',subject text not null,body text not null,received_at timestamptz not null,
 is_read boolean not null default false,is_starred boolean not null default false,has_attachment boolean not null default false,
 priority text not null default 'Normal' check(priority in('High','Normal','Low')),
 priority_rank smallint generated always as (case priority when 'High' then 0 when 'Normal' then 1 else 2 end) stored,
 category text not null default 'General',status text not null default 'open' check(status in('open','archived')),
 ai_status text not null default 'pending' check(ai_status in('pending','processing','processed','failed')),ai_summary text,metadata jsonb not null default '{}',
 is_demo boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table ai_processing(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,email_id uuid not null unique references emails(id) on delete cascade,
 intent text,summary text,suggested_priority text,suggested_category text,suggested_owner text,suggested_action text,requires_attention boolean not null default false,follow_up_needed boolean not null default false,
 key_info jsonb not null default '[]',model text,status text not null default 'completed' check(status in('completed','failed')),created_at timestamptz not null default now());
create table approvals(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,email_id uuid not null references emails(id) on delete cascade,
 suggested_reply text not null,edited_reply text,status text not null default 'pending' check(status in('pending','approved','rejected')),
 send_status text not null default 'not_applicable' check(send_status in('not_applicable','awaiting_sending_configuration','sent')),created_at timestamptz not null default now(),reviewed_at timestamptz);
create table follow_ups(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,email_id uuid references emails(id) on delete set null,
 description text not null,due_date timestamptz not null,status text not null default 'pending' check(status in('pending','completed')),reminder_at timestamptz,completed_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table notifications(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,title text not null,message text not null default '',
 type text not null check(type in('urgent','approval','client_attention','followup','ai','system')),is_read boolean not null default false,related_id uuid,created_at timestamptz not null default now());
create table activity_history(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,type text not null,description text not null,related_id uuid,created_at timestamptz not null default now());
create index on emails(user_id,received_at desc);create index on emails(user_id,status);create index on approvals(user_id,status);create index on follow_ups(user_id,status,due_date);
create index on notifications(user_id,is_read,created_at desc);create index on activity_history(user_id,created_at desc);create index on ai_processing(user_id);
create trigger t_upd before update on emails for each row execute function set_updated_at();create trigger t_upd before update on follow_ups for each row execute function set_updated_at();
create trigger t_upd before update on profiles for each row execute function set_updated_at();create trigger t_upd before update on user_settings for each row execute function set_updated_at();
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into profiles(id,full_name,email) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),coalesce(new.email,''));insert into user_settings(user_id) values(new.id);return new;end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
alter table profiles enable row level security;
create policy profiles_own on profiles for all to authenticated using(id=auth.uid()) with check(id=auth.uid());
do $$ declare t text; begin foreach t in array array['user_settings','email_categories','emails','ai_processing','approvals','follow_ups','notifications','activity_history'] loop
 execute format('alter table %I enable row level security',t);
 execute format('create policy %I on %I for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid())',t||'_own',t);end loop;end $$;
create policy approvals_email_owner on approvals as restrictive for all to authenticated with check(exists(select 1 from emails e where e.id=email_id and e.user_id=auth.uid()));
create policy ai_email_owner on ai_processing as restrictive for all to authenticated with check(exists(select 1 from emails e where e.id=email_id and e.user_id=auth.uid()));
create policy fu_email_owner on follow_ups as restrictive for all to authenticated with check(email_id is null or exists(select 1 from emails e where e.id=email_id and e.user_id=auth.uid()));
revoke all on all tables in schema public from anon;
alter publication supabase_realtime add table notifications;
