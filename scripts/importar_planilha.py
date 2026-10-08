"""Converte a PLANILHA DE VENDAS (Excel) em SQL de importação para o Supabase.

Uso: python3 scripts/importar_planilha.py "PLANILHA DE VENDAS.xlsx" private/import_cotas.sql

O arquivo gerado tem dados de clientes: fica em private/, que não vai para o GitHub.
"""
import sys, json, datetime, unicodedata
import openpyxl

MESES = ['MAIO 2026', 'JUNHO 2026', 'JULHO 2026', 'AGOSTO 2026', 'SETEMBRO 2026', 'OUTUBRO 2026']

# Grafias diferentes na planilha -> apelido oficial
ALIAS = {
    'MIRIAM': 'MIRIAN', 'MRIAM': 'MIRIAN', 'KEZIA': 'KÉZIA', 'CAUA': 'CAUÃ',
    'VINICIOS': 'VINICIUS', 'DEIVID': 'DAVID',
}

def norm(s):
    return str(s).strip().upper() if s is not None else ''

def sem_acento(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')

def apelido(nome):
    n = norm(nome)
    if not n or set(n) <= set('X\\'):
        return None
    return ALIAS.get(sem_acento(n), ALIAS.get(n, n))

def data(v):
    if isinstance(v, datetime.datetime):
        return v.date()
    return None

def num(v):
    return float(v) if isinstance(v, (int, float)) else None

def q(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, datetime.date):
        return f"'{v.isoformat()}'"
    return "'" + str(v).replace("'", "''") + "'"

def add_months(d, n):
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year
    m += 1
    import calendar
    return datetime.date(y, m, min(d.day, calendar.monthrange(y, m)[1]))

def status_parcela(v, numero, morta):
    s = norm(v)
    if morta:
        return 'cancelado'
    if s.startswith('PAGO'):
        return 'pago'
    if 'CANCEL' in s:
        return 'nao_pago' if numero == 2 else 'cancelado'
    return 'aberto'

def main(xlsx, out):
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    cotas, avisos, vistos = [], [], set()
    for aba in MESES:
        ws = wb[aba]
        rows = list(ws.iter_rows(values_only=True))
        h = [sem_acento(norm(c)).replace(' ', '') for c in rows[0]]
        def col(*nomes):
            for n in nomes:
                n = sem_acento(n).replace(' ', '')
                for j, c in enumerate(h):
                    if c.startswith(n):
                        return j
            return None
        C = dict(nome=0, credito=col('CREDITO'), contrato=col('CONTRATO'), grupo=col('GRUPO'), cota=col('COTA'),
                 adm=col('ADM'), ativo=col('ATIVO'), venda=col('DATADEVENDA', 'DATADAVENDA'), venc=col('VENCIMENTO'),
                 contato=col('CONTATO'), parcela=col('PARCELAS'), vend=col('VENDEDOR'), fech=col('FECHADOR'),
                 p2=col('2°'), p3=col('3°'), p4=col('4°'), p5=col('5°'), obs=col('OBS'))
        for r in rows[1:]:
            if not r or not r[0] or not str(r[0]).strip():
                continue
            g = lambda k: r[C[k]] if C[k] is not None and C[k] < len(r) else None
            contrato = g('contrato')
            contrato = str(int(contrato)) if isinstance(contrato, (int, float)) else (norm(contrato) or None)
            if contrato and set(contrato) <= set('X'):
                contrato = None
            if contrato and contrato in vistos:
                avisos.append(f'{aba}: contrato repetido {contrato} ignorado')
                continue
            if contrato:
                vistos.add(contrato)
            venda = data(g('venda'))
            if not venda:
                avisos.append(f'{aba}: {r[0]} sem data de venda, ignorado')
                continue
            credito = num(g('credito'))
            cancelada = credito is None and 'CANCEL' in norm(g('credito'))
            st = {n: None for n in range(2, 6)}
            morta = False
            for n in range(2, 6):
                st[n] = status_parcela(g(f'p{n}'), n, morta)
                if st[n] == 'nao_pago':
                    morta = True
            obs = norm(g('obs'))
            if cancelada:
                status = 'cancelada'
                st = {n: 'cancelado' for n in range(2, 6)}
            elif st[2] == 'nao_pago':
                status = 'estornada'
            elif 'CONTEMPLADO' in obs:
                status = 'contemplada'
            elif st[5] == 'pago':
                status = 'concluida'
            else:
                status = 'ativa'
            venc1 = data(g('venc')) or venda
            tel = g('contato')
            tel = str(int(tel)) if isinstance(tel, (int, float)) else None
            cotas.append(dict(
                contrato=contrato, grupo=None if g('grupo') is None else str(g('grupo')), cota=None if g('cota') is None else str(g('cota')),
                administradora=norm(g('adm')) or 'DISAL', cliente=str(r[0]).strip(), telefone=tel,
                credito=credito, parcela_valor=num(g('parcela')), data_venda=venda, vencimento_1=venc1,
                vendedor=apelido(g('vend')), fechador=apelido(g('fech')), status=status, obs=obs or None,
                parcelas=[(1, venc1, 'pago')] + [(n, add_months(venc1, n - 1), st[n]) for n in range(2, 6)],
            ))
    if out.endswith('.json'):
        # Formato compacto para colar no editor SQL do Supabase (ver supabase/seed/0003_importar_json.sql)
        rows = [[c['contrato'], c['grupo'], c['cota'], c['administradora'], c['cliente'], c['telefone'], c['credito'],
                 c['parcela_valor'], c['data_venda'].isoformat(), c['vencimento_1'].isoformat(), c['vendedor'], c['fechador'],
                 c['status'], c['obs']] + [s for _, _, s in c['parcelas'][1:]] for c in cotas]
        open(out, 'w').write(json.dumps(rows, ensure_ascii=False, separators=(',', ':')))
        print(json.dumps({'cotas': len(rows)}, ensure_ascii=False))
        return
    # SQL
    linhas = ['-- Importação gerada automaticamente da PLANILHA DE VENDAS (maio a outubro de 2026)', 'begin;']
    novos = sorted({a for c in cotas for a in (c['vendedor'], c['fechador']) if a})
    for a in novos:
        linhas.append(f"insert into pessoas (nome, apelido, funcao, ativo) values ({q(a.title())}, {q(a)}, 'vendedor', false) on conflict (apelido) do nothing;")
    for c in cotas:
        vend = f"(select id from pessoas where apelido={q(c['vendedor'])})" if c['vendedor'] else 'null'
        fech = f"(select id from pessoas where apelido={q(c['fechador'])})" if c['fechador'] else 'null'
        equipe = f"(select equipe_id from pessoas where apelido={q(c['vendedor'])})" if c['vendedor'] else 'null'
        linhas.append(
            'with nova as (insert into cotas (contrato, grupo, cota, administradora, cliente, telefone, credito, parcela_valor, '
            'data_venda, vencimento_1, vendedor_id, fechador_id, equipe_id, status, obs) values ('
            + ', '.join([q(c['contrato']), q(c['grupo']), q(c['cota']), q(c['administradora']), q(c['cliente']), q(c['telefone']),
                         q(c['credito']), q(c['parcela_valor']), q(c['data_venda']), q(c['vencimento_1']), vend, fech, equipe,
                         q(c['status']), q(c['obs'])])
            + ') on conflict (contrato) do nothing returning id) '
            + 'insert into parcelas (cota_id, numero, vencimento, status) select nova.id, v.n, v.d::date, v.s from nova, (values '
            + ', '.join(f"({n}, {q(d)}, {q(s)})" for n, d, s in c['parcelas'])
            + ') as v(n, d, s) on conflict (cota_id, numero) do update set vencimento = excluded.vencimento, status = excluded.status;'
        )
    linhas.append('commit;')
    open(out, 'w').write('\n'.join(linhas) + '\n')
    resumo = {
        'cotas': len(cotas),
        'por_status': {s: sum(1 for c in cotas if c['status'] == s) for s in ('ativa', 'estornada', 'cancelada', 'concluida', 'contemplada')},
        'nomes_na_planilha': novos,
        'avisos': avisos[:20],
    }
    print(json.dumps(resumo, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
