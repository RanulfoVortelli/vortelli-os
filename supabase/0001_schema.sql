-- Vortelli OS — esquema inicial do banco (Supabase / Postgres)
-- Rodar uma vez no projeto novo. Cria tabelas, regras de comissão, segurança por função e gatilhos.

-- =========================================================
-- 1. Tabelas
-- =========================================================

create table if not exists equipes (
  id          serial primary key,
  nome        text not null unique,
  ativa       boolean not null default true
);

create table if not exists pessoas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  apelido     text not null unique,          -- como aparece na planilha (ex.: LEONARDO, KÉZIA)
  funcao      text not null check (funcao in ('ceo','gerente','vendedor','gerente_adm','administrativo')),
  equipe_id   int references equipes(id),
  ativo       boolean not null default true,
  data_saida  date,
  salario     numeric(12,2),
  email       text unique,
  user_id     uuid unique references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Parâmetros de comissão. Mudar aqui recalcula o sistema inteiro.
create table if not exists regras (
  chave      text primary key,
  valor      numeric not null,
  descricao  text not null,
  pendente   boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists cotas (
  id                 bigserial primary key,
  contrato           text unique,
  grupo              text,
  cota               text,
  administradora     text not null default 'DISAL',
  login_disal        text,                    -- 'Novo Mundo' ou 'Equipe Belém'
  cliente            text not null,
  telefone           text,
  credito            numeric(12,2),
  parcela_valor      numeric(12,2),
  data_venda         date not null,
  vencimento_1       date,                    -- vencimento da 1ª parcela; as demais vencem mês a mês
  vendedor_id        uuid references pessoas(id),
  fechador_id        uuid references pessoas(id),
  adm_id             uuid references pessoas(id),  -- carteira do administrativo (base dos 0,05%)
  equipe_id          int references equipes(id),
  status             text not null default 'ativa'
                     check (status in ('ativa','cancelada','estornada','concluida','contemplada')),
  estorno_documento  boolean not null default false,  -- estorno por documento: não é repassado ao consultor
  recuperacao_data   date,                             -- cliente voltou a pagar depois do estorno
  obs                text,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id) default auth.uid()
);
create index if not exists cotas_data_venda_idx on cotas(data_venda);
create index if not exists cotas_vendedor_idx on cotas(vendedor_id);
create index if not exists cotas_adm_idx on cotas(adm_id);

create table if not exists parcelas (
  cota_id     bigint not null references cotas(id) on delete cascade,
  numero      smallint not null check (numero between 1 and 5),
  vencimento  date,
  status      text not null default 'aberto'
              check (status in ('aberto','pago','atrasado','nao_pago','cancelado')),
  pago_em     date,
  primary key (cota_id, numero)
);

create table if not exists lancamentos (
  id          bigserial primary key,
  data        date not null,
  tipo        text not null check (tipo in ('entrada','saida')),
  categoria   text not null,      -- Tráfego pago, Folha, Aluguel, Sistemas, Campanhas, Descontos veículos, Investimento, Outros
  descricao   text,
  valor       numeric(12,2) not null check (valor >= 0),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) default auth.uid()
);
create index if not exists lancamentos_data_idx on lancamentos(data);

-- Contatos de pós-venda (radar da 2ª parcela)
create table if not exists contatos (
  id          bigserial primary key,
  cota_id     bigint not null references cotas(id) on delete cascade,
  pessoa_id   uuid references pessoas(id),
  feito_em    timestamptz not null default now(),
  resultado   text
);

-- =========================================================
-- 2. Funções auxiliares de acesso
-- =========================================================

create or replace function minha_pessoa() returns pessoas
language sql stable security definer set search_path = public as $$
  select * from pessoas where user_id = auth.uid() limit 1
$$;

create or replace function eh_gestor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from pessoas where user_id = auth.uid() and funcao in ('ceo','gerente_adm') and ativo)
$$;

create or replace function pode_ver_cota(c cotas) returns boolean
language sql stable security definer set search_path = public as $$
  select eh_gestor()
      or exists (
        select 1 from pessoas p
        where p.user_id = auth.uid() and p.ativo and (
              p.id in (c.vendedor_id, c.fechador_id, c.adm_id)
           or (p.funcao = 'gerente' and p.equipe_id = c.equipe_id)
        )
      )
$$;

-- Liga o login à pessoa pelo e-mail no primeiro acesso
create or replace function vincular_login() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update pessoas set user_id = new.id where lower(email) = lower(new.email) and user_id is null;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function vincular_login();

-- Toda cota nova ganha as 5 parcelas automaticamente
create or replace function criar_parcelas() returns trigger
language plpgsql as $$
declare base date := coalesce(new.vencimento_1, new.data_venda);
begin
  insert into parcelas (cota_id, numero, vencimento, status, pago_em)
  select new.id, n, (base + make_interval(months => n - 1))::date,
         case when n = 1 then 'pago' else 'aberto' end,
         case when n = 1 then new.data_venda end
  from generate_series(1,5) n
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists cotas_criar_parcelas on cotas;
create trigger cotas_criar_parcelas after insert on cotas
  for each row execute function criar_parcelas();

-- =========================================================
-- 3. Segurança por função (Row Level Security)
--    CEO e gerente do administrativo veem tudo.
--    Gerente vê a equipe. Vendedor vê as próprias cotas. Administrativo vê a carteira.
-- =========================================================

alter table equipes     enable row level security;
alter table pessoas     enable row level security;
alter table regras      enable row level security;
alter table cotas       enable row level security;
alter table parcelas    enable row level security;
alter table lancamentos enable row level security;
alter table contatos    enable row level security;

create policy equipes_ler   on equipes for select to authenticated using (true);
create policy equipes_gerir on equipes for all    to authenticated using (eh_gestor()) with check (eh_gestor());

create policy pessoas_ler   on pessoas for select to authenticated using (true);
create policy pessoas_gerir on pessoas for all    to authenticated using (eh_gestor()) with check (eh_gestor());

create policy regras_ler    on regras for select to authenticated using (true);
create policy regras_gerir  on regras for all    to authenticated using (eh_gestor()) with check (eh_gestor());

create policy cotas_ler     on cotas for select to authenticated using (pode_ver_cota(cotas));
create policy cotas_inserir on cotas for insert to authenticated
  with check (eh_gestor() or (minha_pessoa()).funcao in ('gerente','administrativo'));
create policy cotas_editar  on cotas for update to authenticated using (pode_ver_cota(cotas) and (eh_gestor() or (minha_pessoa()).funcao in ('gerente','administrativo')));
create policy cotas_apagar  on cotas for delete to authenticated using (eh_gestor());

create policy parcelas_ler    on parcelas for select to authenticated
  using (exists (select 1 from cotas c where c.id = cota_id and pode_ver_cota(c)));
create policy parcelas_editar on parcelas for update to authenticated
  using (exists (select 1 from cotas c where c.id = cota_id and pode_ver_cota(c))
         and (eh_gestor() or (minha_pessoa()).funcao = 'administrativo'));
create policy parcelas_inserir on parcelas for insert to authenticated with check (eh_gestor());

create policy lancamentos_gestor on lancamentos for all to authenticated using (eh_gestor()) with check (eh_gestor());

create policy contatos_ler     on contatos for select to authenticated
  using (exists (select 1 from cotas c where c.id = cota_id and pode_ver_cota(c)));
create policy contatos_inserir on contatos for insert to authenticated
  with check (exists (select 1 from cotas c where c.id = cota_id and pode_ver_cota(c)));
