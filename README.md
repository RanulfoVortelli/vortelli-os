# Vortelli OS

Sistema próprio da Vortelli Consórcio e Financiamento: cotas, comissões, radar da 2ª parcela, caixa, equipes, regras e manual de processos.

## Como está organizado

| Pasta | O que tem |
|---|---|
| `index.html`, `app.js`, `style.css`, `config.js` | O site. HTML, CSS e JavaScript puros, sem etapa de build. Publicado no GitHub Pages. |
| `supabase/migrations/` | Estrutura do banco: tabelas, gatilhos e regras de segurança por função. |
| `supabase/seed/` | Equipes, pessoas (lista oficial de 07/10/2026) e regras de comissão. |
| `scripts/importar_planilha.py` | Converte a PLANILHA DE VENDAS (Excel) em dados para o banco. |
| `private/` | Dados de clientes. **Nunca vai para o GitHub** (está no `.gitignore`). |

## Quem vê o quê

| Função | Vê |
|---|---|
| CEO e gerente do administrativo | Tudo, inclusive Painel, Financeiro e edição das regras |
| Gerente | As cotas da própria equipe |
| Vendedor | As próprias cotas e comissões |
| Administrativo | A própria carteira; dá baixa nas parcelas e registra contatos |

O acesso é por link no e-mail. A pessoa só entra se o e-mail dela estiver cadastrado na tabela `pessoas`.

## Regras de comissão (tabela `regras`)

- Disal: 2% na venda, 1% na 3ª, 4ª e 5ª parcela. Imposto de 19,5%.
- Estorno Disal: 1% se o cliente não paga a 2ª; 1,7% por pendência de documento.
- Vendedor 0,4% · Fechador R$ 250 + 0,15% · Administrativo 0,05% da carteira.
- Estorno da equipe: 50% da comissão quando a 2ª não é paga (não vale para estorno por documento).
- Pagamento da equipe toda sexta.

## Endereços

- Site: https://ranulfovortelli.github.io/vortelli-os/
- Supabase: projeto `vortelli-os` (região São Paulo)

## Instalação

1. Rodar `supabase/migrations/0001_schema.sql` e depois `supabase/seed/0002_base.sql` no projeto Supabase.
2. Gerar e rodar a importação: `python3 scripts/importar_planilha.py "PLANILHA DE VENDAS.xlsx" private/import_cotas.sql`.
3. Preencher `config.js` com a URL e a chave anon do projeto.
4. No Supabase, em Authentication → URL Configuration, colocar o endereço do site.
5. Publicar no GitHub Pages (branch main, pasta raiz).
