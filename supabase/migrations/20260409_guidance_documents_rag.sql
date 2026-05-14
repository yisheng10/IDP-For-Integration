create extension if not exists vector;

create table if not exists public.guidance_documents (
  id bigint generated always as identity primary key,
  source_type text not null check (source_type in ('ctcae', 'protocol')),
  document_id text not null,
  protocol_id text null,
  protocol_name text null,
  title text null,
  page integer null,
  chunk_index integer not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(4096) not null,
  created_at timestamptz not null default now()
);

alter table public.guidance_documents
  alter column embedding type vector(4096)
  using embedding::vector(4096);

create unique index if not exists guidance_documents_document_chunk_idx
  on public.guidance_documents (document_id, chunk_index);

create index if not exists guidance_documents_source_protocol_idx
  on public.guidance_documents (source_type, protocol_id);

alter table public.guidance_documents enable row level security;

drop policy if exists "guidance_documents_read_all" on public.guidance_documents;
create policy "guidance_documents_read_all"
  on public.guidance_documents
  for select
  using (true);

drop policy if exists "guidance_documents_write_all" on public.guidance_documents;
create policy "guidance_documents_write_all"
  on public.guidance_documents
  for all
  using (true)
  with check (true);

drop function if exists public.match_guidance_documents(vector(3072), integer, text[], text, text);
drop function if exists public.match_guidance_documents(vector(4096), integer, text[], text, text);

create or replace function public.match_guidance_documents(
  query_embedding vector(4096),
  match_count integer default 4,
  _source_types text[] default array['ctcae', 'protocol'],
  _protocol_id text default null,
  _protocol_name text default null
)
returns table (
  id bigint,
  source_type text,
  document_id text,
  protocol_id text,
  protocol_name text,
  title text,
  page integer,
  chunk_index integer,
  content text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
as $$
  select
    g.id,
    g.source_type,
    g.document_id,
    g.protocol_id,
    g.protocol_name,
    g.title,
    g.page,
    g.chunk_index,
    g.content,
    g.metadata,
    1 - (g.embedding <=> query_embedding) as similarity
  from public.guidance_documents as g
  where g.source_type = any(_source_types)
    and (_protocol_id is null or g.protocol_id = _protocol_id)
    and (_protocol_name is null or g.protocol_name = _protocol_name)
  order by g.embedding <=> query_embedding
  limit greatest(match_count, 0);
$$;
