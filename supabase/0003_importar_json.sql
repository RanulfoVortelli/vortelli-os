-- Importa cotas a partir do JSON compacto gerado por scripts/importar_planilha.py (saída .json).
-- Uso: select importar_cotas('<conteúdo do JSON>'::jsonb);
-- Cada linha: [contrato, grupo, cota, administradora, cliente, telefone, credito, parcela, data_venda,
--              vencimento_1, vendedor, fechador, status, obs, p2, p3, p4, p5]

create or replace function importar_cotas(dados jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; novo bigint; n int := 0; k int;
begin
  -- Pessoas que aparecem na planilha e ainda não existem entram como inativas
  insert into pessoas (nome, apelido, funcao, ativo)
  select distinct initcap(a), a, 'vendedor', false
  from jsonb_array_elements(dados) e, lateral (values (e->>10), (e->>11)) v(a)
  where a is not null
  on conflict (apelido) do nothing;

  for r in select * from jsonb_array_elements(dados) loop
    insert into cotas (contrato, grupo, cota, administradora, cliente, telefone, credito, parcela_valor,
                       data_venda, vencimento_1, vendedor_id, fechador_id, equipe_id, status, obs)
    values (r->>0, r->>1, r->>2, coalesce(r->>3, 'DISAL'), r->>4, r->>5, (r->>6)::numeric, (r->>7)::numeric,
            (r->>8)::date, (r->>9)::date,
            (select id from pessoas where apelido = r->>10),
            (select id from pessoas where apelido = r->>11),
            (select equipe_id from pessoas where apelido = r->>10),
            r->>12, r->>13)
    on conflict (contrato) do nothing
    returning id into novo;
    if novo is not null then
      for k in 2..5 loop
        update parcelas set status = r->>(12 + k) where cota_id = novo and numero = k;
      end loop;
      n := n + 1;
    end if;
    novo := null;
  end loop;
  return n;
end $$;

revoke all on function importar_cotas(jsonb) from public, anon, authenticated;
