-- Vortelli OS — dados base: equipes, pessoas (lista oficial de 07/10/2026) e regras de comissão

insert into equipes (nome) values ('Lobos'),('Lions'),('Alpha'),('Omega'),('Administrativo')
on conflict (nome) do nothing;

-- Pessoas. O e-mail liga a pessoa ao login: preencha o e-mail de cada um antes de convidá-los.
insert into pessoas (nome, apelido, funcao, equipe_id, email, ativo, data_saida) values
  ('Ranulfo Ribeiro',   'RANULFO',   'ceo',            null, 'ranulfo.rj.junior@gmail.com', true, null),
  ('Gabriel Ávila',     'GABRIEL',   'gerente',        (select id from equipes where nome='Lobos'), null, true, null),
  ('Paulo Felipe',      'FELIPE',    'vendedor',       (select id from equipes where nome='Lobos'), null, true, null),
  ('Cauã Campelo',      'CAUÃ',      'vendedor',       (select id from equipes where nome='Lobos'), null, true, null),
  ('Annan Sarmento',    'ANNAN',     'vendedor',       (select id from equipes where nome='Lobos'), null, true, null),
  ('Kezia Ávila',       'KÉZIA',     'gerente',        (select id from equipes where nome='Lions'), null, true, null),
  ('Sherlane',          'SHERLANE',  'vendedor',       (select id from equipes where nome='Lions'), null, true, null),
  ('Mirian',            'MIRIAN',    'vendedor',       (select id from equipes where nome='Lions'), null, true, null),
  ('Clara',             'CLARA',     'vendedor',       (select id from equipes where nome='Lions'), null, true, null),
  ('Roberta',           'ROBERTA',   'gerente',        (select id from equipes where nome='Alpha'), null, true, null),
  ('Daniel',            'DANIEL',    'vendedor',       (select id from equipes where nome='Alpha'), null, true, null),
  ('Luiz',              'LUIZ',      'vendedor',       (select id from equipes where nome='Alpha'), null, true, null),
  ('Bruno',             'BRUNO',     'vendedor',       (select id from equipes where nome='Alpha'), null, true, null),
  ('Wesley',            'WESLEY',    'gerente',        (select id from equipes where nome='Omega'), null, true, null),
  ('Lohan',             'LOHAN',     'vendedor',       (select id from equipes where nome='Omega'), null, true, null),
  ('Marcelo',           'MARCELO',   'vendedor',       (select id from equipes where nome='Omega'), null, true, null),
  ('Leonardo',          'LEONARDO',  'vendedor',       (select id from equipes where nome='Omega'), null, true, null),
  ('Pedro',             'PEDRO',     'vendedor',       (select id from equipes where nome='Omega'), null, true, null),
  ('Elizandra Wanzeler','ELIZANDRA', 'gerente_adm',    (select id from equipes where nome='Administrativo'), null, true, null),
  ('Augusto',           'AUGUSTO',   'administrativo', (select id from equipes where nome='Administrativo'), null, true, null),
  ('Arielly',           'ARIELLY',   'administrativo', (select id from equipes where nome='Administrativo'), null, true, null),
  ('Arlena Cristina',   'ARLENA',    'administrativo', (select id from equipes where nome='Administrativo'), null, true, null),
  ('ADM 5 (a definir)', 'ADM_5',     'administrativo', (select id from equipes where nome='Administrativo'), null, true, null),
  -- Saíram (mantidos para o histórico de vendas)
  ('David',             'DAVID',     'vendedor',       null, null, false, null),
  ('Cristiane',         'CRISTIANE', 'vendedor',       null, null, false, null),
  ('Vinicius',          'VINICIUS',  'vendedor',       null, null, false, null),
  -- A confirmar se continuam
  ('Carlos',            'CARLOS',    'vendedor',       null, null, false, null)
on conflict (apelido) do nothing;

insert into regras (chave, valor, descricao, pendente) values
  ('entrada',          3600,  'Entrada por cota (R$). A loja paga a 1ª parcela com ela.', false),
  ('disal_venda',      2.0,   'Disal na venda (%). Vem como 1% na pcl 1 + 1% na pcl 2.', false),
  ('disal_p345',       1.0,   'Disal na 3ª, 4ª e 5ª parcela (%).', false),
  ('estorno_disal',    1.0,   'Estorno da Disal se o cliente não pagar a 2ª (%).', false),
  ('estorno_doc',      1.7,   'Estorno da Disal por pendência de documento (%).', false),
  ('recuperacao',      1.7,   'Disal paga quando o cliente estornado volta a pagar (%).', false),
  ('imposto',          19.5,  'Imposto sobre a comissão Disal (%).', false),
  ('vendedor',         0.4,   'Comissão do vendedor (%). Escala por volume a confirmar.', true),
  ('fechador_pct',     0.15,  'Comissão do fechador (%).', false),
  ('fechador_fixo',    250,   'Fixo do fechador por cota (R$).', true),
  ('adm',              0.05,  'Administrativo sobre a própria carteira (%).', false),
  ('estorno_equipe',   50,    'Estorno da equipe quando o cliente não paga a 2ª (% da comissão).', false),
  ('meta_cotas',       120,   'Meta de cotas do mês.', false)
on conflict (chave) do nothing;
