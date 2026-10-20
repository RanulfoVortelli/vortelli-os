/* Vortelli OS — app ligado ao Supabase.
   Motor de cálculo: comissão Disal, imposto, comissões da equipe, estornos e fluxo de caixa,
   tudo a partir das tabelas cotas, parcelas, regras e lançamentos. */
(function () {
'use strict';
const CFG = window.VORTELLI_CONFIG || {};
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const brl = (v, d = 0) => (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('pt-BR', {style:'currency', currency:'BRL', minimumFractionDigits:d, maximumFractionDigits:d});
const fdate = d => d ? d.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'}) : '—';
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const hoje = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const TODAY = hoje();
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const ymOf = d => d.getFullYear() * 12 + d.getMonth();
const ymLabel = ym => MESES[ym % 12].slice(0, 3) + '/' + String(Math.floor(ym / 12)).slice(2);
// Quinzena: o ranking zera no dia 16 (1ª = dias 1 a 15, 2ª = dia 16 ao fim do mês). qz = ym * 2 + (0 ou 1)
const qzOf = d => ymOf(d) * 2 + (d.getDate() > 15 ? 1 : 0);
const naQz = (d, qz) => d && qzOf(d) === qz;
const qzLabel = qz => { const ym = Math.floor(qz / 2), fim = new Date(Math.floor(ym / 12), ym % 12 + 1, 0).getDate(); return (qz % 2 ? `16 a ${fim}` : '1 a 15') + ' de ' + ymLabel(ym); };
const parseD = s => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const noMes = (d, ym) => d && ymOf(d) === ym;
const sextaApos = d => { let x = addDays(d, 1); while (x.getDay() !== 5) x = addDays(x, 1); return x; };
// Vendas de segunda a sábado entram no relatório da semana seguinte e são pagas na sexta dessa semana
const sextaPagamento = d => addDays(addDays(d, -((d.getDay() + 6) % 7)), 11);
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }

if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
  document.body.innerHTML = '<p style="padding:24px">Configuração do Supabase ausente em config.js.</p>';
  return;
}
const HASH0 = location.hash;   // guardado antes de o Supabase ler e limpar o endereço
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

/* ---------------- Estado ---------------- */
let ME = null, GESTOR = false;
const PCOLS = 'id,nome,apelido,funcao,equipe_id,ativo,data_saida,fechador,gerente_geral,user_id';
let EQUIPES = [], PESSOAS = [], R = {}, COTAS = [], LANC = [], TRAF = [], DESC = [];
const r = k => (R[k] ? Number(R[k].valor) : 0);
const funcaoNome = p => p && p.gerente_geral ? 'Gerente geral' : (FUNCAO[p && p.funcao] || '—');
const salarioDe = p => !p.ativo ? 0 : p.salario != null ? Number(p.salario) : (p.funcao === 'administrativo' ? r('salario_minimo') : 0);
const diasFolha = () => [r('folha_dia_1') || 3, r('folha_dia_2') || 17];
const folhaTotal = () => PESSOAS.reduce((s, p) => s + salarioDe(p), 0);
const folhaMes = ym => folhaTotal();
const proxFolha = () => { const y = TODAY.getFullYear(), m = TODAY.getMonth(); return [0, 1].flatMap(i => diasFolha().map(d => new Date(y, m + i, d))).find(d => d >= TODAY); };
const pessoaPorId = id => PESSOAS.find(p => p.id === id);
const nomeP = id => (pessoaPorId(id) || {}).nome || '—';
const equipeNome = id => (EQUIPES.find(e => e.id === id) || {}).nome || '—';
const FUNCAO = {tv:'TV da loja', ceo:'CEO', gerente:'Supervisor', vendedor:'Vendedor', gerente_adm:'Gerente adm', administrativo:'Administrativo'};

/* ---------------- Login ---------------- */
async function iniciar() {
  const { data: { session } } = await sb.auth.getSession();
  if (session && definirSenha) { mostrarNovaSenha(); return; }
  if (!session) { mostrarLogin(); return; }
  await carregar(session.user);
}
function mostrarLogin(msg) {
  $('app').hidden = true; $('login').hidden = false;
  if (msg) $('loginMsg').textContent = msg;
}
$('formLogin').addEventListener('submit', async ev => {
  ev.preventDefault();
  const email = $('loginEmail').value.trim(), senha = $('loginSenha').value;
  $('loginMsg').textContent = 'Entrando…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) { $('loginMsg').textContent = /invalid/i.test(error.message) ? 'E-mail ou senha incorretos. No primeiro acesso, use "Primeiro acesso: criar minha senha".' : /confirm/i.test(error.message) ? 'Confirme o seu e-mail primeiro: abra a mensagem que enviamos e toque no link.' : 'Não foi possível entrar: ' + error.message; return; }
  carregar(data.user);
});
const voltarAqui = location.origin + location.pathname;
async function enviarLinkSenha(tipo) {
  const email = $('loginEmail').value.trim();
  if (!email) { $('loginMsg').textContent = 'Digite o seu e-mail primeiro.'; $('loginEmail').focus(); return; }
  $('loginMsg').textContent = 'Enviando…';
  const { error } = tipo === 'primeiro'
    ? await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: voltarAqui + '?definir=1', shouldCreateUser: true } })
    : await sb.auth.resetPasswordForEmail(email, { redirectTo: voltarAqui + '?definir=1' });
  $('loginMsg').textContent = error ? 'Não foi possível enviar: ' + error.message : 'Enviamos um link para ' + email + '. Abra o e-mail mais recente neste aparelho e toque no link em até 1 hora. Links de e-mails anteriores deixam de valer.';
}
$('btnPrimeiro').addEventListener('click', () => enviarLinkSenha('primeiro'));
$('btnEsqueci').addEventListener('click', () => enviarLinkSenha('esqueci'));
let definirSenha = new URLSearchParams(location.search).has('definir');
// Link do e-mail que falhou (já usado, expirado ou substituído por um convite mais novo): explica e orienta
(() => {
  const hp = new URLSearchParams(HASH0.slice(1)); if (!hp.get('error')) return;
  const cod = hp.get('error_code') || '';
  definirSenha = false; history.replaceState(null, '', voltarAqui);
  $('loginMsg').innerHTML = cod === 'otp_expired'
    ? '<b>Esse link não vale mais</b>: ele já foi usado, passou de 1 hora ou chegou um convite mais novo depois dele. Digite o seu e-mail acima e toque em <b>Primeiro acesso: criar minha senha</b>. Abra só o e-mail mais recente, neste mesmo aparelho.'
    : 'Não foi possível entrar pelo link (' + esc((hp.get('error_description') || cod).replace(/\+/g, ' ')) + '). Digite o seu e-mail acima e peça um link novo em <b>Primeiro acesso</b>.';
})();
function mostrarNovaSenha() { $('app').hidden = true; $('login').hidden = false; $('formLogin').hidden = true; $('formNovaSenha').hidden = false; $('novaSenha').focus(); }
$('formNovaSenha').addEventListener('submit', async ev => {
  ev.preventDefault();
  $('novaMsg').textContent = 'Salvando…';
  const { data, error } = await sb.auth.updateUser({ password: $('novaSenha').value });
  if (error) { $('novaMsg').textContent = 'Não foi possível salvar: ' + error.message; return; }
  definirSenha = false; history.replaceState(null, '', voltarAqui);
  $('formNovaSenha').hidden = true; $('formLogin').hidden = false;
  carregar(data.user);
});
$('btnSair').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
sb.auth.onAuthStateChange((evt, session) => {
  if (evt === 'PASSWORD_RECOVERY' || (definirSenha && session)) { mostrarNovaSenha(); return; }
  if (evt === 'SIGNED_IN' && session && !ME) carregar(session.user);
});

/* ---------------- Carga ---------------- */
async function tudo(q) {
  const out = []; let from = 0;
  for (;;) { const { data, error } = await q().range(from, from + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; from += 1000; }
  return out;
}
async function carregar(user) {
  try {
    let { data: eu } = await sb.from('pessoas').select(PCOLS).eq('user_id', user.id).maybeSingle();
    if (!eu) { await sb.rpc('vincular_meu_login'); ({ data: eu } = await sb.from('pessoas').select(PCOLS).eq('user_id', user.id).maybeSingle()); }
    if (!eu) { await sb.auth.signOut(); mostrarLogin(`O e-mail ${user.email} não está cadastrado no Vortelli OS. Peça ao administrativo para cadastrar.`); return; }
    if (eu.funcao === 'tv') { location.replace('tv.html'); return; }   // login da TV: só o ranking
    ME = eu; GESTOR = eu.funcao === 'ceo';   // só o CEO vê números da loja, Disal, financeiro e salários
    document.body.classList.toggle('ceo', GESTOR);
    const [eq, ps, rg, ct, lc, cn] = await Promise.all([
      sb.from('equipes').select('*').order('id'),
      GESTOR ? sb.rpc('pessoas_admin') : sb.from('pessoas').select(PCOLS).order('nome'),
      sb.from('regras').select('*'),
      tudo(() => sb.from('cotas').select('*, parcelas(*)').order('data_venda', { ascending: false })),
      GESTOR ? sb.from('lancamentos').select('*').order('data', { ascending: false }) : Promise.resolve({ data: [] }),
      sb.from('contatos').select('cota_id, feito_em')
    ]);
    EQUIPES = eq.data || []; PESSOAS = ps.data || [];
    R = Object.fromEntries((rg.data || []).map(x => [x.chave, x]));
    const contatos = new Set((cn.data || []).map(x => x.cota_id));
    COTAS = ct.map(c => montarCota(c, contatos));
    LANC = (lc.data || []).map(l => ({ ...l, data: parseD(l.data), valor: Number(l.valor) }));
    await carregarTrafego();
    await carregarCanc();
    await carregarDebitos();
    await carregarCaixa();
    await carregarCampanhas();
    $('login').hidden = true; $('app').hidden = false;
    $('quem').textContent = `${ME.nome} · ${funcaoNome(ME)}`;
    document.querySelectorAll('[data-gestor]').forEach(b => b.hidden = !GESTOR);
    document.querySelectorAll('[data-fin]').forEach(b => b.hidden = !veComissoes());
    document.querySelectorAll('[data-pode-lancar]').forEach(b => b.hidden = !podeLancar());
    $('navMinha').textContent = veComissoes() ? 'Extrato individual' : 'Minha comissão';
    $('mcPessoaL').hidden = !veComissoes(); $('rkFull').hidden = !GESTOR; $('rkTvWrap').hidden = GESTOR;
    initFiltros(); renderRegras(); renderAll();
    let start = GESTOR ? 'painel' : 'minha';
    try { const v = localStorage.getItem('vos_view'); if (v && !(document.querySelector(`[data-view="${v}"]`) || {}).hidden) start = v; } catch (e) {}
    go(start);
  } catch (e) {
    console.error(e); mostrarLogin('Erro ao carregar os dados: ' + (e.message || e));
  }
}
function montarCota(c, contatos) {
  const p = {}, venc = {}, disalEm = {};
  const inf = {};
  (c.parcelas || []).forEach(x => { p[x.numero] = x.status; venc[x.numero] = parseD(x.vencimento); if (x.disal_em) disalEm[x.numero] = parseD(x.disal_em);
    if (x.informado_em && x.status === 'aberto') inf[x.numero] = { em: parseD(x.informado_em), por: x.informado_por, at: x.informado_at ? new Date(x.informado_at) : null, arq: x.comprovante }; });
  for (let k = 1; k <= 5; k++) { if (!p[k]) p[k] = k === 1 ? 'pago' : 'aberto'; }
  return {
    id: c.id, contrato: c.contrato, cliente: c.cliente, telefone: c.telefone, credito: Number(c.credito || 0), parcela: Number(c.parcela_valor || 0),
    venda: parseD(c.data_venda), venc, disalEm, p, status: c.status, estornoDoc: c.estorno_documento, recuperacao: parseD(c.recuperacao_data), equipeId: c.equipe_id,
    vendedor_id: c.vendedor_id, fechador_id: c.fechador_id, adm_id: c.adm_id, inf,
    cpf: c.cpf, grupo: c.grupo, cotaNum: c.cota, venc1: c.vencimento_1, login: c.login_disal, historico: !!c.historico,
    confirmada: c.disal_confirmada !== false, antecipada: !!c.comissao_antecipada, confirmadaEm: parseD(c.disal_confirmada_em) || parseD(c.data_venda),
    vendedor: nomeP(c.vendedor_id), fechador: nomeP(c.fechador_id), adm: c.adm_id ? nomeP(c.adm_id) : 'Sem carteira',
    equipe: equipeNome(c.equipe_id || (pessoaPorId(c.vendedor_id) || {}).equipe_id), contato: contatos.has(c.id)
  };
}
const valida = c => c.status !== 'cancelada' && c.credito > 0;
const incompleta = c => valida(c) && !c.historico && (!c.contrato || !c.grupo || !c.cotaNum || !c.adm_id);
// Base da comissão da venda: a data em que a Disal confirmou (ou a venda, se confirmou antes)
const semanaDisal = d => addDays(d, -7);   // sextaPagamento(d - 7) = sexta da semana do borderô
const baseVenda = c => c.confirmadaEm && semanaDisal(c.confirmadaEm) > c.venda ? semanaDisal(c.confirmadaEm) : c.venda;
// Comissão antecipada pela loja: a equipe recebe na sexta da semana da venda, mesmo sem a Disal, e não recebe de novo depois
const baseEquipe = c => c.antecipada ? c.venda : baseVenda(c);
// Campanhas de premiação: bônus fixo por cota para vendedor e fechador, pago na mesma sexta da comissão da venda
let CAMP = [];
async function carregarCampanhas() {
  const { data, error } = await sb.from('campanhas').select('*').order('inicio', { ascending: false });
  if (!error) CAMP = (data || []).map(k => ({ ...k, ini: parseD(k.inicio), fim: parseD(k.fim), vv: Number(k.valor_vendedor) || 0, vf: Number(k.valor_fechador) || 0 }));
}
function bonusCampanha(c, lista = CAMP) {
  const out = [], base = baseEquipe(c), vend = c.vendedor_id || c.fechador_id, fech = c.fechador_id || c.vendedor_id, sozinho = vend === fech;
  lista.filter(k => k.ativa && c.venda >= k.ini && c.venda <= k.fim).forEach(k => {
    if (vend && k.vv > 0) out.push({ pessoa: vend, papel: sozinho ? 'Vendedor e fechador' : 'Vendedor', data: base, valor: k.vv, tipo: 'bon', camp: k.nome, cota: c });
    if (fech && k.vf > 0 && (!sozinho || k.ambos)) out.push({ pessoa: fech, papel: sozinho ? 'Vendedor e fechador' : 'Fechador', data: base, valor: k.vf, tipo: 'bon', camp: k.nome, cota: c });
  });
  return out;
}
const dataParcela = (c, k) => c.disalEm && c.disalEm[k] ? semanaDisal(c.disalEm[k]) : venc(c, k);
const soDig = s => String(s || '').replace(/\D/g, '');
// Valor digitado do jeito brasileiro ou não: 1.488,21 · 1488,21 · 1488.21 · 120.000 · 120000
const numValor = v => { let s = String(v == null ? '' : v).trim().replace(/[R$\s]/g, ''); if (!s) return 0;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc > -1) s = s.replace(/\./g, '').replace(',', '.');
  else if (ld > -1 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN; };
const fmtBR = (n, d = 2) => (n || n === 0) && isFinite(n) ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '';
const fmtCpf = s => { const d = soDig(s); return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (s || ''); };
// Comissões da equipe e extrato de qualquer pessoa: CEO e gerente adm (financeiro)
const veComissoes = () => GESTOR || (ME && ME.funcao === 'gerente_adm');
const podeLancar = () => GESTOR || (ME && ['gerente', 'administrativo', 'gerente_adm'].includes(ME.funcao));
const venc = (c, k) => c.venc[k] || addDays(c.venda, 30 * (k - 1));
// Status mostrado: parcela vencida há mais de 3 dias sem baixa aparece como "atrasado"
const stView = (c, k) => (c.p[k] === 'aberto' && c.inf && c.inf[k]) ? 'informado' : (c.p[k] === 'aberto' && venc(c, k) < addDays(TODAY, -3)) ? 'atrasado' : c.p[k];

/* ---------------- Motor de cálculo ---------------- */
function eventosLoja(c) {
  if (!valida(c)) return [];
  const ev = [{ data: c.venda, tipo: 'entrada', valor: r('entrada') - c.parcela },
              { data: baseVenda(c), tipo: 'disal', valor: c.credito * r('disal_venda') / 100, previsto: !c.confirmada }];
  for (let k = 3; k <= 5; k++) {
    if (c.p[k] === 'pago') ev.push({ data: dataParcela(c, k), tipo: 'disal', valor: c.credito * r('disal_p345') / 100 });
    else if (c.p[k] === 'aberto') ev.push({ data: venc(c, k), tipo: 'disal', valor: c.credito * r('disal_p345') / 100, previsto: true });
  }
  if (c.p[2] === 'nao_pago') ev.push({ data: addDays(venc(c, 2), 5), tipo: 'disal', valor: -c.credito * r(c.estornoDoc ? 'estorno_doc' : 'estorno_disal') / 100 });
  return ev;
}
// Política de comissionamento (09/10/2026). Percentuais sobre o crédito na data da venda.
const gerenteDaEquipe = eq => PESSOAS.find(p => p.equipe_id === eq && p.funcao === 'gerente' && p.ativo);
const ehFechador = p => !!p && (p.funcao === 'gerente' || p.fechador);
// Quem recebe na venda, conforme a situação
function partesVenda(c) {
  const pct = k => c.credito * r(k) / 100;
  const pv = pessoaPorId(c.vendedor_id), pf = pessoaPorId(c.fechador_id);
  const eqV = (pv && pv.equipe_id) || c.equipeId;
  const ger = gerenteDaEquipe(eqV);
  const partes = [];
  if (!pf || (pv && pv.id === pf.id) || !pv) {
    const quem = pv || pf; if (!quem) return { situacao: 0, partes };
    if (ehFechador(quem)) {                                   // Situação 1: o fechador vende e fecha sozinho
      partes.push({ pessoa: quem.id, papel: 'Fechador', valor: pct('fechador_pct') + r('fixo_fechador_sozinho') });
      return { situacao: 1, partes };
    }
    partes.push({ pessoa: quem.id, papel: 'Vendedor', valor: pct('vendedor_fecha') });   // Situação 4: o vendedor fecha
    if (ger && ger.id !== quem.id) partes.push({ pessoa: ger.id, papel: 'Gerente', valor: pct('gerente_vendedor_fecha_pct') + r('gerente_vendedor_fecha_fixo') });
    return { situacao: 4, partes };
  }
  partes.push({ pessoa: pv.id, papel: 'Vendedor', valor: pct('vendedor') });
  if (pf.funcao === 'gerente' && pf.equipe_id === eqV) {      // Situação 2: o gerente fecha venda da própria equipe
    partes.push({ pessoa: pf.id, papel: 'Fechador', valor: pct('fechador_pct') + r('fixo_gerente_propria_equipe') });
    return { situacao: 2, partes };
  }
  partes.push({ pessoa: pf.id, papel: 'Fechador', valor: pct('fechador_pct') + r('fixo_fechador_outra_equipe') });   // Situação 3
  if (ger && ger.id !== pf.id) partes.push({ pessoa: ger.id, papel: 'Gerente', valor: r('gerente_fechador_outra_equipe') });
  return { situacao: 3, partes };
}
// Desligamento: nada é pago nem estornado a partir da data de saída
// Recorrência do supervisor (regra de 16/10/2026): 3ª, 4ª e 5ª pagas, só nos clientes que ele mesmo vendeu e fechou,
// no mesmo percentual do administrativo. Vale para parcelas pagas a partir da semana de 12/10/2026 (sexta 23/10).
const SUP_REC_DESDE = new Date(2026, 9, 12);
const supPct = () => (R.sup_parcela ? r('sup_parcela') : r('adm_parcela'));
const supRecorrente = c => { const pv = pessoaPorId(c.vendedor_id), pf = pessoaPorId(c.fechador_id), q = pv || pf;
  return q && q.funcao === 'gerente' && (!pv || !pf || pv.id === pf.id) ? q : null; };
const ativoEm = (id, d) => { const p = pessoaPorId(id); return !(p && p.data_saida && d >= parseD(p.data_saida)); };
function eventosEquipe(c) {
  // Cancelamento confirmado pelo extrato da Disal: se a comissão já tinha sido paga, devolve 100% (até 7 dias da venda) ou 50%
  if (c.status === 'cancelada' && c.canc && c.canc.conf) {
    if (!(c.confirmada || c.antecipada) || !(c.credito > 0)) return [];
    const base = baseEquipe(c), conf = c.canc.conf;
    if (+sextaPagamento(base) > +sextaPagamento(conf)) return [];   // ainda não tinha sido paga: não paga
    const f = (c.canc.pct || 50) / 100, ev = [];
    partesVenda(c).partes.forEach(x => { ev.push({ pessoa: x.pessoa, papel: x.papel, data: base, valor: x.valor, tipo: 'com', cota: c });
      ev.push({ pessoa: x.pessoa, papel: x.papel, data: conf, valor: -x.valor * f, tipo: 'est', cota: c }); });
    bonusCampanha(c).forEach(b => { ev.push(b); ev.push({ ...b, data: conf, valor: -b.valor, tipo: 'est' }); });   // bônus de campanha: estorno de 100%
    return ev.filter(e => ativoEm(e.pessoa, e.data));
  }
  if (!valida(c)) return [];
  const ev = [];
  if (!c.confirmada && !c.antecipada) return ev;   // Política: comissão só depois que a venda sai paga no relatório da Disal (ou antecipada pela loja)
  const { partes } = partesVenda(c);
  partes.forEach(x => ev.push({ pessoa: x.pessoa, papel: x.papel, data: baseEquipe(c), valor: x.valor, tipo: 'com', cota: c }));
  ev.push(...bonusCampanha(c));
  // Estorno de 50% quando a 2ª não é paga (não vale para estorno por documento)
  if (c.p[2] === 'nao_pago' && !c.estornoDoc) {
    const d = addDays(venc(c, 2), 5), f = r('estorno_equipe') / 100;
    const vendedorRecebeu = partes.some(x => x.papel === 'Vendedor');
    partes.forEach(x => {
      if (x.papel === 'Gerente' && !vendedorRecebeu) return;
      ev.push({ pessoa: x.pessoa, papel: x.papel, data: d, valor: -x.valor * f, tipo: 'est', cota: c });
      if (c.recuperacao) ev.push({ pessoa: x.pessoa, papel: x.papel, data: semanaDisal(c.recuperacao), valor: x.valor * f, tipo: 'rec', cota: c });   // recuperação paga na semana do borderô
    });
    bonusCampanha(c).forEach(b => {   // bônus de campanha: estorno de 100% (volta se o cliente for recuperado)
      ev.push({ ...b, data: d, valor: -b.valor, tipo: 'est' });
      if (c.recuperacao) ev.push({ ...b, data: semanaDisal(c.recuperacao), valor: b.valor, tipo: 'rec' });
    });
  }
  // Administrativo e gerente administrativo: 0,05% por 3ª, 4ª e 5ª parcela paga
  const gerAdm = PESSOAS.filter(p => p.funcao === 'gerente_adm' && p.ativo);
  for (let k = 3; k <= 5; k++) {
    if (c.p[k] !== 'pago') continue;
    const d = dataParcela(c, k);
    if (c.adm_id) ev.push({ pessoa: c.adm_id, papel: 'Administrativo', data: d, valor: c.credito * r('adm_parcela') / 100, tipo: 'com', cota: c });
    gerAdm.forEach(g => ev.push({ pessoa: g.id, papel: 'Gerente adm', data: d, valor: c.credito * r('gerente_adm_parcela') / 100, tipo: 'com', cota: c }));
    const sp = supRecorrente(c);
    if (sp && d >= SUP_REC_DESDE) ev.push({ pessoa: sp.id, papel: 'Supervisor (carteira)', data: d, valor: c.credito * supPct() / 100, tipo: 'com', cota: c });
  }
  return ev.filter(e => ativoEm(e.pessoa, e.data));
}
// Gerente geral: R$ 50 por cota se a loja vender no mínimo 80 no mês; apurado 7 dias após o fim do mês
function bonusGerenteGeral() {
  const gg = PESSOAS.find(p => p.gerente_geral && p.ativo); if (!gg) return [];
  const porMes = {};
  COTAS.forEach(c => { if (valida(c)) porMes[ymOf(c.venda)] = (porMes[ymOf(c.venda)] || 0) + 1; });
  return Object.entries(porMes).filter(([, n]) => n >= r('gg_min_cotas')).map(([ym, n]) => {
    ym = +ym; const fim = new Date(Math.floor(ym / 12), ym % 12 + 1, 0);
    return { pessoa: gg.id, papel: 'Gerente geral', data: addDays(fim, 7), valor: n * r('gg_por_cota'), tipo: 'com', cota: { id: 'gg' + ym } };
  }).filter(e => ativoEm(e.pessoa, e.data));
}
const todosEventosEquipe = () => aplicarConta(COTAS.flatMap(eventosEquipe).concat(bonusGerenteGeral(), eventosDescontos()));
function mesResumo(ym) {
  const vendas = COTAS.filter(c => valida(c) && noMes(c.venda, ym));
  let disal = 0, entrada = 0, equipe = 0;
  COTAS.forEach(c => {
    eventosLoja(c).forEach(e => { if (noMes(e.data, ym) && e.data <= TODAY && !e.previsto) { if (e.tipo === 'disal') disal += e.valor; else entrada += e.valor; } });
    eventosEquipe(c).forEach(e => { if (noMes(e.data, ym) && e.data <= TODAY) equipe += e.valor; });
  });
  bonusGerenteGeral().concat(eventosDescontos()).forEach(e => { if (noMes(e.data, ym) && e.data <= TODAY) equipe += e.valor; });
  return { vendas, disal, entrada, imp: Math.max(0, disal) * r('imposto') / 100, equipe };
}
function despesasMes(ym) {
  return LANC.filter(l => noMes(l.data, ym) && l.data <= TODAY).reduce((s, l) => s + (l.tipo === 'saida' ? l.valor : -l.valor), 0);
}
function alertasLista() {
  const lim = addDays(TODAY, 15);
  return COTAS.filter(c => valida(c) && c.p[2] === 'aberto' && !(c.inf && c.inf[2]) && venc(c, 2) <= lim && venc(c, 2) >= addDays(TODAY, -45))
              .sort((a, b) => venc(a, 2) - venc(b, 2));
}
const riscoCota = c => c.credito * r('estorno_disal') / 100 + partesVenda(c).partes.reduce((s, x) => s + x.valor, 0) * r('estorno_equipe') / 100;

/* ---------------- Telas ---------------- */
const ymNow = ymOf(TODAY);
const kpi = (k, v, d, extra = '') => `<div class="kpi"><span class="k">${k}</span><span class="v">${v}</span>${extra}${d ? `<span class="d">${d}</span>` : ''}</div>`;

function renderPainel() {
  if (!GESTOR) return;
  $('tituloMes').textContent = MESES[TODAY.getMonth()][0].toUpperCase() + MESES[TODAY.getMonth()].slice(1) + ' de ' + TODAY.getFullYear();
  const m = mesResumo(ymNow);
  const cred = m.vendas.reduce((s, c) => s + c.credito, 0);
  const meta = r('meta_cotas') || 1, pct = Math.min(100, m.vendas.length / meta * 100);
  const desp = despesasMes(ymNow), folha = folhaMes(ymNow), res = m.entrada + m.disal - m.imp - m.equipe - folha - desp;
  const al = alertasLista();
  $('kpis').innerHTML =
    kpi('Cotas vendidas', `${m.vendas.length} <span style="font-size:14px;color:var(--muted)">/ ${meta}</span>`, `${pct.toFixed(0)}% da meta`, `<div class="meter"><i style="width:${pct}%"></i></div>`) +
    kpi('Crédito vendido', brl(cred), `Ticket médio ${brl(m.vendas.length ? cred / m.vendas.length : 0)}`) +
    kpi('Entrou no caixa', brl(m.entrada + m.disal - m.imp), 'Entradas + Disal − imposto') +
    kpi('2ª parcela no radar', `<span class="${al.length ? 'neg' : ''}">${al.length}</span>`, `Em risco ${brl(al.reduce((s, c) => s + riscoCota(c), 0))}`);
  const meses = [0, 1, 2, 3, 4].map(i => ymNow + i);
  const vals = meses.map(ym => { let s = 0; COTAS.forEach(c => eventosLoja(c).forEach(e => { if (e.tipo === 'disal' && e.previsto && noMes(e.data, ym)) s += e.valor; })); return s * (1 - r('imposto') / 100); });
  const max = Math.max(1, ...vals);
  $('chartCarteira').innerHTML = `<div class="bars" style="--n:5">${vals.map((v, i) => `<div class="bar ${i === 0 ? 'now' : ''}"><span class="val">${brl(v)}</span><div class="col" style="height:${v / max * 150}px"></div></div>`).join('')}</div><div class="blabels" style="--n:5">${meses.map(ym => `<span>${ymLabel(ym)}</span>`).join('')}</div>`;
  $('dre').innerHTML = [
    ['Sobra das entradas', m.entrada, `${m.vendas.length} cotas × (R$ ${r('entrada').toLocaleString('pt-BR')} − 1ª parcela)`],
    ['Comissão Disal', m.disal, 'Vendas, 3ª a 5ª parcelas e estornos'],
    ['Imposto', -m.imp, `${r('imposto')}% sobre a comissão`],
    ['Comissões da equipe', -m.equipe, 'Vendedor, fechador, administrativo'],
    ['Salários', -folha, `Pagos dias ${diasFolha().join(' e ')}, metade em cada data`],
    ['Despesas lançadas', -desp, 'Financeiro'],
  ].map(([t, v, s]) => `<div class="row"><div class="l">${t}<span>${s}</span></div><b class="${v < 0 ? 'neg' : ''}">${brl(v)}</b></div>`).join('') +
    `<div class="row"><div class="l"><strong>Resultado parcial</strong><span>Aluguel e outras despesas entram pelo Financeiro</span></div><b class="${res < 0 ? 'neg' : 'pos'}" style="font-size:17px">${brl(res)}</b></div>`;
  const porEq = EQUIPES.filter(e => e.nome !== 'Administrativo').map(e => { const v = m.vendas.filter(c => c.equipe === e.nome); const ger = PESSOAS.find(p => p.equipe_id === e.id && p.funcao === 'gerente'); return { nome: e.nome, ger: ger ? ger.nome : '', n: v.length, cred: v.reduce((s, c) => s + c.credito, 0) }; }).sort((a, b) => b.n - a.n || b.cred - a.cred);
  $('rankEquipes').innerHTML = porEq.map((e, i) => `<div class="row"><div class="l"><span style="font-family:var(--f-num)">${i + 1}º</span>${esc(e.nome)} · ${esc(e.ger)}</div><b>${e.n} cotas · ${brl(e.cred)}</b></div>`).join('');
  const atras = al.filter(c => stView(c, 2) === 'atrasado').length;
  const prox = sextaApos(addDays(TODAY, -1));
  const porPes = {}; todosEventosEquipe().filter(e => +sextaPagamento(e.data) === +prox).forEach(e => { porPes[e.pessoa] = (porPes[e.pessoa] || 0) + e.valor; });
  const aPagar = Object.values(porPes).reduce((s, v) => s + Math.max(0, v), 0);
  const semCarteira = COTAS.filter(c => valida(c) && !c.historico && !c.adm_id && c.p[5] !== 'pago').length;
  const aguard = COTAS.filter(c => valida(c) && !c.confirmada).length;
  const pend = Object.values(R).filter(x => x.pendente).length;
  $('atencao').innerHTML = [
    [`${atras} clientes com a 2ª vencida sem baixa`, 'Ligar hoje antes do estorno', 'alertas'],
    [`${al.length - atras} clientes com a 2ª vencendo em 15 dias`, 'Contato preventivo do administrativo', 'alertas'],
    [`Pagamento da sexta ${fdate(prox)}: ${brl(aPagar)}`, 'Conferir antes de liberar', 'comissoes'],
    [`Salários do dia ${fdate(proxFolha())}: ${brl(folhaTotal() / 2)}`, `${PESSOAS.filter(p => salarioDe(p) > 0).length} pessoas com salário fixo`, 'equipes'],
    [`${aguard} vendas aguardando a Disal`, 'Comissão liberada quando a venda sair paga no relatório', 'cotas'],
    [`${semCarteira} cotas ativas sem administrativo`, 'Definir a carteira de cada uma (base dos 0,05%)', 'cotas'],
    [`${pend} regras aguardando confirmação`, 'Vendedor e fechador fixo', 'regras']
  ].map(([t, s, v]) => `<div class="row"><div class="l">${t}<span>${s}</span></div><button class="btn ghost sm" data-go="${v}">Abrir</button></div>`).join('');
}

function chipSit(c) {
  if (c.status === 'cancelada') return '<span class="chip c-canc">Cancelada</span>';
  if (c.p[2] === 'nao_pago') return '<span class="chip c-nao">Estornada</span>';
  if (stView(c, 2) === 'atrasado') return '<span class="chip c-atrasado">2ª sem baixa</span>';
  if (c.p[5] === 'pago') return '<span class="chip c-pago">Concluída</span>';
  if (c.status === 'contemplada') return '<span class="chip c-pago">Contemplada</span>';
  return '<span class="chip c-aberto">Ativa</span>';
}
const podeBaixar = () => GESTOR || (ME && ['administrativo', 'gerente_adm'].includes(ME.funcao));
function renderCotas() {
  const ym = +$('qMes').value, eq = $('qEquipe').value, q = $('qBusca').value.trim().toLowerCase(), sit = $('qSit').value;
  const qd = soDig(q);
  const rows = COTAS.filter(c => (sit || q ? true : noMes(c.venda, ym)) && (!eq || c.equipe === eq)
    && (!sit || (sit === 'disal' ? valida(c) && !c.confirmada : incompleta(c)))
    && (!q || `${c.cliente} ${c.vendedor} ${c.contrato || ''}`.toLowerCase().includes(q) || (qd.length >= 3 && soDig(c.cpf).includes(qd))));
  $('tbCotas').innerHTML = rows.length ? rows.map(c => `<tr><td class="n">${fdate(c.venda)}</td><td class="n">${esc(c.contrato || '—')}</td><td>${esc(c.cliente)}</td><td class="r n">${c.credito ? brl(c.credito) : '—'}</td><td>${esc(c.vendedor)}</td><td>${esc(c.fechador)}</td><td>${esc(c.adm)}</td>
    <td><span class="pp">${[1, 2, 3, 4, 5].map(k => { const s = stView(c, k); const t = `${k}ª: ${s} · venc. ${fdate(venc(c, k))}`; return k > 1 && podeBaixar() && c.status !== 'cancelada' ? `<button data-parc="${c.id}:${k}" title="${t}" aria-label="${t}"><i class="s-${s}">${k}</i></button>` : `<i class="s-${s}" title="${t}">${k}</i>`; }).join('')}</span></td><td>${chipSit(c)}${valida(c) && !c.confirmada ? ' <span class="chip c-atrasado">Aguardando Disal</span>' : ''}${incompleta(c) ? ' <span class="chip c-aberto">Completar dados</span>' : ''}</td><td>${podeLancar() ? `<button class="btn ghost sm" data-editar="${c.id}">Editar</button>` : ''}</td></tr>`).join('')
    : `<tr><td colspan="10" class="empty">Nenhuma cota neste filtro.</td></tr>`;
}

function renderCampanhas() {
  const el = $('campPanel'); if (!el) return; el.hidden = !veComissoes(); if (el.hidden) return;
  const cotasDe = k => COTAS.filter(c => valida(c) && c.venda >= k.ini && c.venda <= k.fim);
  const totalDe = k => cotasDe(k).reduce((s, c) => s + bonusCampanha(c, [k]).filter(e => ativoEm(e.pessoa, e.data)).reduce((a, e) => a + e.valor, 0), 0);
  el.innerHTML = `<div class="panel-head"><h2>Campanhas de premiação</h2><button class="btn gold sm" type="button" data-camp="nova">+ Nova campanha</button></div>
    <p class="note" style="margin:4px 0 10px">Bônus fixo por cota vendida no período. Entra no relatório de cada um como "Bônus de premiação", na mesma sexta da comissão da venda. Se a venda for cancelada ou o cliente não pagar a 2ª parcela, o bônus é estornado 100%.</p>
    <div class="list">${CAMP.map(k => { const n = cotasDe(k).length; return `<div class="row"><div class="l">${esc(k.nome)}<span>${fdate(k.ini)}${+k.fim !== +k.ini ? ' a ' + fdate(k.fim) : ''} · vendedor ${brl(k.vv, 2)} · fechador ${brl(k.vf, 2)}${k.ambos ? '' : ' · quem vende e fecha sozinho recebe só o do vendedor'} · ${n} ${n === 1 ? 'cota' : 'cotas'}${k.ativa ? '' : ' · <b>desativada</b>'}</span></div><b>${brl(k.ativa ? totalDe(k) : 0, 2)}</b> <button class="btn ghost sm" type="button" data-camp="editar:${k.id}">Editar</button></div>`; }).join('') || '<p class="note">Nenhuma campanha cadastrada.</p>'}</div>`;
}
let campEditando = null;
function abrirCamp(k) {
  campEditando = k || null;
  $('cpTitulo').textContent = k ? 'Editar campanha' : 'Nova campanha';
  $('cpNome').value = k ? k.nome : ''; $('cpIni').value = k ? k.inicio : iso(TODAY); $('cpFim').value = k ? k.fim : iso(TODAY);
  $('cpVend').value = k ? k.vv : 100; $('cpFech').value = k ? k.vf : 100; $('cpAmbos').checked = k ? k.ambos : true; $('cpAtiva').checked = k ? k.ativa : true;
  $('cpObs').value = k ? (k.obs || '') : ''; $('cpErro').textContent = ''; $('dlgCamp').showModal();
}
async function salvarCamp() {
  const f = { nome: $('cpNome').value.trim(), inicio: $('cpIni').value, fim: $('cpFim').value, valor_vendedor: +$('cpVend').value || 0, valor_fechador: +$('cpFech').value || 0,
    ambos: $('cpAmbos').checked, ativa: $('cpAtiva').checked, obs: $('cpObs').value.trim() || null };
  if (!f.nome) return ($('cpErro').textContent = 'Dê um nome à campanha.');
  if (!f.inicio || !f.fim || f.fim < f.inicio) return ($('cpErro').textContent = 'Confira o período: o fim não pode ser antes do início.');
  if (f.valor_vendedor < 0 || f.valor_fechador < 0 || !(f.valor_vendedor + f.valor_fechador > 0)) return ($('cpErro').textContent = 'Informe quanto ganha o vendedor e/ou o fechador.');
  $('cpErro').textContent = 'Salvando…';
  const q = campEditando ? sb.from('campanhas').update(f).eq('id', campEditando.id) : sb.from('campanhas').insert(f);
  const { error } = await q;
  if (error) return ($('cpErro').textContent = 'Não foi possível salvar: ' + error.message);
  $('dlgCamp').close(); await carregarCampanhas(); renderAll(); toast(campEditando ? 'Campanha atualizada' : 'Campanha criada');
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-camp]'); if (!b) return;
  const [acao, id] = b.dataset.camp.split(':');
  if (acao === 'nova') abrirCamp(null);
  else if (acao === 'editar') abrirCamp(CAMP.find(k => String(k.id) === id));
  else if (acao === 'salvar') salvarCamp();
  else if (acao === 'fechar') $('dlgCamp').close();
});

function renderComissoes() {
  const sexta = new Date(+$('qSexta').value);
  const ev = todosEventosEquipe().filter(e => +sextaPagamento(e.data) === +sexta && (veComissoes() || e.pessoa === ME.id || (ME.funcao === 'gerente')));
  const map = {};
  ev.forEach(e => { const m = map[e.pessoa] ||= { id: e.pessoa, cotas: new Set(), com: 0, est: 0, desc: 0 }; if (e.tipo === 'com' || e.tipo === 'rec' || e.tipo === 'bon') { m.com += e.valor; if (e.tipo === 'com') m.cotas.add(e.cota.id); } else if (e.tipo === 'desc') m.desc += e.valor; else m.est += e.valor; });
  const tot = x => x.com + x.est + x.desc;
  const lista = Object.values(map).sort((a, b) => tot(b) - tot(a));
  const tc = lista.reduce((s, x) => s + x.com, 0), te = lista.reduce((s, x) => s + x.est, 0), td = lista.reduce((s, x) => s + x.desc, 0);
  renderCampanhas();
  const pagar = lista.reduce((s, x) => s + Math.max(0, tot(x)), 0), passa = lista.reduce((s, x) => s + Math.min(0, tot(x)), 0);
  $('kpisCom').innerHTML = kpi('Comissões', brl(tc)) + kpi('Estornos', `<span class="neg">${brl(te)}</span>`) + kpi('Descontos', `<span class="neg">${brl(td)}</span>`, 'Tráfego, débitos e saldo anterior') + kpi('Total a pagar', brl(pagar), passa ? `${lista.filter(x => tot(x) < 0).length} com saldo negativo: ${brl(passa)} passa para a próxima sexta` : 'Ninguém negativo') + kpi('Pessoas', lista.length);
  $('tbCom').innerHTML = lista.length ? lista.map(x => { const p = pessoaPorId(x.id) || {}; return `<tr><td>${esc(p.nome)}</td><td>${funcaoNome(p)}</td><td>${esc(equipeNome(p.equipe_id))}</td><td class="r n">${x.cotas.size}</td><td class="r n">${brl(x.com, 2)}</td><td class="r n ${x.est ? 'neg' : ''}">${x.est ? brl(x.est, 2) : '—'}</td><td class="r n ${x.desc ? 'neg' : ''}">${x.desc ? brl(x.desc, 2) : '—'}</td><td class="r n ${tot(x) < 0 ? 'neg' : ''}"><strong>${brl(tot(x), 2)}</strong>${tot(x) < 0 ? '<br><span class="note">não recebe; passa para a próxima sexta</span>' : ''}</td></tr>`; }).join('') +
    `<tr class="total"><td colspan="4">Total</td><td class="r n">${brl(tc, 2)}</td><td class="r n neg">${brl(te, 2)}</td><td class="r n neg">${brl(td, 2)}</td><td class="r n">${brl(tc + te + td, 2)}</td></tr>`
    : `<tr><td colspan="8" class="empty">Nada a pagar nesta sexta.</td></tr>`;
}

function renderAlertas() {
  const L = alertasLista();
  $('badgeAlert').textContent = L.length;
  $('kpisAlert').innerHTML = kpi('Clientes no radar', L.length) + kpi('Vencidas sem baixa', `<span class="neg">${L.filter(c => stView(c, 2) === 'atrasado').length}</span>`) + kpi('Contatos feitos', L.filter(c => c.contato).length) + (GESTOR ? kpi('Dinheiro em risco', brl(L.reduce((s, c) => s + riscoCota(c), 0)), 'Estorno loja + equipe') : kpi('Seus clientes em risco', L.length));
  $('tbAlert').innerHTML = L.length ? L.map(c => `<tr><td class="n">${fdate(venc(c, 2))}</td><td>${esc(c.cliente)}</td><td class="n">${esc(c.telefone || '—')}</td><td>${esc(c.adm)}</td><td>${esc(c.vendedor)}</td><td class="r n">${brl(c.parcela, 2)}</td><td class="r n neg so-ceo">${brl(riscoCota(c))}</td>
    <td>${stView(c, 2) === 'atrasado' ? '<span class="chip c-atrasado">Vencida</span>' : '<span class="chip c-aberto">A vencer</span>'} ${c.contato ? '<span class="chip c-pago">Contato feito</span>' : ''}</td>
    <td><div class="acts">${c.contato ? '' : `<button class="btn ghost sm" data-contato="${c.id}">Contato feito</button>`}${acaoPagou(c, 2)}${podeAjustarVenc(c) ? `<button class="btn ghost sm" data-venc2="${c.id}">Ajustar vencimento</button>` : ''}${podeBaixar() ? `<button class="btn ghost sm" data-baixa="${c.id}:nao_pago">Não pagou</button>` : ''}</div></td></tr>`).join('')
    : `<tr><td colspan="9" class="empty">Nenhum cliente no radar.</td></tr>`;
}

// Caixa da loja: saldo do banco informado pelo CEO + movimento estimado desde então
let CAIXA = [];
async function carregarCaixa() {
  if (!GESTOR) return;
  const { data, error } = await sb.from('caixa_saldos').select('*').order('data', { ascending: false }).order('criado_em', { ascending: false }).limit(20);
  if (!error) CAIXA = (data || []).map(x => ({ ...x, data: parseD(x.data), valor: Number(x.valor) }));
}
function movimentoCaixa(de) {   // do dia seguinte ao saldo informado até hoje
  const dentro = d => d > de && d <= TODAY;
  let entrada = 0, disal = 0;
  COTAS.forEach(c => eventosLoja(c).forEach(e => { if (e.previsto || !dentro(e.data)) return; if (e.tipo === 'disal') disal += e.valor; else entrada += e.valor; }));
  const imp = Math.max(0, disal) * r('imposto') / 100;
  const porSexta = {};
  todosEventosEquipe().forEach(e => { const s = sextaPagamento(e.data); if (!dentro(s)) return; const p = (porSexta[+s] ||= {}); p[e.pessoa] = (p[e.pessoa] || 0) + e.valor; });
  const equipe = Object.values(porSexta).reduce((s, p) => s + Object.values(p).reduce((a, v) => a + Math.max(0, v), 0), 0);
  let folha = 0;
  for (let d = addDays(de, 1); d <= TODAY; d = addDays(d, 1)) if (diasFolha().includes(d.getDate())) folha += folhaTotal() / 2;
  const lanc = LANC.filter(l => dentro(l.data)).reduce((s, l) => s + (l.tipo === 'saida' ? -l.valor : l.valor), 0);
  return { entrada, disal: disal - imp, equipe: -equipe, folha: -folha, lanc };
}
function renderCaixa() {   // caixa do mês: começa zerado no dia 1º, sem saldo de meses anteriores
  const el = $('caixaPanel'); if (!el || !GESTOR) return;
  const ini = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  const m = movimentoCaixa(addDays(ini, -1)), est = m.entrada + m.disal + m.equipe + m.folha + m.lanc;
  const linhas = [['Sobra das entradas', m.entrada, 'Entrada de R$ ' + r('entrada').toLocaleString('pt-BR') + ' − 1ª parcela, nas vendas do mês'], ['Comissão Disal', m.disal, 'Já confirmada, líquida de imposto'], ['Comissões pagas à equipe', m.equipe, 'Pagamentos das sextas deste mês'], ['Salários', m.folha, 'Dias ' + diasFolha().join(' e ') + ' que já passaram'], ['Lançamentos do Financeiro', m.lanc, 'Despesas e entradas lançadas abaixo']];
  el.innerHTML = `<div class="panel-head"><h2>Caixa do mês</h2><span class="sub">começa zerado em ${fdate(ini)} · sem saldo de meses anteriores</span></div>
    <div class="kpis" style="margin:8px 0 12px">${kpi('Caixa do mês até hoje', `<span class="${est < 0 ? 'neg' : ''}">${brl(est, 2)}</span>`, 'o que entrou menos o que saiu desde o dia 1º')}</div>
    <div class="list">${linhas.map(([t, v, d]) => `<div class="row"><div class="l">${t}<span>${d}</span></div><b class="${v < 0 ? 'neg' : ''}">${brl(v, 2)}</b></div>`).join('')}</div>`;
}
document.addEventListener('submit', async ev => {
  if (ev.target.id !== 'formCaixa') return; ev.preventDefault();
  const data = $('cxData').value, txt = $('cxValor').value;
  if (!data || txt === '') return toast('Informe a data e o saldo');
  if (parseD(data) > TODAY) return toast('A data não pode ser no futuro');
  const { error } = await sb.from('caixa_saldos').insert({ data, valor: +txt, obs: $('cxObs').value.trim() || null, criado_por: ME.id });
  if (error) return toast('Não foi possível salvar: ' + error.message);
  toast('Saldo do banco registrado'); await carregarCaixa(); renderCaixa();
});
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-cxdel]'); if (!t) return;
  if (!confirm('Excluir esse saldo informado?')) return;
  const { error } = await sb.from('caixa_saldos').delete().eq('id', t.dataset.cxdel);
  if (error) return toast('Não foi possível excluir: ' + error.message);
  await carregarCaixa(); renderCaixa();
});

function renderFin() {
  if (!GESTOR) return;
  const byDay = {};
  COTAS.forEach(c => eventosLoja(c).forEach(e => {
    if (!noMes(e.data, ymNow) || e.data > TODAY || e.previsto) return;
    const cat = e.tipo === 'entrada' ? 'Entradas de cotas' : (e.valor < 0 ? 'Estorno Disal' : 'Comissão Disal');
    const k = +e.data + '|' + cat;
    (byDay[k] ||= { data: e.data, cat, desc: cat === 'Entradas de cotas' ? 'Sobra das entradas do dia' : cat === 'Estorno Disal' ? 'Estornos da 2ª parcela' : 'Comissões Disal do dia', valor: 0 }).valor += e.valor;
  }));
  const auto = Object.values(byDay).map(x => ({ ...x, origem: 'Automático', sinal: x.valor < 0 ? -1 : 1, valor: Math.abs(x.valor) }));
  const man = LANC.filter(l => noMes(l.data, ymNow)).map(l => ({ data: l.data, cat: l.categoria, desc: l.descricao || '', origem: 'Lançado', sinal: l.tipo === 'saida' ? -1 : 1, valor: l.valor }));
  const fol = diasFolha().map(d => new Date(TODAY.getFullYear(), TODAY.getMonth(), d)).filter(d => d <= TODAY).map(d => ({ data: d, cat: 'Salários', desc: 'Salário fixo (metade do mês)', origem: 'Automático', sinal: -1, valor: folhaTotal() / 2 }));
  const todos = [...auto, ...fol, ...man].sort((a, b) => b.data - a.data);
  const ent = todos.filter(x => x.sinal > 0).reduce((s, x) => s + x.valor, 0), sai = todos.filter(x => x.sinal < 0).reduce((s, x) => s + x.valor, 0);
  const traf = man.filter(l => l.cat === 'Tráfego pago').reduce((s, l) => s + l.valor, 0);
  const vendas = COTAS.filter(c => valida(c) && noMes(c.venda, ymNow)).length;
  $('kpisFin').innerHTML = kpi('Entradas no mês', brl(ent)) + kpi('Saídas no mês', `<span class="neg">${brl(sai)}</span>`) + kpi('Saldo', brl(ent - sai)) + kpi('Tráfego por cota', vendas && traf ? brl(traf / vendas) : '—', `${brl(traf)} em tráfego`);
  renderCaixa();
  $('tbFin').innerHTML = todos.length ? todos.map(x => `<tr><td class="n">${fdate(x.data)}</td><td>${esc(x.cat)}</td><td>${esc(x.desc)}</td><td>${x.origem === 'Automático' ? '<span class="chip c-aberto">Automático</span>' : '<span class="chip c-pago">Lançado</span>'}</td><td class="r n ${x.sinal < 0 ? 'neg' : ''}">${brl(x.sinal * x.valor, 2)}</td></tr>`).join('') : `<tr><td colspan="5" class="empty">Nenhum lançamento neste mês.</td></tr>`;
}

function renderEquipes() {
  const vm = COTAS.filter(c => valida(c) && noMes(c.venda, ymNow));
  const times = EQUIPES.filter(e => e.nome !== 'Administrativo');
  const metaEq = Math.round((r('meta_cotas') || 0) / (times.length || 1));
  $('subEquipes').textContent = `Meta do mês: ${r('meta_cotas')} cotas, cerca de ${metaEq} por equipe.`;
  const ativos = PESSOAS.filter(p => p.ativo);
  $('teams').innerHTML = times.map(e => {
    const v = vm.filter(c => c.equipe === e.nome), pct = Math.min(100, v.length / (metaEq || 1) * 100);
    const ger = ativos.filter(p => p.equipe_id === e.id && p.funcao === 'gerente'), vend = ativos.filter(p => p.equipe_id === e.id && p.funcao === 'vendedor');
    return `<article class="team"><div class="team-head"><h2>${esc(e.nome)}</h2><span class="pill">${v.length} / ${metaEq} cotas</span></div><div class="meter"><i style="width:${pct}%"></i></div>
      <div class="list">${ger.map(g => `<div class="row"><div class="l">${esc(g.nome)}<span>${g.gerente_geral ? 'Gerente geral e fechador' : 'Supervisor e fechador'}</span></div><b>${vm.filter(c => c.fechador_id === g.id).length} fechadas</b></div>`).join('')}
      ${vend.map(p => `<div class="row"><div class="l">${esc(p.nome)}<span>Vendedor</span></div><b>${vm.filter(c => c.vendedor_id === p.id).length} cotas</b></div>`).join('')}</div></article>`;
  }).join('') + `<article class="team"><div class="team-head"><h2>Administrativo</h2><span class="pill">${ativos.filter(p => ['administrativo', 'gerente_adm'].includes(p.funcao)).length} pessoas</span></div>
    <div class="list">${ativos.filter(p => ['administrativo', 'gerente_adm'].includes(p.funcao)).map(p => `<div class="row"><div class="l">${esc(p.nome)}<span>${funcaoNome(p)}</span></div><b>${COTAS.filter(c => valida(c) && c.adm_id === p.id && c.p[5] !== 'pago' && c.p[2] !== 'nao_pago').length} clientes</b></div>`).join('')}</div></article>`;
}

const GRUPOS = [['Disal e loja', ['entrada', 'disal_venda', 'disal_p345', 'estorno_disal', 'estorno_doc', 'recuperacao', 'imposto', 'meta_cotas']], ['Venda (por situação)', ['vendedor', 'vendedor_fecha', 'fechador_pct', 'fixo_fechador_sozinho', 'fixo_gerente_propria_equipe', 'fixo_fechador_outra_equipe', 'gerente_fechador_outra_equipe', 'gerente_vendedor_fecha_pct', 'gerente_vendedor_fecha_fixo']], ['Parcelas, estorno e bônus', ['adm_parcela', 'gerente_adm_parcela', 'sup_parcela', 'estorno_equipe', 'gg_min_cotas', 'gg_por_cota']], ['Salários', ['salario_minimo', 'folha_dia_1', 'folha_dia_2']]];
function renderRegras() {
  $('rules').innerHTML = GRUPOS.map(([t, ks]) => `<div class="panel"><h2>${t}</h2><div>${ks.filter(k => R[k]).map(k => `<div class="rule"><div class="t"><label for="r_${k}" style="color:var(--ink);font-size:14px">${esc(R[k].descricao)}</label>${R[k].pendente ? '<span class="pend">Pendente de confirmação</span>' : ''}</div><input id="r_${k}" type="number" step="any" value="${R[k].valor}" data-rule="${k}" ${GESTOR ? '' : 'disabled'}></div>`).join('')}</div></div>`).join('');
}

const MANUAL = [
  ['Vendedor', ['Atender o lead no mesmo dia em que ele chega.', 'Apresentar a carta e a entrada de R$ 3.600.', 'Passar o cliente para o fechador, ou fechar você mesmo (aí a comissão sobe de 0,4% para 0,5%).', 'Conferir se a cota foi lançada no sistema no dia da venda: venda fora do relatório da Disal não gera comissão.', 'Acompanhar com o administrativo até a 2ª parcela: se ela não for paga, você devolve 50% da comissão.']],
  ['Fechador / Gerente', ['Fechar o contrato e conferir a documentação antes de enviar à Disal.', 'Lançar a cota no sistema com vendedor, fechador, administrativo e login.', 'Acompanhar a meta da equipe no painel todos os dias.', 'Cobrar da equipe os clientes da 2ª parcela que estão no radar.']],
  ['Administrativo', ['Enviar a mensagem de boas-vindas no dia da venda.', 'Ligar para todo cliente da sua carteira antes do vencimento da 2ª parcela.', 'Marcar "Contato feito" na tela da 2ª parcela.', 'Dar baixa nas parcelas: "Pagou" ou "Não pagou".', 'Acompanhar o cliente até a 5ª parcela e registrar recuperações.']],
  ['Gerente do administrativo', ['Toda semana, baixar o borderô da Disal dos dois logins e conferir com o sistema.', 'Marcar os estornos por documento, que não são cobrados do consultor.', 'Na quinta, conferir o pagamento da sexta e liberar.', 'Lançar despesas, tráfego pago e folha no Financeiro.']]
];
function renderManual() { $('manual').innerHTML = MANUAL.map(([t, l]) => `<div class="panel"><h2>${t}</h2><ol>${l.map(x => `<li>${x}</li>`).join('')}</ol></div>`).join(''); }

function renderUsuarios() {
  if (!GESTOR) return;
  if (ACESSOS === null) { ACESSOS = false; carregarAcessos(); }
  const sel = $('fuEquipe').value;
  $('fuEquipe').innerHTML = '<option value="">Sem equipe</option>' + EQUIPES.map(e => `<option value="${e.id}">${esc(e.nome)}</option>`).join('');
  $('fuEquipe').value = sel;
  const lista = [...PESSOAS].sort((a, b) => (b.ativo - a.ativo) || a.nome.localeCompare(b.nome));
  $('tbUsuarios').innerHTML = lista.map(p => {
    const ac = ACESSOS && ACESSOS[p.id], entrou = ac ? ac.entrou : !!p.user_id, eu = ME && p.id === ME.id;
    const st = !p.ativo ? '<span class="chip c-canc">Inativo</span>' : p.user_id && entrou ? `<span class="chip c-pago" title="${ac && ac.ultimo ? 'Último acesso ' + new Date(ac.ultimo).toLocaleString('pt-BR') : ''}">Acesso ativo</span>` : p.user_id ? '<span class="chip c-atrasado" title="O login foi criado, mas a pessoa ainda não entrou. Se o e-mail estiver errado, use Trocar e-mail.">Aguardando 1º acesso</span>' : p.email ? '<span class="chip c-atrasado">Convite enviado</span>' : '<span class="chip c-aberto">Sem e-mail</span>';
    const acao = !p.ativo ? '' : !p.user_id ? `<button class="btn sm" data-convidar="${p.id}">${p.email ? 'Reenviar convite' : 'Salvar e convidar'}</button>` : eu ? '' :
      `${entrou ? '' : `<button class="btn sm" data-reconvidar="${p.id}">Reenviar convite</button> `}<button class="btn ghost sm" data-trocaremail="${p.id}">Trocar e-mail</button>`;
    return `<tr><td>${esc(p.nome)}</td><td>${funcaoNome(p)}</td><td>${esc(equipeNome(p.equipe_id))}</td><td><input type="email" aria-label="E-mail de ${esc(p.nome)}" value="${esc(p.email || '')}" data-email-de="${p.id}" placeholder="email@exemplo.com" style="min-width:220px" ${p.user_id ? 'disabled' : ''}></td><td>${st}</td><td>${acao}</td></tr>`;
  }).join('');
}
// Situação real do login (entrou ou não) e troca de e-mail de acesso — só o CEO
let ACESSOS = null;
async function carregarAcessos() {
  const { data, error } = await sb.rpc('acessos_status'); if (error) return;
  ACESSOS = {}; (data || []).forEach(x => { ACESSOS[x.pessoa_id] = { entrou: x.entrou, ultimo: x.ultimo_acesso }; }); renderUsuarios();
}
async function trocarEmail(p) {
  const novo = (prompt(`Novo e-mail de acesso de ${p.nome}:\n(atual: ${p.email || '—'})`, '') || '').trim().toLowerCase();
  if (!novo) return;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(novo)) return toast('Digite um e-mail válido');
  if (!confirm(`Trocar o acesso de ${p.nome} para ${novo}?\nO login com o e-mail antigo será desligado e um convite novo será enviado.`)) return;
  const { data, error } = await sb.rpc('trocar_email_pessoa', { p_pessoa: p.id, p_email: novo });
  if (error) return toast('Não foi possível trocar: ' + error.message);
  p.email = novo; p.user_id = null; if (ACESSOS) delete ACESSOS[p.id];
  toast(`E-mail trocado (${data}). Enviando convite…`);
  await convidar(p, novo); setTimeout(async () => { const { data: up } = await sb.from('pessoas').select('id,user_id').eq('id', p.id).maybeSingle(); if (up) p.user_id = up.user_id; carregarAcessos(); }, 2500);
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-trocaremail],[data-reconvidar]'); if (!t) return;
  const p = pessoaPorId(t.dataset.trocaremail || t.dataset.reconvidar); if (!p) return;
  if (t.dataset.trocaremail) trocarEmail(p); else convidar(p, p.email);
});
async function convidar(p, email) {
  email = (email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Digite um e-mail válido');
  if (p.email !== email) {
    const { error } = await sb.from('pessoas').update({ email }).eq('id', p.id);
    if (error) return toast(/duplicate|unique/i.test(error.message) ? 'Esse e-mail já está cadastrado para outra pessoa' : 'Não foi possível salvar: ' + error.message);
    p.email = email;
  }
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname + '?definir=1', shouldCreateUser: true } });
  renderUsuarios();
  if (error) return toast(/rate/i.test(error.message) ? 'Limite de e-mails por hora atingido. O e-mail foi salvo; reenvie o convite mais tarde.' : 'Não foi possível enviar: ' + error.message);
  toast('Convite enviado para ' + email + '. Peça para abrir só o e-mail mais recente, em até 1 hora (os anteriores deixam de valer).');
}
/* ---------------- Ranking e desempenho ---------------- */
function statsVendedor(id, ym) {   // ym aqui é a quinzena (qz)
  const v = COTAS.filter(c => valida(c) && c.vendedor_id === id && naQz(c.venda, ym));
  const canc = COTAS.filter(c => c.status === 'cancelada' && c.vendedor_id === id && naQz(c.venda, ym)).length;
  const cred = v.reduce((s, c) => s + c.credito, 0);
  const decid = v.filter(c => c.p[2] === 'pago' || c.p[2] === 'nao_pago');
  const pagas = decid.filter(c => c.p[2] === 'pago').length;
  const ant = [1, 2, 3].map(i => COTAS.filter(c => valida(c) && c.vendedor_id === id && naQz(c.venda, ym - i)).length);
  return { n: v.length, cred, ticket: v.length ? cred / v.length : 0, decid: decid.length, pagas, est: decid.length - pagas, canc, media3: (ant[0] + ant[1] + ant[2]) / 3 };
}
function renderRanking() {
  if (!$('rkMes').value) return;
  const qz = +$('rkMes').value, ym = Math.floor(qz / 2);
  const metaMes = r('meta_cotas') || 0, meta = Math.round(metaMes / 2), times = EQUIPES.filter(e => e.nome !== 'Administrativo'), metaEq = Math.round(meta / (times.length || 1));
  const vendasMes = COTAS.filter(c => valida(c) && naQz(c.venda, qz)), noMesTodo = COTAS.filter(c => valida(c) && noMes(c.venda, ym)).length;
  const ids = new Set(PESSOAS.filter(p => p.ativo && p.funcao === 'vendedor').map(p => p.id));
  vendasMes.forEach(c => c.vendedor_id && ids.add(c.vendedor_id));
  const lista = [...ids].map(id => ({ p: pessoaPorId(id) || { nome: '—' }, ...statsVendedor(id, qz) }))
    .sort((a, b) => b.n - a.n || b.cred - a.cred || a.p.nome.localeCompare(b.p.nome));
  // Supervisor da quinzena: equipe com mais cotas
  const eqs = times.map(e => { const v = vendasMes.filter(c => c.equipe === e.nome); const sup = PESSOAS.find(p => p.equipe_id === e.id && p.funcao === 'gerente' && p.ativo); return { e, sup, n: v.length, cred: v.reduce((s, c) => s + c.credito, 0) }; })
    .sort((a, b) => b.n - a.n || b.cred - a.cred);
  const top = lista.filter(x => x.n > 0).slice(0, 3);
  const medal = (x, i) => `<div class="medal ${i === 0 ? 'p1' : ''}"><span class="pos">${i + 1}º lugar</span><span class="nm">${esc(x.p.nome)}</span><span class="st">${esc(equipeNome(x.p.equipe_id))}</span><span class="big">${x.n} <span style="font-size:14px;color:var(--muted)">cotas</span></span><span class="st">${brl(x.cred)} em crédito</span></div>`;
  const s0 = eqs[0];
  $('podio').innerHTML = (top.length ? top.map(medal).join('') : '<div class="medal"><span class="st">Nenhuma venda nesta quinzena.</span></div>') +
    (s0 && s0.n ? `<div class="medal sup"><span class="pos">Supervisor da quinzena</span><span class="nm">${esc(s0.sup ? s0.sup.nome : '—')}</span><span class="st">Equipe ${esc(s0.e.nome)}</span><span class="big">${s0.n} <span style="font-size:14px;color:var(--muted)">cotas</span></span><span class="st">${brl(s0.cred)} em crédito</span></div>` : '');
  const cred = vendasMes.reduce((s, c) => s + c.credito, 0);
  const decid = vendasMes.filter(c => c.p[2] === 'pago' || c.p[2] === 'nao_pago'), pagas = decid.filter(c => c.p[2] === 'pago').length;
  const ativos = lista.filter(x => x.n > 0).length;
  const ggMin = r('gg_min_cotas') || 80;
  $('kpisRank').innerHTML =
    kpi('Cotas na quinzena', `${vendasMes.length} <span style="font-size:14px;color:var(--muted)">/ ${meta}</span>`, `${meta ? Math.round(vendasMes.length / meta * 100) : 0}% da meta da quinzena · mês: ${noMesTodo} / ${metaMes}`, `<div class="meter"><i style="width:${Math.min(100, meta ? vendasMes.length / meta * 100 : 0)}%"></i></div>`) +
    kpi('Crédito vendido', brl(cred), `Ticket médio ${brl(vendasMes.length ? cred / vendasMes.length : 0)}`) +
    kpi('2ª parcela paga', decid.length ? `${Math.round(pagas / decid.length * 100)}%` : '—', decid.length ? `${pagas} de ${decid.length} com a 2ª já vencida` : 'Nenhuma 2ª vencida ainda') +
    kpi('Vendedores que venderam', `${ativos} <span style="font-size:14px;color:var(--muted)">/ ${lista.length}</span>`, noMesTodo >= ggMin ? `Bônus do gerente geral garantido no mês (${ggMin}+)` : `Faltam ${ggMin - noMesTodo} cotas no mês para o bônus do gerente geral`);
  $('rkMetaEq').textContent = `meta de ${metaEq} cotas por equipe na quinzena`;
  $('rkEquipes').innerHTML = eqs.map((x, i) => `<div class="row"><div class="l" style="flex:1"><strong>${i + 1}º ${esc(x.e.nome)}</strong><span>${esc(x.sup ? x.sup.nome : 'sem supervisor')} · ${brl(x.cred)}</span><div class="meter" style="margin-top:6px"><i style="width:${Math.min(100, metaEq ? x.n / metaEq * 100 : 0)}%"></i></div></div><b>${x.n} / ${metaEq}</b></div>`).join('');
  const fech = {}; vendasMes.forEach(c => { if (!c.fechador_id) return; const f = fech[c.fechador_id] ||= { n: 0, cred: 0, outra: 0 }; f.n++; f.cred += c.credito; const pv = pessoaPorId(c.vendedor_id), pf = pessoaPorId(c.fechador_id); if (pv && pf && pv.equipe_id !== pf.equipe_id) f.outra++; });
  const fl = Object.entries(fech).sort((a, b) => b[1].n - a[1].n || b[1].cred - a[1].cred);
  $('rkFech').innerHTML = fl.length ? fl.map(([id, f], i) => `<div class="row"><div class="l">${i + 1}º ${esc(nomeP(id))}<span>${brl(f.cred)}${f.outra ? ` · ${f.outra} de outra equipe` : ''}</span></div><b>${f.n} ${f.n === 1 ? 'fechada' : 'fechadas'}</b></div>`).join('') : '<p class="note">Nenhuma venda fechada nesta quinzena.</p>';
  const meses = [5, 4, 3, 2, 1, 0].map(i => ym - i);
  const cont = (eNome, m) => COTAS.filter(c => valida(c) && c.equipe === eNome && noMes(c.venda, m)).length;
  const maxC = Math.max(1, ...times.flatMap(e => meses.map(m => cont(e.nome, m))));
  const cel = n => `<span class="heat" style="background:color-mix(in srgb, var(--celeste) ${Math.round(n / maxC * 55)}%, transparent)">${n}</span>`;
  $('rkEvol').innerHTML = `<thead><tr><th>Equipe</th>${meses.map(m => `<th class="r">${ymLabel(m)}</th>`).join('')}</tr></thead><tbody>` +
    times.map(e => `<tr><td>${esc(e.nome)}</td>${meses.map(m => `<td class="r">${cel(cont(e.nome, m))}</td>`).join('')}</tr>`).join('') +
    `<tr class="total"><td>Loja</td>${meses.map(m => `<td class="r n">${COTAS.filter(c => valida(c) && noMes(c.venda, m)).length}</td>`).join('')}</tr></tbody>`;
  $('tbRank').innerHTML = lista.map((x, i) => {
    const tend = x.media3 ? (x.n - x.media3) / x.media3 : (x.n ? 1 : 0);
    const tTxt = !x.media3 && !x.n ? '—' : `<span class="${tend > 0.05 ? 'trend-up' : tend < -0.05 ? 'trend-down' : ''}">${tend > 0.05 ? '▲' : tend < -0.05 ? '▼' : '='} ${x.media3 ? Math.round(tend * 100) + '%' : 'novo'}</span>`;
    return `<tr><td class="n">${x.n ? i + 1 : '—'}</td><td>${esc(x.p.nome)}${x.p.funcao === 'gerente' ? ' <span class="chip c-aberto">Supervisor</span>' : ''}</td><td>${esc(equipeNome(x.p.equipe_id))}</td><td class="r n"><strong>${x.n}</strong></td><td class="r n">${brl(x.cred)}</td><td class="r n">${x.n ? brl(x.ticket) : '—'}</td><td class="r n">${x.media3.toFixed(1).replace('.', ',')}</td><td class="r n">${tTxt}</td><td class="r n">${x.decid ? `${Math.round(x.pagas / x.decid * 100)}% <span style="color:var(--muted)">(${x.pagas}/${x.decid})</span>` : '—'}</td><td class="r n ${x.est ? 'neg' : ''}">${x.est || '—'}</td><td class="r n">${x.canc || '—'}</td></tr>`;
  }).join('');
}
/* ---------------- Minha comissão (extrato individual) ---------------- */
const tipoLanc = e => e.tipo === 'bon' ? `Bônus de premiação: ${esc(e.camp)}` : e.camp && e.tipo === 'est' ? `Estorno do bônus (100%): ${esc(e.camp)}` : e.camp && e.tipo === 'rec' ? `Bônus devolvido (cliente recuperado): ${esc(e.camp)}` : e.tipo === 'desc' ? (e.papel === 'Tráfego pago' ? 'Desconto: tráfego pago' : e.papel === 'Saldo anterior' ? 'Saldo anterior (negativo)' : e.papel === 'Débito' ? 'Desconto: débito' : 'Desconto') : e.tipo === 'est' ? 'Estorno (2ª não paga)' : e.tipo === 'rec' ? 'Recuperação' : (['Administrativo', 'Gerente adm', 'Supervisor (carteira)'].includes(e.papel) ? 'Parcela paga (3ª a 5ª)' : e.papel === 'Gerente geral' ? 'Bônus do mês' : e.cota && e.cota.antecipada ? 'Venda (antecipada pela loja)' : 'Venda');
function renderMinha() {
  if (!ME || !$('mcSexta').value) return;
  if (veComissoes() && !$('mcPessoa').value) return;
  const alvo = veComissoes() ? pessoaPorId($('mcPessoa').value) : ME;
  if (!alvo) return;
  $('mcTitulo').textContent = veComissoes() && alvo.id !== ME.id ? `Extrato de ${alvo.nome}` : 'Minha comissão';
  const sexta = new Date(+$('mcSexta').value);
  const meus = todosEventosEquipe().filter(e => e.pessoa === alvo.id);
  const daSexta = meus.filter(e => +sextaPagamento(e.data) === +sexta).sort((a, b) => a.data - b.data);
  const soma = l => l.reduce((s, e) => s + e.valor, 0);
  const com = soma(daSexta.filter(e => e.valor > 0)), est = soma(daSexta.filter(e => e.valor < 0 && e.tipo !== 'desc')), dsc = soma(daSexta.filter(e => e.tipo === 'desc'));
  const ymS = ymOf(sexta), noMesPag = meus.filter(e => ymOf(sextaPagamento(e.data)) === ymS);
  const minhasPartes = c => partesVenda(c).partes.filter(x => x.pessoa === alvo.id).reduce((s, x) => s + x.valor, 0);
  const aguard = COTAS.filter(c => valida(c) && !c.confirmada && !c.antecipada).map(c => ({ c, v: minhasPartes(c) })).filter(x => x.v > 0);
  const risco = alertasLista().map(c => ({ c, v: minhasPartes(c) * r('estorno_equipe') / 100 })).filter(x => x.v > 0);
  $('kpisMc').innerHTML =
    kpi(`A receber em ${fdate(sexta)}`, brl(Math.max(0, com + est + dsc), 2), com + est + dsc < 0 ? `<b class="neg">Saldo de ${brl(com + est + dsc, 2)} passa para a próxima sexta</b>` : `${daSexta.filter(e => e.tipo === 'com').length} lançamentos`) +
    kpi('Comissões', brl(com, 2), [est ? `Estornos ${brl(est, 2)}` : 'Sem estornos', dsc ? `Descontos ${brl(dsc, 2)}` : ''].filter(Boolean).join(' · ')) +
    kpi(`Total de ${MESES[ymS % 12]}`, brl(soma(noMesPag), 2), 'Somando todas as sextas do mês') +
    kpi('Aguardando a Disal', brl(aguard.reduce((s, x) => s + x.v, 0), 2), `${aguard.length} ${aguard.length === 1 ? 'venda' : 'vendas'} ainda sem confirmação`);
  $('tbMc').innerHTML = daSexta.length ? daSexta.map(e => {
    const c = e.cota || {}; const gg = String(c.id || '').startsWith('gg');
    return `<tr><td class="n">${fdate(e.data)}</td><td>${gg ? 'Loja: meta de cotas do mês' : esc(c.cliente || '—')}</td><td class="n">${esc(c.contrato || '—')}</td><td>${esc(e.papel)}</td><td>${tipoLanc(e)}</td><td class="r n">${c.credito ? brl(c.credito) : '—'}</td><td class="r n ${e.valor < 0 ? 'neg' : ''}"><strong>${brl(e.valor, 2)}</strong></td></tr>`;
  }).join('') + `<tr class="total"><td colspan="6">Total da sexta</td><td class="r n">${brl(com + est + dsc, 2)}</td></tr>`
    : `<tr><td colspan="7" class="empty">Nada a receber nesta sexta.</td></tr>`;
  $('mcRisco').innerHTML = risco.length ? risco.map(({ c, v }) => `<div class="row"><div class="l">${esc(c.cliente)}<span>2ª vence ${fdate(venc(c, 2))} · ${esc(c.telefone || 'sem telefone')}${stView(c, 2) === 'atrasado' ? ' · <b class="neg">vencida</b>' : ''}</span></div><b class="neg">−${brl(v, 2)}</b></div>`).join('') : '<p class="note">Nenhum cliente seu em risco agora.</p>';
  if ($('mcDeb')) $('mcDeb').innerHTML = meusDebitosHtml(alvo.id);
  $('mcAguard').innerHTML = aguard.length ? aguard.map(({ c, v }) => `<div class="row"><div class="l">${esc(c.cliente)}<span>venda ${fdate(c.venda)} · ${brl(c.credito)}</span></div><b>${brl(v, 2)}</b></div>`).join('') : '<p class="note">Nenhuma venda sua aguardando.</p>';
}
function initFiltros() {
  const yms = [...new Set(COTAS.map(c => ymOf(c.venda)).concat([ymNow]))].sort((a, b) => b - a);
  $('qMes').innerHTML = yms.map(ym => `<option value="${ym}">${ymLabel(ym)}</option>`).join('');
  const qzs = [...new Set(COTAS.map(c => qzOf(c.venda)).concat([qzOf(TODAY)]))].sort((a, b) => b - a);
  const rk = $('rkMes').value; $('rkMes').innerHTML = qzs.map(q => `<option value="${q}">${qzLabel(q)}${q === qzOf(TODAY) ? ' (atual)' : ''}</option>`).join(''); $('rkMes').value = rk || qzOf(TODAY); if (!$('rkMes').value) $('rkMes').value = qzs[0];
  $('qEquipe').innerHTML = '<option value="">Todas</option>' + EQUIPES.filter(e => e.nome !== 'Administrativo').map(e => `<option>${esc(e.nome)}</option>`).join('');
  const sextas = []; let s = addDays(sextaApos(addDays(TODAY, -1)), 7); for (let i = 0; i < 10; i++) { sextas.push(s); s = addDays(s, -7); }
  const mcS = $('mcSexta').value;
  $('qSexta').innerHTML = sextas.map((d, i) => `<option value="${+d}">${d.toLocaleDateString('pt-BR')}${+d === +sextaApos(addDays(TODAY, -1)) ? ' (esta semana)' : i === 0 ? ' (previsão)' : ''}</option>`).join('');
  $('mcSexta').innerHTML = $('qSexta').innerHTML; $('mcSexta').value = mcS || String(+sextaApos(addDays(TODAY, -1)));
  const mcP = $('mcPessoa').value; $('mcPessoa').innerHTML = PESSOAS.filter(p => p.ativo && !['ceo', 'tv'].includes(p.funcao)).sort((a, b) => a.nome.localeCompare(b.nome)).map(p => `<option value="${p.id}">${esc(p.nome)} · ${funcaoNome(p)}</option>`).join(''); if (mcP) $('mcPessoa').value = mcP;
  const ativos = PESSOAS.filter(p => p.ativo);
  const opt = l => l.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
  $('fVend').innerHTML = opt(ativos.filter(p => ['vendedor', 'gerente'].includes(p.funcao)));
  $('fFech').innerHTML = opt(ativos.filter(p => ['gerente', 'vendedor'].includes(p.funcao)));
  $('fAdm').innerHTML = '<option value="">Sem carteira</option>' + opt(ativos.filter(p => ['administrativo', 'gerente_adm'].includes(p.funcao)));
  $('fData').value = iso(TODAY); $('lData').value = iso(TODAY);
}
function renderAll() { renderPainel(); renderCotas(); renderComissoes(); renderAlertas(); renderFin(); renderEquipes(); renderManual(); renderUsuarios(); renderRanking(); renderMinha(); renderTrafego(); renderCarteira(); renderDebitos(); }
function go(view) {
  if (view === 'conferencia') abrirConferencia();
  if (view === 'ranking' && !GESTOR && !$('rkTv').src) $('rkTv').src = 'tv.html?embed=1';
  document.querySelectorAll('[data-page]').forEach(s => s.hidden = s.dataset.page !== view);
  document.querySelectorAll('#nav button').forEach(b => { if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  try { localStorage.setItem('vos_view', view); } catch (e) {}
  window.scrollTo(0, 0);
}

/* ---------------- Ações que gravam no banco ---------------- */
async function salvarParcela(c, k, status) {
  const upd = [{ numero: k, status, pago_em: status === 'pago' ? iso(TODAY) : null }];
  if (k === 2) for (let n = 3; n <= 5; n++) upd.push({ numero: n, status: status === 'nao_pago' ? 'cancelado' : (c.p[n] === 'cancelado' ? 'aberto' : c.p[n]), pago_em: null });
  for (const u of upd) {
    const { error } = await sb.from('parcelas').update({ status: u.status, pago_em: u.pago_em }).eq('cota_id', c.id).eq('numero', u.numero);
    if (error) { toast('Não foi possível salvar: ' + error.message); return; }
    c.p[u.numero] = u.status;
  }
  if (k === 2) { const st = status === 'nao_pago' ? 'estornada' : 'ativa'; await sb.from('cotas').update({ status: st }).eq('id', c.id); c.status = st; }
  if (k === 5 && status === 'pago') { await sb.from('cotas').update({ status: 'concluida' }).eq('id', c.id); c.status = 'concluida'; }
  toast(`${k}ª parcela de ${c.cliente.split(' ')[0]}: ${status === 'pago' ? 'paga' : status === 'nao_pago' ? 'não paga' : 'em aberto'}`);
  renderAll();
}
document.addEventListener('click', async e => {
  const n = e.target.closest('[data-view]'); if (n) go(n.dataset.view);
  const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go);
  const ct = e.target.closest('[data-contato]');
  if (ct) {
    const c = COTAS.find(k => k.id === +ct.dataset.contato);
    const { error } = await sb.from('contatos').insert({ cota_id: c.id, pessoa_id: ME.id, resultado: 'Contato antes da 2ª parcela' });
    if (error) return toast('Não foi possível salvar: ' + error.message);
    c.contato = true; toast('Contato registrado'); renderAlertas();
  }
  const bx = e.target.closest('[data-baixa]');
  if (bx) { const [id, st] = bx.dataset.baixa.split(':'); await salvarParcela(COTAS.find(k => k.id === +id), 2, st); }
  const pc = e.target.closest('[data-parc]');
  if (pc) {
    const [id, k] = pc.dataset.parc.split(':').map(Number); const c = COTAS.find(x => x.id === id);
    const ciclo = k === 2 ? ['aberto', 'pago', 'nao_pago'] : ['aberto', 'pago'];
    if (c.p[k] === 'cancelado') return toast('Parcela cancelada: a 2ª não foi paga.');
    await salvarParcela(c, k, ciclo[(ciclo.indexOf(c.p[k]) + 1) % ciclo.length]);
  }
});
['qMes', 'qEquipe', 'qBusca', 'qSit'].forEach(id => $(id).addEventListener('input', renderCotas));
$('qSexta').addEventListener('change', renderComissoes);
$('rkMes').addEventListener('change', renderRanking);
$('mcSexta').addEventListener('change', renderMinha);
$('mcPessoa').addEventListener('change', renderMinha);
function abrirForm(c) {
  const f = $('formCota'); f.reset(); initFiltros();
  $('fId').value = c ? c.id : '';
  $('fTitulo').textContent = c ? `Editar venda · ${c.cliente}` : 'Cadastrar venda';
  $('lStatus').hidden = !c; $('btnConfirmarDisal').hidden = !(c && GESTOR && !c.confirmada);
  $('fDisalInfo').hidden = !c;
  if (c) {
    const garante = (sel, id) => { if (id && !$(sel).querySelector(`option[value="${id}"]`)) $(sel).insertAdjacentHTML('beforeend', `<option value="${id}">${esc(nomeP(id))} (inativo)</option>`); };
    garante('fVend', c.vendedor_id); garante('fFech', c.fechador_id); garante('fAdm', c.adm_id);
    $('fCliente').value = c.cliente || ''; $('fCpf').value = fmtCpf(c.cpf); $('fTel').value = c.telefone || '';
    $('fCredito').value = c.credito ? fmtBR(c.credito, 0) : ''; $('fParc').value = c.parcela ? fmtBR(c.parcela) : ''; $('fData').value = iso(c.venda);
    $('fVend').value = c.vendedor_id || ''; $('fFech').value = c.fechador_id || c.vendedor_id || '';
    $('fContrato').value = c.contrato || ''; $('fGrupo').value = c.grupo || ''; $('fCotaN').value = c.cotaNum || '';
    $('fVenc').value = c.venc1 || ''; if (c.login) $('fLogin').value = c.login; $('fAdm').value = c.adm_id || '';
    $('fStatus').value = c.status === 'cancelada' ? 'cancelada' : 'ativa';
    $('fCpf').required = false; $('fTel').required = false;
    $('fDisalInfo').textContent = c.confirmada ? `Confirmada na Disal em ${fdate(c.confirmadaEm)}. Comissão liberada.` : 'Aguardando aparecer paga no relatório da Disal. Comissão ainda não liberada.';
  } else { $('fCpf').required = true; $('fTel').required = true; }
  ['fContrato', 'fGrupo', 'fCotaN', 'fVenc'].forEach(k => { $(k).required = false; });   // grupo, cota e contrato saem na Disal no dia seguinte ao pagamento
  $('fAdm').required = false; $('fAdm').disabled = !c;
  if (!c) {   // venda nova: administrativo sai do rodízio automático (um de cada vez)
    $('fAdm').innerHTML = '<option value="">Rodízio automático</option>';
    sb.rpc('proximo_adm_previa').then(({ data }) => { if (data && $('fAdm').disabled) $('fAdm').innerHTML = `<option value="">Rodízio automático · próximo da vez: ${esc(nomeP(data))}</option>`; });
  }
  f.hidden = false; f.scrollIntoView({ behavior: 'smooth', block: 'start' }); $('fCliente').focus();
}
$('btnNova').addEventListener('click', () => abrirForm(null));
$('btnCancelar').addEventListener('click', () => { $('formCota').hidden = true; });
document.addEventListener('click', e => { const b = e.target.closest('[data-editar]'); if (b) abrirForm(COTAS.find(c => c.id === +b.dataset.editar)); });
$('fCpf').addEventListener('blur', () => { $('fCpf').value = fmtCpf($('fCpf').value); });
$('btnConfirmarDisal').addEventListener('click', async () => {
  const c = COTAS.find(x => x.id === +$('fId').value); if (!c) return;
  const { error } = await sb.from('cotas').update({ disal_confirmada: true, disal_confirmada_em: iso(TODAY) }).eq('id', c.id);
  if (error) return toast('Não foi possível confirmar: ' + error.message);
  c.confirmada = true; c.confirmadaEm = TODAY; $('formCota').hidden = true; toast('Venda confirmada na Disal. Comissão liberada.'); renderAll();
});
$('fCredito').addEventListener('input', () => { const v = numValor($('fCredito').value); $('fParc').value = v > 0 ? fmtBR(v * 0.011781) : ''; });
$('formCota').addEventListener('submit', async ev => {
  ev.preventDefault();
  const vend = pessoaPorId($('fVend').value), id = +$('fId').value || null;
  const cpf = soDig($('fCpf').value);
  if (cpf && cpf.length !== 11) return toast('CPF precisa ter 11 números');
  const contrato = $('fContrato').value.trim() || null;
  if (contrato && COTAS.some(c => c.contrato === contrato && c.id !== id)) return toast('Esse contrato já está cadastrado em outra cota');
  const cred1 = numValor($('fCredito').value), parc1 = numValor($('fParc').value) || 0;
  if (!(cred1 >= 10000)) return toast('Confira o crédito: digite assim, 120.000');
  if (Number.isNaN(parc1) || parc1 < 0) return toast('Confira a 1ª parcela: digite assim, 1.488,21');
  if (parc1 > r('entrada')) return toast(`A 1ª parcela (${brl(parc1, 2)}) está maior que a entrada (${brl(r('entrada'))}). Confira a vírgula: o certo é algo como 1309,62.`);
  const row = {
    cliente: $('fCliente').value.trim(), cpf: cpf || null, telefone: $('fTel').value.trim() || null, credito: cred1, parcela_valor: parc1 || null,
    data_venda: $('fData').value, vencimento_1: $('fVenc').value || $('fData').value, contrato, grupo: $('fGrupo').value.trim() || null, cota: $('fCotaN').value.trim() || null,
    login_disal: $('fLogin').value, vendedor_id: vend.id, fechador_id: $('fFech').value, adm_id: $('fAdm').value || null, equipe_id: vend.equipe_id
  };
  if (id) {
    const antes = COTAS.find(c => c.id === id);
    const st = $('fStatus').value === 'cancelada' ? 'cancelada' : (antes.status === 'cancelada' ? 'ativa' : antes.status);
    const { data, error } = await sb.from('cotas').update({ ...row, status: st }).eq('id', id).select('*, parcelas(*)').single();
    if (error) return toast('Não foi possível salvar: ' + error.message);
    if ((antes.venc1 || '') !== row.vencimento_1 && podeBaixar()) {
      const b = parseD(row.vencimento_1);
      for (let n = 1; n <= 5; n++) await sb.from('parcelas').update({ vencimento: iso(new Date(b.getFullYear(), b.getMonth() + n - 1, b.getDate())) }).eq('cota_id', id).eq('numero', n);
      const { data: d2 } = await sb.from('cotas').select('*, parcelas(*)').eq('id', id).single(); if (d2) Object.assign(data, d2);
    }
    const novo = montarCota(data, new Set(antes.contato ? [id] : []));
    COTAS[COTAS.indexOf(antes)] = novo; COTAS.sort((a, b) => b.venda - a.venda);
    $('formCota').hidden = true; toast('Venda atualizada'); renderAll(); return;
  }
  const { data, error } = await sb.from('cotas').insert(row).select('*, parcelas(*)').single();
  if (error) return toast('Não foi possível salvar: ' + error.message);
  COTAS.unshift(montarCota(data, new Set())); COTAS.sort((a, b) => b.venda - a.venda);
  $('formCota').reset(); $('formCota').hidden = true; initFiltros(); $('qMes').value = ymOf(parseD(row.data_venda));
  toast(data.adm_id ? `Venda cadastrada. Administrativo responsável (rodízio): ${nomeP(data.adm_id)}` : 'Venda cadastrada. Aguardando a Disal para liberar a comissão.'); renderAll();
});
$('formLanc').addEventListener('submit', async ev => {
  ev.preventDefault();
  const row = { data: $('lData').value, tipo: $('lTipo').value, categoria: $('lCat').value, descricao: $('lDesc').value || null, valor: +$('lValor').value };
  const { data, error } = await sb.from('lancamentos').insert(row).select().single();
  if (error) return toast('Não foi possível salvar: ' + error.message);
  LANC.unshift({ ...data, data: parseD(data.data), valor: Number(data.valor) });
  $('lValor').value = ''; $('lDesc').value = ''; toast('Lançamento salvo'); renderAll();
});
let regraTimer;
document.addEventListener('input', e => {
  const k = e.target.dataset && e.target.dataset.rule; if (!k || !GESTOR) return;
  const v = parseFloat(e.target.value); if (isNaN(v)) return;
  R[k].valor = v; renderAll();
  clearTimeout(regraTimer);
  regraTimer = setTimeout(async () => { const { error } = await sb.from('regras').update({ valor: v, updated_at: new Date().toISOString() }).eq('chave', k); toast(error ? 'Não foi possível salvar a regra' : 'Regra salva'); }, 700);
});

$('formUsuario').addEventListener('submit', async ev => {
  ev.preventDefault();
  const nome = $('fuNome').value.trim(), email = $('fuEmail').value.trim().toLowerCase();
  if (PESSOAS.some(p => (p.email || '').toLowerCase() === email)) return toast('Esse e-mail já está cadastrado');
  let apelido = nome.split(/\s+/)[0].toUpperCase();
  if (PESSOAS.some(p => p.apelido === apelido)) apelido = nome.toUpperCase().replace(/\s+/g, '_');
  const { error } = await sb.from('pessoas').insert({ nome, apelido, funcao: $('fuFuncao').value, equipe_id: $('fuEquipe').value ? +$('fuEquipe').value : null, ativo: true });
  if (error) return toast('Não foi possível criar: ' + error.message);
  const { data: ps } = await sb.rpc('pessoas_admin'); if (ps) PESSOAS = ps;
  const data = PESSOAS.find(p => p.apelido === apelido); $('formUsuario').reset();
  await convidar(data, email);
});
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-convidar]'); if (!b) return;
  const p = pessoaPorId(b.dataset.convidar);
  const inp = document.querySelector(`[data-email-de="${p.id}"]`);
  b.disabled = true; await convidar(p, inp ? inp.value : p.email); b.disabled = false;
});

/* Vortelli OS — Conferência semanal com o relatório "Comissões a pagar" da Disal (14/10/2026)
   O CEO sobe o arquivo; o sistema lê o borderô, confere contrato por contrato com as vendas cadastradas,
   mostra o que vai mudar e só grava ao clicar em Aplicar. Vendas da representação (DS Capital) ficam à parte
   e geram um PDF para enviar a eles. */

const LIB_XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const LIB_PDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const LIB_PDFT = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
const CF = { rel: null, grupos: [], repr: [], reprLista: [], hist: [], vend: new Map(), salvo: false, carregado: false };

const normNome = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)/g, ' ')
  .toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
const numBR = v => typeof v === 'number' ? v : (v == null || String(v).trim() === '' ? 0 : Number(String(v).replace(/[R$\s.]/g, '').replace(',', '.')) || 0);
function dataBR(v) {
  if (v instanceof Date) return iso(v);
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return iso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
  const m = String(v || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
const dBR = s => s ? s.split('-').reverse().join('/') : '—';
function carregarScript(src, global) {
  return new Promise((ok, err) => {
    if ((global && window[global]) || document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement('script'); s.src = src; s.onload = ok;
    s.onerror = () => err(new Error('não foi possível carregar a biblioteca (' + src.split('/').slice(-2, -1)[0] + ')'));
    document.head.appendChild(s);
  });
}

/* ---------- Leitura do arquivo da Disal ---------- */
function lerRelatorio(rows, arquivo) {
  const rels = []; let cur = null, cols = null, login = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [], t = r.map(x => x == null ? '' : String(x)).join(' ');
    if (!login && r[0] != null) { const lg = String(r[0]).match(/^\s*\d{4,}\s*-\s*(.+?)\s*$/); if (lg) login = lg[1]; }
    const b = t.match(/Border[ôo]\s*:\s*(\d+)\s*-\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (b) {
      cur = { bordero: b[1], data: dataBR(b[2]), login: login || '', arquivo, total: null, itens: [] }; rels.push(cur);
      const tt = t.match(/TOTAL DE COMISS[ÕO]ES\s*:\s*R\$\s*([\d.,]+)/i); if (tt) cur.total = numBR(tt[1]);
      continue;
    }
    if (r.some(x => String(x || '').trim().toLowerCase() === 'contrato')) {
      const up = rows[i - 1] || []; cols = [];
      r.forEach((x, j) => cols.push((String(up[j] || '') + ' ' + String(x || '')).replace(/\s+/g, ' ').trim().toLowerCase()));
      continue;
    }
    if (!cur || !cols) continue;
    const col = re => { const j = cols.findIndex(k => re.test(k)); return j < 0 ? undefined : r[j]; };
    const contrato = String(col(/^contrato$/) ?? '').replace(/\D/g, '');
    if (contrato.length < 5) continue;
    const pcl = parseInt(String(col(/^pcl$/) ?? '').trim(), 10);
    cur.itens.push({
      contrato, cota_txt: String(col(/^cota$/) ?? '').trim(), cliente: String(col(/^cliente$/) ?? '').trim(),
      data_venda: dataBR(col(/data venda/)), pcl: Number.isFinite(pcl) ? pcl : null, base: numBR(col(/base/)),
      com_venda: numBR(col(/^comiss.o venda/)), est_venda: numBR(col(/^est.*venda/)),
      com_entrega: numBR(col(/^comiss.o entrega/)), est_entrega: numBR(col(/^est.*entrega/)),
      vendedor_disal: String(col(/^vendedor$/) ?? '').trim()
    });
  }
  return rels.filter(x => x.itens.length);
}

/* ---------- Conferência com o sistema ---------- */
function acharCota(it, porContrato, porNome) {
  const c = porContrato.get(it.contrato); if (c) return { c, corrigir: false };
  const l = porNome.get(normNome(it.cliente)) || [];
  if (!l.length) return { c: null };
  const alvo = parseD(it.data_venda);
  const best = l.slice().sort((a, b) => Math.abs((a.venda || 0) - alvo) - Math.abs((b.venda || 0) - alvo))[0];
  return { c: best, corrigir: true };
}
function conferir(rel) {
  const porContrato = new Map(COTAS.filter(c => c.contrato).map(c => [String(c.contrato).replace(/\D/g, ''), c]));
  const porNome = new Map(); COTAS.forEach(c => { const k = normNome(c.cliente); if (!porNome.has(k)) porNome.set(k, []); porNome.get(k).push(c); });
  const reprDe = v => CF.reprLista.find(x => x.ativa && (x.vendedores_disal || []).some(n => normNome(n) === normNome(v)));
  const grupos = new Map();
  rel.itens.forEach(it => {
    const rp = reprDe(it.vendedor_disal);
    it.tipo = rp ? 'representacao' : CF.vend.get(normNome(it.vendedor_disal)) === 'externo' ? 'externo' : 'loja'; it.repr = rp || null;
    const k = it.tipo + ':' + it.contrato;
    if (!grupos.has(k)) grupos.set(k, { contrato: it.contrato, cliente: it.cliente, cotaTxt: it.cota_txt, dataVenda: it.data_venda, base: it.base, vendedorDisal: it.vendedor_disal, tipo: it.tipo, repr: rp, linhas: [] });
    grupos.get(k).linhas.push(it);
  });
  const lista = [...grupos.values()];
  lista.filter(g => g.tipo === 'loja').forEach(g => {
    const { c, corrigir } = acharCota(g, porContrato, porNome);
    g.cota = c; g.corrigir = !!(c && corrigir);
    g.linhas.forEach(it => { it.cota_id = c ? c.id : null; });
  });
  // Vendedor da Disal é da Vortelli se já foi marcado assim ou se aparece em algum contrato que está no sistema
  CF.vendLoja = new Set(lista.filter(g => g.tipo === 'loja' && g.cota).map(g => normNome(g.vendedorDisal)));
  lista.filter(g => g.tipo === 'externo').forEach(g => { g.valor = g.linhas.reduce((s, x) => s + x.com_venda + x.est_venda + x.com_entrega + x.est_entrega, 0); });
  lista.filter(g => g.tipo === 'loja').forEach(g => {
    const c = g.cota;
    g.venda = g.linhas.some(x => [1, 2].includes(x.pcl) && x.com_venda > 0);
    g.pclVenda = g.linhas.filter(x => [1, 2].includes(x.pcl) && x.com_venda > 0).map(x => x.pcl);
    g.parcelas = [...new Set(g.linhas.filter(x => x.pcl >= 3 && x.pcl <= 5 && x.com_venda > 0).map(x => x.pcl))].sort();
    g.estorno = g.linhas.reduce((s, x) => s + x.est_venda, 0);
    g.entrega = g.linhas.reduce((s, x) => s + x.com_entrega + x.est_entrega, 0);
    g.valor = g.linhas.reduce((s, x) => s + x.com_venda + x.est_venda + x.com_entrega + x.est_entrega, 0);
    g.acoes = []; g.alertas = []; g.infos = [];
    if (!c) {
      const nv = normNome(g.vendedorDisal);
      if (CF.vend.get(nv) === 'vortelli' || CF.vendLoja.has(nv)) g.alertas.push({ tipo: 'nao_cadastrada', txt: 'Venda da Vortelli que a Disal pagou e não está no sistema. Cadastre para entrar na comissão.' });
      else g.alertas.push({ tipo: 'vendedor_novo', txt: `Vendedor da Disal que nunca apareceu nas vendas da loja: ${g.vendedorDisal || '(sem nome)'}. Ele é da Vortelli ou de outro usuário do login? A escolha vale para as próximas semanas.` });
      return;
    }
    if (g.corrigir) g.acoes.push({ tipo: 'contrato', txt: `Corrigir contrato ${c.contrato || '(vazio)'} → ${g.contrato}` });
    if (g.venda) {
      if (c.status === 'cancelada') g.infos.push('Cancelada em até 7 dias: sem comissão; a Disal estorna no próximo borderô');
      else if (c.status === 'estornada' && c.recuperacao) g.infos.push('Recuperação registrada: a equipe recebe o estorno de volta');
      else if (c.status === 'estornada') g.alertas.push({ tipo: 'recuperacao', txt: `Estornada no sistema e a Disal pagou a ${g.pclVenda.join('ª e ')}ª parcela. Se o cliente voltou a pagar, registre a recuperação (a equipe recebe o estorno de volta).` });
      else if (!c.confirmada) g.acoes.push({ tipo: 'confirmar', txt: 'Confirmar venda paga: libera a comissão' });
      else g.infos.push('Venda já confirmada');
    }
    g.parcelas.forEach(k => {
      if (['cancelada'].includes(c.status)) return g.alertas.push({ tipo: 'parcela_cancelada', txt: `Disal pagou a ${k}ª parcela de uma venda cancelada no sistema.` });
      if (c.p[k] === 'pago') g.infos.push(`${k}ª já baixada`);
      else g.acoes.push({ tipo: 'baixa', k, txt: `Dar baixa na ${k}ª parcela${c.adm_id ? '' : ' (sem administrativo na carteira)'}` });
    });
    if (g.estorno < 0) {
      if (c.status === 'cancelada') g.infos.push('Estorno da venda cancelada (esperado)');
      else if (c.estornoDoc) g.infos.push('Estorno por pendência de documento: não é repassado à equipe');
      else if (c.p[2] === 'nao_pago') g.infos.push('Estorno já registrado');
      else g.alertas.push({ tipo: 'estorno', txt: `A Disal estornou ${brl(-g.estorno, 2)} (${(-g.estorno / g.base * 100).toLocaleString('pt-BR')}% do crédito). Foi pendência de documento (a equipe não devolve) ou o cliente não pagou a 2ª (a equipe devolve 50%)?` });
    }
    if (g.entrega) g.infos.push(`Comissão de entrega ${brl(g.entrega, 2)} (só da loja)`);
  });
  lista.filter(g => g.tipo === 'representacao').forEach(g => {
    const rp = g.repr, imp = rp.desconta_imposto ? r('imposto') / 100 : 0; g.reprLinhas = [];
    const temP1 = g.linhas.some(x => x.pcl === 1 && x.com_venda > 0);
    let estornou = false;
    g.linhas.forEach(x => {
      let pct = 0, desc = '';
      if (x.com_venda > 0 && (x.pcl === 1 || (x.pcl === 2 && !temP1 && !g.reprLinhas.some(l => l.desc === 'Venda')))) { pct = Number(rp.pct_venda); desc = 'Venda'; }
      else if (x.com_venda > 0 && x.pcl >= 3) { pct = Number(rp.pct_parcela); desc = `${x.pcl}ª parcela`; }
      else if (x.est_venda < 0 && !estornou) { pct = -Number(rp.pct_estorno); desc = 'Estorno (2ª não paga)'; estornou = true; }
      if (!pct) return;
      const bruto = x.base * pct / 100, imposto = bruto * imp;
      g.reprLinhas.push({ desc, pct, bruto, imposto, liquido: bruto - imposto });
    });
    if (g.linhas.some(x => x.com_entrega || x.est_entrega)) g.infos = ['Comissão de entrega da Disal: não entra no repasse'];
  });
  return lista;
}

/* ---------- Tela ---------- */
const chipAcao = t => ({ confirmar: '<span class="chip c-pago">Confirmar venda</span>', baixa: '<span class="chip c-pago">Baixa</span>', contrato: '<span class="chip c-atrasado">Corrigir contrato</span>' }[t] || '');
function quem(c) { return c ? `${esc(c.vendedor)}${c.fechador !== c.vendedor ? ' / ' + esc(c.fechador) : ''}` : '—'; }
function renderConferencia() {
  const el = $('cfConteudo'); if (!el) return;
  renderHistorico();
  if (!CF.rel) {
    el.innerHTML = `<div class="panel cf-drop" id="cfDrop"><h2>Nenhum relatório aberto</h2><p class="sub">Toda segunda, baixe na Disal o relatório <b>Comissões a pagar</b> (Excel) e solte aqui, ou use o botão <b>Subir relatório da Disal</b>. Nada é gravado até você clicar em <b>Aplicar</b>.</p></div>`;
    return;
  }
  const R0 = CF.rel, loja = CF.grupos.filter(g => g.tipo === 'loja'), rep = CF.grupos.filter(g => g.tipo === 'representacao');
  const soma = R0.itens.reduce((s, x) => s + x.com_venda + x.est_venda + x.com_entrega + x.est_entrega, 0);
  const bate = R0.total == null || Math.abs(soma - R0.total) < 0.5;
  const acoes = loja.flatMap(g => g.acoes.map(a => ({ ...a, g })));
  const alertas = loja.flatMap(g => g.alertas.map(a => ({ ...a, g })));
  const confirmar = acoes.filter(a => a.tipo === 'confirmar'), baixas = acoes.filter(a => a.tipo === 'baixa');
  const vendasPagas = loja.filter(g => g.venda && g.cota && !['cancelada', 'estornada'].includes(g.cota.status));
  const repLiq = rep.reduce((s, g) => s + g.reprLinhas.reduce((t, l) => t + l.liquido, 0), 0);
  const sexta = sextaPagamento(addDays(parseD(R0.data), -7));
  const repNome = [...new Set(rep.map(g => g.repr.nome))].join(', ') || 'Representação';
  const ext = CF.grupos.filter(g => g.tipo === 'externo');
  const semAdm = loja.filter(g => g.cota && g.parcelas.length && !g.cota.adm_id && g.cota.status !== 'cancelada');
  const admOpts = PESSOAS.filter(p => p.ativo && p.funcao === 'administrativo').sort((a, b) => a.nome.localeCompare(b.nome)).map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
  const somaG = gs => gs.reduce((s, g) => s + g.linhas.reduce((t, x) => t + x.com_venda + x.est_venda + x.com_entrega + x.est_entrega, 0), 0);
  const divisao = `Vortelli <b>${brl(somaG(loja), 2)}</b>${rep.length ? ` · ${esc(repNome)} <b>${brl(somaG(rep), 2)}</b>` : ''}${ext.length ? ` · outros do login <b>${brl(somaG(ext), 2)}</b>` : ''}`;

  el.innerHTML = `
  <div class="panel cf-bordero">
    <div><span class="eyebrow">Borderô ${esc(R0.bordero)} · ${dBR(R0.data)} · login ${esc(R0.login || '—')}</span>
      <h2>${brl(R0.total ?? soma, 2)} a receber da Disal</h2>
      <p class="sub cf-div">${divisao}</p>
      <p class="sub">${R0.itens.length} linhas, ${CF.grupos.length} contratos · arquivo ${esc(R0.arquivo || '')} · ${bate ? '<span class="cf-ok">soma das linhas confere com o total</span>' : `<span class="neg">soma das linhas (${brl(soma, 2)}) diferente do total</span>`}</p></div>
    <div class="cf-bordero-acts">${CF.salvo ? '<span class="chip c-pago">Conferência aplicada</span>' : ''}
      <button class="btn" id="cfFechar" type="button">Fechar</button>
      <button class="btn gold" id="cfAplicar" type="button" ${acoes.length || !CF.salvo ? '' : 'disabled'}>${acoes.length ? `Aplicar ${acoes.length} alteraç${acoes.length > 1 ? 'ões' : 'ão'}` : CF.salvo ? 'Nada a aplicar' : 'Guardar relatório'}</button></div>
  </div>
  <div class="kpis" style="margin:16px 0">
    ${kpi('Vendas pagas pela Disal', vendasPagas.length, `${confirmar.length} a confirmar · comissão na sexta ${fdate(sexta)}`)}
    ${kpi('Parcelas 3ª a 5ª', loja.reduce((s, g) => s + g.parcelas.length, 0), `${baixas.length} a dar baixa${semAdm.length ? ` · ${semAdm.length} venda${semAdm.length > 1 ? 's' : ''} sem administrativo` : ''}`)}
    ${kpi('Para você decidir', alertas.length, alertas.length ? 'veja a lista abaixo' : 'nenhum ponto de atenção')}
    ${kpi(repNome, rep.length ? brl(repLiq, 2) : '—', rep.length ? `${rep.length} contrato${rep.length > 1 ? 's' : ''} · líquido a repassar` : 'nenhuma venda neste borderô')}
  </div>
  ${semAdm.length ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Parcelas pagas sem administrativo</h2><span class="note">escolha quem acompanha o cliente: ele recebe 0,05% das parcelas pagas nesta sexta e nas próximas</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Contrato</th><th>Cliente</th><th>Venda</th><th>Vendedor / fechador</th><th>Parcelas pagas</th><th class="r">Crédito</th><th>Administrativo responsável</th></tr></thead><tbody>
    ${semAdm.map(g => `<tr><td class="num">${esc(g.contrato)}</td><td>${esc(g.cliente)}</td><td class="num">${dBR(g.dataVenda)}</td><td>${quem(g.cota)}</td><td class="num">${g.parcelas.map(k => k + 'ª').join(', ')}</td><td class="r n">${brl(g.base)}</td><td><div class="cf-btns" style="margin:0"><select data-cf-adm="${g.cota.id}" aria-label="Administrativo de ${esc(g.cliente)}"><option value="">Escolher…</option>${admOpts}</select><button class="btn sm" data-cf="adm:${g.cota.id}">Salvar</button></div></td></tr>`).join('')}
    </tbody></table></div></div>` : ''}
  ${alertas.length ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Para você decidir</h2><span class="note">o sistema não muda nada disso sozinho</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Contrato</th><th>Cliente</th><th>Venda</th><th>Vendedor / fechador</th><th class="r">Disal</th><th>O que aconteceu</th></tr></thead><tbody>
    ${alertas.map(a => `<tr><td class="num">${esc(a.g.contrato)}</td><td>${esc(a.g.cliente)}</td><td class="num">${dBR(a.g.dataVenda)}</td><td>${a.g.cota ? quem(a.g.cota) : `<span class="note">Disal: ${esc(a.g.vendedorDisal)}</span>`}</td><td class="r n ${a.g.valor < 0 ? 'neg' : ''}">${brl(a.g.valor, 2)}</td><td class="cf-wrap">${esc(a.txt)}<div class="cf-btns">${botaoAlerta(a)}</div></td></tr>`).join('')}
    </tbody></table></div></div>` : ''}
  <div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Vendas da loja no borderô</h2><span class="note">${acoes.length ? 'em dourado: o que muda ao clicar em Aplicar' : 'tudo já está em dia no sistema'}</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Contrato</th><th>Cliente</th><th>Venda</th><th>Pcl</th><th>Vendedor / fechador</th><th class="r">Crédito</th><th class="r">Disal</th><th>Situação</th></tr></thead><tbody>
    ${loja.sort((a, b) => (b.dataVenda || '').localeCompare(a.dataVenda || '')).map(g => `<tr class="${g.acoes.length ? 'cf-muda' : ''}"><td class="num">${esc(g.contrato)}</td><td>${esc(g.cliente)}</td><td class="num">${dBR(g.dataVenda)}</td><td class="num">${g.linhas.map(x => x.pcl || 'E').join(', ')}</td><td>${g.cota ? quem(g.cota) : '<span class="note">não cadastrada</span>'}</td><td class="r n">${brl(g.base)}</td><td class="r n ${g.valor < 0 ? 'neg' : ''}">${brl(g.valor, 2)}</td><td class="cf-wrap">${[...g.acoes.map(a => `<span class="cf-tag">${esc(a.txt)}</span>`), ...g.alertas.map(() => '<span class="chip c-atrasado">Decidir</span>'), ...g.infos.map(t => `<span class="note">${esc(t)}</span>`)].join(' ') || '<span class="note">—</span>'}</td></tr>`).join('')}
    </tbody></table></div></div>
  ${rep.length ? renderRepr(rep) : ''}
  ${ext.length ? `<details class="panel" style="margin-bottom:16px"><summary><b>Outros do login</b> <span class="note">· ${ext.length} contrato${ext.length > 1 ? 's' : ''} de vendedores que não são da Vortelli, fora da conferência</span></summary>
    <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Contrato</th><th>Cliente</th><th>Venda</th><th>Vendedor na Disal</th><th class="r">Disal</th><th></th></tr></thead><tbody>
    ${ext.map(g => `<tr><td class="num">${esc(g.contrato)}</td><td>${esc(g.cliente)}</td><td class="num">${dBR(g.dataVenda)}</td><td>${esc(g.vendedorDisal)}</td><td class="r n ${g.valor < 0 ? 'neg' : ''}">${brl(g.valor, 2)}</td><td><button class="btn sm ghost" data-cf="vend:vortelli:${esc(g.vendedorDisal)}">É da Vortelli</button></td></tr>`).join('')}
    </tbody></table></div></details>` : ''}`;
}
function botaoAlerta(a) {
  const c = a.g.cota;
  if (a.tipo === 'estorno' && c) return `<button class="btn sm" data-cf="doc:${c.id}">Pendência de documento</button> <button class="btn sm ghost" data-cf="estorno:${c.id}">Cliente não pagou a 2ª</button>`;
  if (a.tipo === 'recuperacao' && c && !c.recuperacao) return `<button class="btn sm" data-cf="recuperacao:${c.id}">Registrar recuperação</button>`;
  if (a.tipo === 'nao_cadastrada') return `<button class="btn sm" data-cf="cadastrar:${a.g.contrato}">Cadastrar venda</button>`;
  if (a.tipo === 'vendedor_novo') return `<button class="btn sm" data-cf="vend:vortelli:${esc(a.g.vendedorDisal)}">É da Vortelli</button> <button class="btn sm ghost" data-cf="vend:externo:${esc(a.g.vendedorDisal)}">Não é nosso</button>`;
  return '';
}
function renderRepr(rep) {
  const nomes = [...new Set(rep.map(g => g.repr.nome))];
  return nomes.map(nome => {
    const gs = rep.filter(g => g.repr.nome === nome), rp = gs[0].repr;
    const linhas = gs.flatMap(g => g.reprLinhas.map(l => ({ g, l })));
    const tot = k => linhas.reduce((s, x) => s + x.l[k], 0);
    return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>${esc(nome)} · representação</h2>
      <span class="note">${String(rp.pct_venda).replace('.', ',')}% na venda, ${String(rp.pct_parcela).replace('.', ',')}% na 3ª, 4ª e 5ª, −${String(rp.pct_estorno).replace('.', ',')}% no estorno${rp.desconta_imposto ? ` · imposto de ${String(r('imposto')).replace('.', ',')}% descontado` : ''}. Não entra no ranking nem na comissão da loja.</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>Contrato</th><th>Cliente</th><th>Venda</th><th>Lançamento</th><th class="r">Crédito</th><th class="r">%</th><th class="r">Bruto</th><th class="r">Imposto</th><th class="r">Líquido</th></tr></thead><tbody>
      ${linhas.map(({ g, l }) => `<tr><td class="num">${esc(g.contrato)}</td><td>${esc(g.cliente)}</td><td class="num">${dBR(g.dataVenda)}</td><td>${esc(l.desc)}</td><td class="r n">${brl(g.base)}</td><td class="r n">${l.pct.toLocaleString('pt-BR')}%</td><td class="r n ${l.bruto < 0 ? 'neg' : ''}">${brl(l.bruto, 2)}</td><td class="r n">${brl(-l.imposto, 2)}</td><td class="r n"><strong>${brl(l.liquido, 2)}</strong></td></tr>`).join('') || '<tr><td colspan="9" class="empty">Nenhum lançamento com repasse.</td></tr>'}
      <tr class="total"><td colspan="6">Total a repassar</td><td class="r n">${brl(tot('bruto'), 2)}</td><td class="r n">${brl(-tot('imposto'), 2)}</td><td class="r n">${brl(tot('liquido'), 2)}</td></tr>
      </tbody></table></div>
      <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn gold" type="button" data-cf="pdf:${esc(nome)}">Gerar relatório em PDF</button><span class="note">Arquivo pronto para enviar à ${esc(nome)}.</span></div></div>`;
  }).join('');
}
function renderHistorico() {
  const el = $('cfHist'); if (!el) return;
  el.innerHTML = CF.hist.length ? `<div class="tbl-wrap"><table><thead><tr><th>Borderô</th><th>Data</th><th>Login</th><th class="r">Total</th><th>Conferido em</th><th></th></tr></thead><tbody>
    ${CF.hist.map(h => `<tr><td class="num">${esc(h.bordero)}</td><td class="num">${dBR(h.data)}</td><td>${esc(h.login || '—')}</td><td class="r n">${h.total != null ? brl(Number(h.total), 2) : '—'}</td><td class="num">${h.aplicado_em ? new Date(h.aplicado_em).toLocaleDateString('pt-BR') : '—'}</td><td><button class="btn sm" data-cf="hist:${h.id}">Abrir</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="empty">Nenhum relatório conferido ainda.</p>';
}

/* ---------- Ações ---------- */
async function carregarBaseConferencia() {
  const [rp, hs, vd] = await Promise.all([sb.from('representacoes').select('*'), sb.from('disal_relatorios').select('*').order('data', { ascending: false }).limit(30), sb.from('disal_vendedores').select('*')]);
  if (rp.error) throw rp.error;
  CF.reprLista = rp.data || []; CF.hist = hs.data || []; CF.carregado = true;
  CF.vend = new Map((vd.data || []).map(v => [normNome(v.nome), v.dono]));
}
async function abrirConferencia() {
  if (!GESTOR) return;
  try { if (!CF.carregado) await carregarBaseConferencia(); } catch (e) { $('cfConteudo').innerHTML = `<div class="panel"><p class="neg">Não foi possível abrir a conferência: ${esc(e.message || e)}</p></div>`; return; }
  renderConferencia();
}
/* Relatório da Disal em PDF ou imagem: monta as mesmas linhas da planilha para a conferência */
const LIB_OCR = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const PROD_DISAL = /^(AUTOM[OÓ]VE(?:L|IS)|IM[OÓ]VE(?:L|IS)|MOTOCICLETAS?|MOTOS?|CAMINH[AÃ]O|CAMINH[OÕ]ES|PESADOS?|SERVI[CÇ]OS?|VE[IÍ]CULOS?|N[AÁ]UTICOS?|AGR[IÍ]COLAS?|ELETRO\w*)$/i;
const RE_LINHA_DISAL = /^(\d{6,8})\s+(\d{3,6}\/[\d.]+)\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{1,3})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s*(.*)$/;
// itens: [{ s: texto, x, y, p: página }] com y maior = mais acima na página
function linhasDisal(itens, tol) {
  const l = itens.filter(i => String(i.s || '').trim()).sort((a, b) => a.p - b.p || b.y - a.y || a.x - b.x), out = [];
  l.forEach(i => { const u = out[out.length - 1]; if (u && u.p === i.p && Math.abs(u.y - i.y) <= tol) u.itens.push(i); else out.push({ p: i.p, y: i.y, itens: [i] }); });
  out.forEach(L => { L.itens.sort((a, b) => a.x - b.x); L.txt = L.itens.map(i => i.s.trim()).join(' ').replace(/\s+/g, ' ').trim(); });
  return out;
}
function rowsDeItensDisal(itens, tol) {
  const rows = [], HEAD = ['Contrato', 'Cota', 'Cliente', 'Data Venda', 'Pcl', 'Base (R$)', 'Comissão Venda(R$)', 'Est. Comis Venda(R$)', 'Comissão Entrega(R$)', 'Est. Comis Entrega(R$)', 'Vendedor'];
  let cur = null, cab = false;
  linhasDisal(itens, tol).forEach(L => {
    const t = L.txt;
    if (/Border[ôo]\s*:/i.test(t)) { rows.push([t], [], HEAD); cab = true; cur = null; return; }
    if (!cab) { const lg = t.match(/^(\d{4,}\s*-\s*[A-ZÀ-Ú][A-ZÀ-Ú .&]*?)(?=\s+TOTAL|\s{2,}|$)/); if (lg) rows.push([lg[1].trim()]); return; }
    if (/^Contrato\b|Totais|TOTAL/i.test(t)) { cur = null; return; }
    // linha principal: tira o produto (AUTOMOVEL etc.) que fica entre o cliente e as datas
    const iData = L.itens.findIndex(i => /^\d{2}\/\d{2}\/\d{4}$/.test(i.s.trim()));
    const limpos = L.itens.filter((i, k) => !(iData > 0 && k < iData && PROD_DISAL.test(i.s.trim())));
    const m = limpos.map(i => i.s.trim()).join(' ').replace(/\s+/g, ' ').match(RE_LINHA_DISAL);
    if (m) {
      const row = [m[1], m[2], m[3], m[4], m[6], m[7], m[8], m[9], m[10], m[11], m[12].trim()];
      rows.push(row);
      const numIdx = L.itens.map((i, k) => /^-?[\d.]+,\d{2}$/.test(i.s.trim()) ? k : -1).filter(k => k >= 0);
      const depois = numIdx.length ? L.itens.slice(numIdx[numIdx.length - 1] + 1).find(i => /[A-Za-zÀ-ú]/.test(i.s)) : null;
      cur = { row, p: L.p, xData: iData >= 0 ? L.itens[iData].x : Infinity, xVend: depois ? depois.x : Infinity };
      return;
    }
    // continuação: o nome do cliente ou do vendedor quebrou para a linha de baixo
    if (!cur || cur.p !== L.p) { cur = null; return; }
    L.itens.forEach(i => {
      const s = i.s.trim(); if (!s || /\d/.test(s) || PROD_DISAL.test(s)) return;
      if (i.x >= cur.xVend - 3) cur.row[10] = (cur.row[10] + ' ' + s).trim();
      else if (i.x < cur.xData - 3) cur.row[2] = (cur.row[2] + ' ' + s).trim();
    });
  });
  return rows;
}
async function itensDePdfDisal(file) {
  const lib = await carregarPdfjs();
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise, itens = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const pg = await pdf.getPage(p), tc = await pg.getTextContent();
    tc.items.forEach(it => { if (it.str && it.str.trim()) itens.push({ s: it.str, x: it.transform[4], y: it.transform[5], p }); });
  }
  return itens;
}
async function itensDeImagemDisal(file) {
  await carregarScript(LIB_OCR, 'Tesseract');
  const r = await window.Tesseract.recognize(file, 'por');
  const ws = (r.data.words || []).map(w => ({ s: w.text, x: w.bbox.x0, y: -w.bbox.y0, h: w.bbox.y1 - w.bbox.y0, p: 1 }));
  const hs = ws.map(w => w.h).sort((a, b) => a - b), hMed = hs.length ? hs[Math.floor(hs.length / 2)] : 10;
  return { itens: ws, tol: Math.max(3, hMed * 0.6) };
}
async function rowsDoArquivoDisal(file) {
  const nome = (file.name || '').toLowerCase(), tipo = file.type || '';
  if (/pdf/.test(tipo) || nome.endsWith('.pdf')) {
    const itens = await itensDePdfDisal(file);
    if (itens.length < 20) throw new Error('o PDF não tem texto (parece escaneado). Tire um print da tela e suba como imagem.');
    return rowsDeItensDisal(itens, 1.5);
  }
  if (/^image\//.test(tipo) || /\.(png|jpe?g|webp)$/.test(nome)) {
    toast('Lendo a imagem… pode levar alguns segundos.');
    const { itens, tol } = await itensDeImagemDisal(file);
    return rowsDeItensDisal(itens, tol);
  }
  await carregarScript(LIB_XLSX, 'XLSX');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
}
async function lerArquivo(file) {
  if (!file) return;
  try {
    if (!CF.carregado) await carregarBaseConferencia();
    const rows = await rowsDoArquivoDisal(file);
    const rels = lerRelatorio(rows, file.name);
    if (!rels.length) return toast('Não encontrei o borderô nesse arquivo. É o relatório "Comissões a pagar" da Disal?');
    if (rels.length > 1) toast(`O arquivo tem ${rels.length} borderôs; abrindo o primeiro (${rels[0].bordero}).`);
    CF.rel = rels[0]; CF.grupos = conferir(CF.rel);
    CF.salvo = CF.hist.some(h => h.bordero === CF.rel.bordero && (h.login || '') === CF.rel.login);
    renderConferencia(); $('cfConteudo').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { console.error(e); toast('Erro ao ler o arquivo: ' + (e.message || e)); }
}
async function abrirHistorico(id) {
  const h = CF.hist.find(x => x.id === id); if (!h) return;
  const { data, error } = await sb.from('disal_itens').select('*').eq('relatorio_id', id).order('id');
  if (error) return toast('Não foi possível abrir: ' + error.message);
  CF.rel = { bordero: h.bordero, data: h.data, login: h.login || '', arquivo: h.arquivo, total: h.total != null ? Number(h.total) : null,
    itens: data.map(x => ({ ...x, base: Number(x.base), com_venda: Number(x.com_venda), est_venda: Number(x.est_venda), com_entrega: Number(x.com_entrega), est_entrega: Number(x.est_entrega) })) };
  CF.grupos = conferir(CF.rel); CF.salvo = true; renderConferencia(); window.scrollTo(0, 0);
}
async function aplicarConferencia() {
  const R0 = CF.rel, b = $('cfAplicar'); b.disabled = true; b.textContent = 'Aplicando…';
  const erros = [];
  try {
    let { data: rel, error } = await sb.from('disal_relatorios').select('id').eq('bordero', R0.bordero).eq('login', R0.login).maybeSingle();
    if (error) throw error;
    if (!rel) {
      ({ data: rel, error } = await sb.from('disal_relatorios').insert({ bordero: R0.bordero, data: R0.data, login: R0.login, total: R0.total, arquivo: R0.arquivo }).select('id').single());
      if (error) throw error;
    } else {
      ({ error } = await sb.from('disal_itens').delete().eq('relatorio_id', rel.id)); if (error) throw error;
    }
    ({ error } = await sb.from('disal_itens').insert(R0.itens.map(x => ({
      relatorio_id: rel.id, contrato: x.contrato, cota_txt: x.cota_txt, cliente: x.cliente, data_venda: x.data_venda, pcl: x.pcl, base: x.base,
      com_venda: x.com_venda, est_venda: x.est_venda, com_entrega: x.com_entrega, est_entrega: x.est_entrega, vendedor_disal: x.vendedor_disal,
      cota_id: x.tipo === 'loja' ? x.cota_id : null, tipo: x.tipo, situacao: null }))));
    if (error) throw error;
    const dataB = R0.data, dB = parseD(dataB);
    for (const g of CF.grupos.filter(x => x.tipo === 'loja' && x.cota)) {
      const c = g.cota;
      for (const a of g.acoes) {
        let res;
        if (a.tipo === 'contrato') { res = await sb.from('cotas').update({ contrato: g.contrato }).eq('id', c.id); if (!res.error) c.contrato = g.contrato; }
        if (a.tipo === 'confirmar') { res = await sb.from('cotas').update({ disal_confirmada: true, disal_confirmada_em: dataB }).eq('id', c.id); if (!res.error) { c.confirmada = true; c.confirmadaEm = dB; } }
        if (a.tipo === 'baixa') {
          const jaPago = c.p[a.k] === 'pago';
          res = await sb.from('parcelas').update(jaPago ? { disal_em: dataB } : { status: 'pago', pago_em: dataB, disal_em: dataB }).eq('cota_id', c.id).eq('numero', a.k);
          if (!res.error) { c.p[a.k] = 'pago'; (c.disalEm ||= {})[a.k] = dB; }
          if (!res.error && a.k === 5) { await sb.from('cotas').update({ status: 'concluida' }).eq('id', c.id); c.status = 'concluida'; }
        }
        if (res && res.error) erros.push(`${g.contrato}: ${res.error.message}`);
      }
    }
    const novos = [...new Set(CF.grupos.filter(g => g.tipo === 'loja' && g.cota && g.vendedorDisal).map(g => g.vendedorDisal))].filter(n => !CF.vend.has(normNome(n)));
    if (novos.length) await sb.from('disal_vendedores').upsert(novos.map(nome => ({ nome, dono: 'vortelli' })), { onConflict: 'nome', ignoreDuplicates: true });
    await carregarBaseConferencia();
    CF.grupos = conferir(R0); CF.salvo = true;
    renderAll(); renderConferencia();
    toast(erros.length ? `Aplicado com ${erros.length} erro(s): ${erros[0]}` : 'Conferência aplicada. Comissões atualizadas.');
  } catch (e) { console.error(e); toast('Não foi possível aplicar: ' + (e.message || e)); renderConferencia(); }
}
async function gerarPdfRepr(nome) {
  try { await carregarScript(LIB_PDF, 'jspdf'); await carregarScript(LIB_PDFT); } catch (e) { return toast('Erro: ' + e.message); }
  const R0 = CF.rel, gs = CF.grupos.filter(g => g.tipo === 'representacao' && g.repr.nome === nome), rp = gs[0].repr;
  const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const m = v => brl(v, 2).replace('−', '-').replace(/\u00a0/g, ' ');
  const pct = v => String(v).replace('.', ',') + '%';
  doc.setFillColor(15, 37, 71); doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text(`Relatório de comissões - ${nome}`, 14, 13);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`Borderô Disal ${R0.bordero} de ${dBR(R0.data)}${R0.login ? ' · login ' + R0.login : ''}`, 14, 21);
  doc.setTextColor(13, 26, 48); doc.setFontSize(10);
  doc.text(`Coordenação: ${ME ? ME.nome : ''} · Vortelli Consórcio e Financiamento`, 14, 37);
  doc.text(`Regra: ${pct(rp.pct_venda)} do crédito na venda, ${pct(rp.pct_parcela)} na 3ª, 4ª e 5ª parcela, -${pct(rp.pct_estorno)} se o cliente não pagar a 2ª.${rp.desconta_imposto ? ` Imposto de ${pct(r('imposto'))} descontado.` : ''}`, 14, 43, { maxWidth: 182 });
  const linhas = gs.flatMap(g => g.reprLinhas.map(l => [g.contrato, String(g.cotaTxt || '').replace(/\.0+$/, ''), g.cliente, dBR(g.dataVenda), l.desc, m(g.base), pct(l.pct.toLocaleString('pt-BR')).replace(/,%$/, '%'), m(l.bruto), m(-l.imposto), m(l.liquido)]));
  const tot = k => gs.reduce((s, g) => s + g.reprLinhas.reduce((t, l) => t + l[k], 0), 0);
  doc.autoTable({
    startY: 52, head: [['Contrato', 'Grupo/cota', 'Cliente', 'Venda', 'Lançamento', 'Crédito', '%', 'Bruto', 'Imposto', 'Líquido']], body: linhas,
    foot: [['', '', '', '', 'Total', '', '', m(tot('bruto')), m(-tot('imposto')), m(tot('liquido'))]],
    styles: { fontSize: 8, cellPadding: 1.8 }, headStyles: { fillColor: [15, 37, 71] }, footStyles: { fillColor: [245, 236, 217], textColor: [13, 26, 48], fontStyle: 'bold' },
    columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right', fontStyle: 'bold' } }
  });
  const y = doc.lastAutoTable.finalY + 10;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(`Total líquido a receber: ${m(tot('liquido'))}`, 14, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(90, 105, 132);
  doc.text(`Gerado em ${new Date().toLocaleDateString('pt-BR')} pelo Vortelli OS a partir do relatório "Comissões a pagar" da Disal.`, 14, 287);
  doc.save(`${nome.replace(/\s+/g, '_')}_bordero_${R0.bordero}.pdf`);
}
function cadastrarDoRelatorio(contrato) {
  const g = CF.grupos.find(x => x.contrato === contrato); go('cotas'); abrirForm(null);
  $('fCliente').value = g.cliente; $('fContrato').value = g.contrato; $('fCredito').value = g.base ? fmtBR(g.base, 0) : '';
  if (g.dataVenda) $('fData').value = g.dataVenda;
  const [grupo, cota] = String(g.cotaTxt || '').split('/'); if (grupo) $('fGrupo').value = String(+grupo || grupo); if (cota) $('fCotaN').value = String(parseInt(cota, 10) || cota);
  toast('Complete vendedor, fechador, CPF e telefone. Depois suba o relatório de novo para confirmar a venda.');
}

/* ---------- Eventos ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-cf]'); if (!b) return;
  const [acao, arg] = b.dataset.cf.split(/:(.*)/s);
  if (acao === 'estorno') { await salvarParcela(COTAS.find(c => c.id === +arg), 2, 'nao_pago'); CF.grupos = conferir(CF.rel); renderConferencia(); }
  if (acao === 'recuperacao') {
    const c = COTAS.find(x => x.id === +arg);
    const { error } = await sb.from('cotas').update({ recuperacao_data: CF.rel.data }).eq('id', c.id);
    if (error) return toast('Não foi possível salvar: ' + error.message);
    c.recuperacao = parseD(CF.rel.data); toast('Recuperação registrada: a equipe recebe o estorno de volta.'); renderAll(); CF.grupos = conferir(CF.rel); renderConferencia();
  }
  if (acao === 'doc') {
    const c = COTAS.find(x => x.id === +arg);
    const { error } = await sb.from('cotas').update({ estorno_documento: true }).eq('id', c.id);
    if (error) return toast('Não foi possível salvar: ' + error.message);
    c.estornoDoc = true; toast('Registrado: estorno por pendência de documento. A equipe não devolve.'); renderAll(); CF.grupos = conferir(CF.rel); renderConferencia();
  }
  if (acao === 'vend') {
    const [dono, nome] = arg.split(/:(.*)/s);
    const { error } = await sb.from('disal_vendedores').upsert({ nome, dono, updated_at: new Date().toISOString() }, { onConflict: 'nome' });
    if (error) return toast('Não foi possível salvar: ' + error.message);
    CF.vend.set(normNome(nome), dono);
    if (CF.salvo) await sb.from('disal_itens').update(dono === 'externo' ? { tipo: 'externo', cota_id: null } : { tipo: 'loja' }).eq('vendedor_disal', nome);
    toast(dono === 'externo' ? `${nome}: outros do login. Não entra mais na conferência.` : `${nome}: vendedor da Vortelli.`);
    CF.grupos = conferir(CF.rel); renderConferencia();
  }
  if (acao === 'adm') {
    const sel = document.querySelector(`[data-cf-adm="${arg}"]`), c = COTAS.find(x => x.id === +arg);
    if (!sel || !sel.value) return toast('Escolha o administrativo');
    const { error } = await sb.from('cotas').update({ adm_id: sel.value }).eq('id', c.id);
    if (error) return toast('Não foi possível salvar: ' + error.message);
    c.adm_id = sel.value; c.adm = nomeP(sel.value);
    toast(`${c.cliente.split(' ')[0]}: carteira de ${c.adm}`); renderAll(); CF.grupos = conferir(CF.rel); renderConferencia();
  }
  if (acao === 'cadastrar') cadastrarDoRelatorio(arg);
  if (acao === 'abrir') { go('cotas'); abrirForm(COTAS.find(c => c.id === +arg)); }
  if (acao === 'pdf') gerarPdfRepr(arg);
  if (acao === 'hist') abrirHistorico(+arg);
});
document.addEventListener('click', e => {
  if (e.target.closest('#cfAplicar')) aplicarConferencia();
  if (e.target.closest('#cfFechar')) { CF.rel = null; CF.grupos = []; renderConferencia(); }
});
$('cfArquivo').addEventListener('change', e => { lerArquivo(e.target.files[0]); e.target.value = ''; });
const secConf = document.querySelector('[data-page="conferencia"]');
secConf.addEventListener('dragover', e => { e.preventDefault(); secConf.classList.add('cf-arrastando'); });
secConf.addEventListener('dragleave', e => { if (!secConf.contains(e.relatedTarget)) secConf.classList.remove('cf-arrastando'); });
secConf.addEventListener('drop', e => { e.preventDefault(); secConf.classList.remove('cf-arrastando'); lerArquivo(e.dataTransfer.files[0]); });

/* >>> TRAFEGO >>> */
/* ---------------- Tráfego pago (Meta) e descontos na comissão ---------------- */
// Gasto de cada consultor por dia. A semana (segunda a domingo) é descontada na sexta da semana seguinte,
// a mesma sexta em que as vendas daquela semana são pagas. Percentual em Regras (trafego_desconto).
const TR = { prev: null, vinc: null };
const pctTr = () => (R.trafego_desconto ? r('trafego_desconto') : 100) / 100;
const segundaDe = d => addDays(d, -((d.getDay() + 6) % 7));
const tira = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
async function carregarTrafego() {
  try {
    const [tg, ds] = await Promise.all([
      tudo(() => sb.from('trafego_gastos').select('id,data,bm,campanha,conjunto,anuncio,pessoa_id,gasto,leads').order('data')),
      sb.from('descontos').select('*').order('data')
    ]);
    if (ds.error) throw ds.error;
    TRAF = tg.map(t => ({ ...t, gasto: Number(t.gasto), leads: Number(t.leads) }));
    DESC = (ds.data || []).map(x => ({ ...x, valor: Number(x.valor) }));
  } catch (e) { console.warn('Tráfego ainda não disponível:', e.message || e); TRAF = []; DESC = []; }
}
function eventosDescontos() {
  const pct = pctTr(), sem = {}, ev = [];
  TRAF.forEach(t => {
    if (!t.pessoa_id || !t.gasto) return;
    const seg = segundaDe(parseD(t.data)), k = t.pessoa_id + '|' + iso(seg);
    (sem[k] ||= { pessoa: t.pessoa_id, seg, gasto: 0 }).gasto += t.gasto;
  });
  Object.values(sem).forEach(s => ev.push({ pessoa: s.pessoa, papel: 'Tráfego pago', data: s.seg, valor: -Math.round(s.gasto * pct * 100) / 100, tipo: 'desc',
    cota: { id: 'tr' + s.pessoa + iso(s.seg), cliente: `Tráfego pago ${fdate(s.seg)} a ${fdate(addDays(s.seg, 6))}` } }));
  DESC.forEach(x => ev.push({ pessoa: x.pessoa_id, papel: 'Desconto', data: parseD(x.data), valor: -x.valor, tipo: 'desc', cota: { id: 'ds' + x.id, cliente: x.descricao || 'Desconto' } }));
  return ev.filter(e => ativoEm(e.pessoa, e.data));
}

/* Tela */
function renderTrafego() {
  if (!ME || !$('trSemana')) return;
  if (!$('trSemana').options.length) {
    const seg = segundaDe(TODAY);
    $('trSemana').innerHTML = Array.from({ length: 12 }, (_, i) => addDays(seg, -7 * i)).map((d, i) => `<option value="${+d}">${fdate(d)} a ${fdate(addDays(d, 6))}${i === 0 ? ' (esta semana)' : ''}</option>`).join('');
  }
  const ini = new Date(+$('trSemana').value), fim = addDays(ini, 6), sexta = sextaPagamento(ini), pct = pctTr();
  const doPer = TRAF.filter(t => { const d = parseD(t.data); return d >= ini && d <= fim; });
  const por = {};
  doPer.forEach(t => { const m = por[t.pessoa_id || ''] ||= { id: t.pessoa_id || '', gasto: 0, leads: 0 }; m.gasto += t.gasto; m.leads += t.leads; });
  const vendasDe = id => COTAS.filter(c => valida(c) && c.vendedor_id === id && c.venda >= ini && c.venda <= fim).length;
  const lista = Object.values(por).map(m => ({ ...m, vendas: m.id ? vendasDe(m.id) : 0 })).sort((a, b) => (!a.id) - (!b.id) || b.gasto - a.gasto);
  const consult = lista.filter(m => m.id), g = lista.reduce((s, m) => s + m.gasto, 0), l = lista.reduce((s, m) => s + m.leads, 0), v = consult.reduce((s, m) => s + m.vendas, 0);
  const desc = consult.reduce((s, m) => s + m.gasto * pct, 0);
  const ultimo = TRAF.length ? TRAF.reduce((a, t) => t.data > a ? t.data : a, '') : null;
  $('trSub').textContent = `Gasto de cada consultor na Meta. A semana é descontada da comissão na sexta seguinte (${fdate(sexta)}), junto com as vendas da semana.${ultimo ? ` Dados até ${dBR(ultimo)}.` : ''}`;
  $('kpisTr').innerHTML = kpi('Gasto na semana', brl(g, 2), `${fdate(ini)} a ${fdate(fim)}`) + kpi('Leads', l.toLocaleString('pt-BR'), l ? `${brl(g / l, 2)} por lead` : 'sem leads') +
    kpi('Vendas', v, v ? `${brl(consult.reduce((s, m) => s + m.gasto, 0) / v, 2)} de tráfego por venda` : 'nenhuma venda na semana') +
    kpi(`Desconto em ${fdate(sexta)}`, brl(desc, 2), `${Math.round(pct * 100)}% do gasto de cada consultor`);
  $('tbTr').innerHTML = lista.length ? lista.map(m => {
    const p = pessoaPorId(m.id) || {};
    return `<tr><td>${m.id ? esc(p.nome || '—') : '<span class="note">Sem consultor (a loja paga)</span>'}</td><td>${m.id ? esc(equipeNome(p.equipe_id)) : '—'}</td><td class="r n">${brl(m.gasto, 2)}</td><td class="r n">${m.leads}</td><td class="r n">${m.leads ? brl(m.gasto / m.leads, 2) : '—'}</td><td class="r n">${m.id ? m.vendas : '—'}</td><td class="r n">${m.vendas ? brl(m.gasto / m.vendas, 2) : '—'}</td><td class="r n ${m.id ? 'neg' : ''}">${m.id ? brl(-m.gasto * pct, 2) : '—'}</td></tr>`;
  }).join('') + `<tr class="total"><td colspan="2">Total</td><td class="r n">${brl(g, 2)}</td><td class="r n">${l}</td><td class="r n">${l ? brl(g / l, 2) : '—'}</td><td class="r n">${v}</td><td></td><td class="r n neg">${brl(-desc, 2)}</td></tr>`
    : `<tr><td colspan="8" class="empty">${GESTOR ? 'Nenhum gasto nesta semana. Suba o relatório exportado do Gerenciador de Anúncios.' : 'Nenhum gasto de tráfego seu nesta semana.'}</td></tr>`;
  renderDescontos();
}
function renderDescontos() {
  if (!GESTOR || !$('dPessoa')) return;
  if (!$('dPessoa').options.length) {
    $('dPessoa').innerHTML = PESSOAS.filter(p => p.ativo && !['ceo', 'tv'].includes(p.funcao)).sort((a, b) => a.nome.localeCompare(b.nome)).map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
    const s0 = sextaApos(addDays(TODAY, -1));
    $('dSexta').innerHTML = Array.from({ length: 10 }, (_, i) => addDays(s0, 7 * i)).map(d => `<option value="${+d}">${d.toLocaleDateString('pt-BR')}</option>`).join('');
  }
  const seg = segundaDe(addDays(TODAY, -7));
  const fut = DESC.filter(x => parseD(x.data) >= seg).sort((a, b) => a.data < b.data ? -1 : 1);
  $('dLista').innerHTML = fut.length ? fut.map(x => `<div class="row"><div class="l">${esc((pessoaPorId(x.pessoa_id) || {}).nome || '—')}<span>${esc(x.descricao || 'Desconto')} · sexta ${fdate(sextaPagamento(parseD(x.data)))}</span></div><b class="neg">−${brl(x.valor, 2)}</b> <button type="button" class="btn ghost sm" data-tr="del:${x.id}">Excluir</button></div>`).join('')
    : '<p class="note">Nenhum desconto lançado para as próximas sextas.</p>';
}

/* Relatório exportado do Gerenciador de Anúncios (Excel ou CSV) */
const numMeta = v => typeof v === 'number' ? v : (() => { const s = String(v ?? '').replace(/[R$\s]/g, ''); if (!s) return 0; return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0; })();
const dataMeta = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim()) ? v.trim().slice(0, 10) : dataBR(v);
function lerPlanilhaMeta(rows, arquivo) {
  const hi = rows.findIndex(r => r.some(c => /^(valor usado|amount spent|gasto)/.test(tira(c))));
  if (hi < 0) return [];
  const h = rows[hi].map(tira), col = (...res) => h.findIndex(c => res.some(re => re.test(c)));
  const cG = col(/^valor usado/, /^amount spent/, /^gasto/), cCa = col(/nome da campanha/, /campaign name/, /^campanha/), cCj = col(/nome do conjunto/, /ad set name/, /^conjunto/),
    cAn = col(/nome do anuncio/, /^ad name/, /^anuncio/), cCo = col(/nome da conta/, /account name/, /^conta/), cDia = col(/^dia$/, /^day$/, /^data$/),
    cIni = col(/inicio dos relatorios/, /reporting starts/), cFim = col(/termino dos relatorios/, /reporting ends/);
  let cL = col(/^leads/, /^cadastros/, /^lead /); if (cL < 0) cL = col(/^resultados$/, /^results$/, /conversas/);
  const txt = (r, c) => c >= 0 ? String(r[c] ?? '').trim() : '', bmPadrao = arquivo.replace(/\.[^.]+$/, ''), out = [];
  for (const r of rows.slice(hi + 1)) {
    const camp = txt(r, cCa), conj = txt(r, cCj), anun = txt(r, cAn);
    if (!camp && !conj && !anun) continue;   // linha de total
    const gasto = numMeta(r[cG]), leads = cL >= 0 ? Math.round(numMeta(r[cL])) : 0;
    if (!gasto && !leads) continue;
    const d1 = dataMeta(cDia >= 0 ? r[cDia] : r[cIni]); if (!d1) continue;
    const d2 = (cDia >= 0 ? d1 : dataMeta(r[cFim])) || d1;
    const dias = []; for (let d = parseD(d1); d <= parseD(d2) && dias.length < 62; d = addDays(d, 1)) dias.push(iso(d));
    const parte = Math.floor(gasto / dias.length * 100) / 100;
    dias.forEach((d, i) => out.push({ data: d, bm: txt(r, cCo) || bmPadrao, campanha: camp, conjunto: conj, anuncio: anun,
      gasto: i === dias.length - 1 ? Math.round((gasto - parte * (dias.length - 1)) * 100) / 100 : parte, leads: i === dias.length - 1 ? leads : 0 }));
  }
  return out;
}
function sugerirConsultor(txt) {
  const t = ' ' + normNome(txt) + ' ', cands = PESSOAS.filter(p => p.ativo && ['vendedor', 'gerente'].includes(p.funcao));
  const unico = f => { const m = cands.filter(f); return m.length === 1 ? m[0].id : ''; };
  return unico(p => { const n = normNome(p.nome).split(' '); return n.length > 1 && t.includes(` ${n[0]} ${n[1]} `); })
      || unico(p => p.apelido && t.includes(` ${normNome(p.apelido)} `))
      || unico(p => t.includes(` ${normNome(p.nome).split(' ')[0]} `));
}
function montarPrevia(linhas, arquivo) {
  const agg = new Map();
  linhas.forEach(x => { const k = [x.data, x.bm, x.campanha, x.conjunto, x.anuncio].join('\u0001'); const a = agg.get(k); if (a) { a.gasto += x.gasto; a.leads += x.leads; } else agg.set(k, { ...x }); });
  const unidades = new Map();
  [...agg.values()].forEach(x => {
    const nome = x.conjunto || x.campanha || x.anuncio, k = x.bm + '\u0001' + nome;
    const u = unidades.get(k) || { bm: x.bm, nome, campanha: x.campanha, linhas: [], gasto: 0, leads: 0, d1: x.data, d2: x.data };
    u.linhas.push(x); u.gasto += x.gasto; u.leads += x.leads; if (x.data < u.d1) u.d1 = x.data; if (x.data > u.d2) u.d2 = x.data; unidades.set(k, u);
  });
  const lista = [...unidades.values()].sort((a, b) => a.bm.localeCompare(b.bm) || b.gasto - a.gasto);
  lista.forEach(u => {
    const ls = u.linhas, chaves = [u.nome, u.campanha, ...ls.map(x => x.anuncio)].filter(Boolean).map(tira);
    u.pessoa = chaves.map(c => TR.vinc.get(c)).find(Boolean) || sugerirConsultor([u.nome, u.campanha, ls[0].anuncio].join(' ')) || '';
    u.vinculado = !!chaves.map(c => TR.vinc.get(c)).find(Boolean);
  });
  return { arquivo, unidades: lista };
}
function renderPreviaTr() {
  const p = TR.prev, el = $('trPrev');
  if (!p) { el.innerHTML = ''; return; }
  const ops = PESSOAS.filter(x => x.ativo && ['vendedor', 'gerente'].includes(x.funcao)).sort((a, b) => a.nome.localeCompare(b.nome));
  const tot = p.unidades.reduce((s, u) => s + u.gasto, 0), sem = p.unidades.filter(u => !u.pessoa);
  const d1 = p.unidades.reduce((a, u) => u.d1 < a ? u.d1 : a, '9999'), d2 = p.unidades.reduce((a, u) => u.d2 > a ? u.d2 : a, '');
  el.innerHTML = `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Conferir antes de gravar · ${esc(p.arquivo)}</h2><span class="note">${dBR(d1)} a ${dBR(d2)} · ${brl(tot, 2)} · ${p.unidades.length} anúncios/conjuntos</span></div>
    <p class="note" style="margin:0 0 10px">Confira o consultor de cada linha. O sistema guarda a escolha e reconhece sozinho nos próximos relatórios.${sem.length ? ` <b class="neg">${sem.length} sem consultor</b>: se ficar assim, a loja paga.` : ''}</p>
    <div class="tbl-wrap"><table><thead><tr><th>BM / conta</th><th>Campanha · conjunto</th><th>Período</th><th class="r">Gasto</th><th class="r">Leads</th><th>Consultor</th></tr></thead><tbody>
    ${p.unidades.map((u, i) => `<tr><td>${esc(u.bm)}</td><td>${esc(u.campanha)}${u.nome !== u.campanha ? ` · <b>${esc(u.nome)}</b>` : ''}</td><td class="n">${dBR(u.d1)}${u.d2 !== u.d1 ? ' a ' + dBR(u.d2) : ''}</td><td class="r n">${brl(u.gasto, 2)}</td><td class="r n">${u.leads}</td>
      <td><select data-tr-un="${i}"><option value="">Sem consultor (loja paga)</option>${ops.map(o => `<option value="${o.id}" ${o.id === u.pessoa ? 'selected' : ''}>${esc(o.nome)}</option>`).join('')}</select>${u.pessoa && !u.vinculado ? ' <span class="cf-tag">sugerido</span>' : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="cf-btns" style="margin-top:12px"><button class="btn gold" type="button" data-tr="salvar">Gravar gastos</button><button class="btn ghost" type="button" data-tr="cancelar">Cancelar</button></div></div>`;
}
async function lerTrafego(file) {
  if (!file || !GESTOR) return;
  try {
    await carregarScript(LIB_XLSX, 'XLSX');
    if (!TR.vinc) { const { data, error } = await sb.from('trafego_vinculos').select('*'); if (error) throw error; TR.vinc = new Map((data || []).map(v => [v.chave, v.pessoa_id])); }
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' }), linhas = [];
    wb.SheetNames.forEach(n => linhas.push(...lerPlanilhaMeta(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }), file.name)));
    if (!linhas.length) return toast('Não achei as colunas do Gerenciador de Anúncios (Valor usado, Nome da campanha, Dia). Exporte o relatório em Excel ou CSV.');
    TR.prev = montarPrevia(linhas, file.name); renderPreviaTr(); $('trPrev').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { console.error(e); toast('Erro ao ler o arquivo: ' + (e.message || e)); }
}
async function salvarTrafego() {
  const p = TR.prev; if (!p) return;
  document.querySelectorAll('[data-tr-un]').forEach(s => { p.unidades[+s.dataset.trUn].pessoa = s.value; });
  const vinc = [], rows = [];
  p.unidades.forEach(u => {
    if (u.pessoa) { vinc.push({ chave: tira(u.nome), pessoa_id: u.pessoa, updated_at: new Date().toISOString() }); TR.vinc.set(tira(u.nome), u.pessoa); }
    u.linhas.forEach(x => rows.push({ data: x.data, bm: x.bm, campanha: x.campanha, conjunto: x.conjunto, anuncio: x.anuncio, pessoa_id: u.pessoa || null, gasto: Math.round(x.gasto * 100) / 100, leads: x.leads, fonte: 'relatorio', importado_em: new Date().toISOString() }));
  });
  if (vinc.length) { const { error } = await sb.from('trafego_vinculos').upsert(vinc, { onConflict: 'chave' }); if (error) return toast('Não foi possível salvar: ' + error.message); }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('trafego_gastos').upsert(rows.slice(i, i + 500), { onConflict: 'data,bm,campanha,conjunto,anuncio' });
    if (error) return toast('Não foi possível salvar: ' + error.message);
  }
  TR.prev = null; renderPreviaTr(); await carregarTrafego(); renderAll();
  toast(`Tráfego gravado: ${brl(rows.reduce((s, x) => s + x.gasto, 0), 2)} em ${rows.length} lançamentos diários.`);
}
async function lancarDesconto(ev) {
  ev.preventDefault();
  const pessoa = $('dPessoa').value, total = +$('dValor').value, vezes = Math.max(1, Math.min(104, +$('dVezes').value || 1)), desc = $('dDesc').value.trim();
  if (!pessoa || !(total > 0)) return toast('Escolha a pessoa e o valor');
  const sexta = new Date(+$('dSexta').value), parte = Math.floor(total / vezes * 100) / 100, rows = [];
  for (let i = 0; i < vezes; i++) rows.push({ pessoa_id: pessoa, data: iso(addDays(sexta, 7 * i - 11)), tipo: 'debito', valor: i === vezes - 1 ? Math.round((total - parte * (vezes - 1)) * 100) / 100 : parte, descricao: vezes > 1 ? `${desc} (${i + 1}/${vezes})` : desc });
  const { error } = await sb.from('descontos').insert(rows);
  if (error) return toast('Não foi possível lançar: ' + error.message);
  $('formDesc').reset(); $('dVezes').value = 1; await carregarTrafego(); renderAll();
  toast(`Desconto lançado: ${vezes}× de ${brl(parte, 2)} a partir de ${sexta.toLocaleDateString('pt-BR')}`);
}
$('trSemana').addEventListener('change', renderTrafego);
$('trArquivo').addEventListener('change', e => { lerTrafego(e.target.files[0]); e.target.value = ''; });
$('formDesc').addEventListener('submit', lancarDesconto);
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-tr]'); if (!b) return;
  const [acao, id] = b.dataset.tr.split(':');
  if (acao === 'salvar') { b.disabled = true; await salvarTrafego(); b.disabled = false; }
  if (acao === 'cancelar') { TR.prev = null; renderPreviaTr(); }
  if (acao === 'del') {
    const { error } = await sb.from('descontos').delete().eq('id', +id);
    if (error) return toast('Não foi possível excluir: ' + error.message);
    DESC = DESC.filter(x => x.id !== +id); renderAll(); toast('Desconto excluído');
  }
});
/* <<< TRAFEGO <<< */
/* >>> CARTEIRA >>> */
// Minha carteira: clientes de cada pessoa, com o que já recebeu, o que ainda pode receber e o que está em risco.
// Recorrência (3ª, 4ª e 5ª): administrativo, gerente adm e supervisor (só clientes que ele mesmo vendeu e fechou).
const podeVerTodasCarteiras = () => GESTOR || (ME && ME.funcao === 'gerente_adm');
function carteiraDe(alvo) {
  const f = alvo.funcao;
  return COTAS.filter(c => (valida(c) || c.canc) && (
    f === 'administrativo' ? c.adm_id === alvo.id :
    f === 'gerente_adm' ? true :
    f === 'gerente' ? (c.vendedor_id === alvo.id || c.fechador_id === alvo.id || (pessoaPorId(c.vendedor_id) || {}).equipe_id === alvo.equipe_id) :
    (c.vendedor_id === alvo.id || c.fechador_id === alvo.id)));
}
// Valor que a pessoa recebe por 3ª/4ª/5ª parcela paga deste cliente (0 se não tem recorrência)
function recorrenciaPorParcela(c, alvo, d) {
  let v = 0;
  if (c.adm_id === alvo.id) v += c.credito * r('adm_parcela') / 100;
  if (alvo.funcao === 'gerente_adm') v += c.credito * r('gerente_adm_parcela') / 100;
  const sp = supRecorrente(c);
  if (sp && sp.id === alvo.id && (!d || d >= SUP_REC_DESDE)) v += c.credito * supPct() / 100;
  return v;
}
function linhaCarteira(c, alvo) {
  const meus = eventosEquipe(c).filter(e => e.pessoa === alvo.id);
  const recebido = meus.filter(e => e.data <= TODAY).reduce((s, e) => s + e.valor, 0);
  const prev = [], venc0 = [];   // previsão (a vencer) e parcelas já vencidas sem baixa
  meus.filter(e => e.data > TODAY && e.valor > 0).forEach(e => prev.push({ data: e.data, valor: e.valor, k: 0 }));
  if (c.p[2] !== 'nao_pago' && c.status !== 'estornada') {
    for (let k = 3; k <= 5; k++) {
      if (c.p[k] !== 'aberto') continue;
      const d = venc(c, k), v = recorrenciaPorParcela(c, alvo, d);
      if (v > 0 && ativoEm(alvo.id, d)) { if (stView(c, k) !== 'atrasado') prev.push({ data: d, valor: v, k }); else if (!c.historico && d >= addDays(TODAY, -60)) venc0.push({ data: d, valor: v, k }); }
    }
  }
  const minhaVenda = partesVenda(c).partes.filter(x => x.pessoa === alvo.id).reduce((s, x) => s + x.valor, 0);
  if (!c.confirmada && minhaVenda > 0) prev.push({ data: TODAY, valor: minhaVenda, k: 0, disal: true });
  // Risco: mesma janela do radar da 2ª parcela (a vencer ou vencida há até 45 dias)
  const risco = c.p[2] === 'aberto' && !c.estornoDoc && venc(c, 2) >= addDays(TODAY, -45) ? minhaVenda * r('estorno_equipe') / 100 : 0;
  const prox = [2, 3, 4, 5].find(k => c.p[k] === 'aberto');
  return { c, recebido, prev, previsto: prev.reduce((s, x) => s + x.valor, 0), semBaixa: venc0.reduce((s, x) => s + x.valor, 0), risco, prox };
}
const situacaoCart = c => {
  if (c.canc) return c.canc.conf ? 'cancelada' : 'cancelando';
  if (c.status === 'estornada' || c.p[2] === 'nao_pago') return 'estornada';
  if ([2, 3, 4, 5].some(k => stView(c, k) === 'atrasado')) return 'atrasada';
  if ([2, 3, 4, 5].some(k => stView(c, k) === 'informado')) return 'aguardando';
  if ([2, 3, 4, 5].every(k => ['pago', 'cancelado'].includes(c.p[k]))) return 'concluida';
  return 'andamento';
};
// Relatório de parcelas (3ª, 4ª e 5ª) da carteira: pagas, não pagas, a vencer e canceladas, com PDF
const ST_PARC = { paga: 'Paga', informada: 'Informada (aguardando Disal)', nao_paga: 'Não paga', a_vencer: 'A vencer', cancelada: 'Cancelada' };
const RP = { aberto: false, parc: [3, 4, 5], st: Object.keys(ST_PARC) };
function statusParc(c, k) {
  if (c.status === 'cancelada' || c.p[k] === 'cancelado') return 'cancelada';
  if (c.p[k] === 'pago') return 'paga';
  if (c.p[k] === 'nao_pago') return 'nao_paga';
  const s = stView(c, k); return s === 'informado' ? 'informada' : s === 'atrasado' ? 'nao_paga' : 'a_vencer';
}
function carteiraRelatorio(alvo) {
  const f = alvo.funcao;
  return COTAS.filter(c => c.credito > 0 && (f === 'administrativo' ? c.adm_id === alvo.id : f === 'gerente_adm' ? true :
    f === 'gerente' ? (c.vendedor_id === alvo.id || c.fechador_id === alvo.id || (pessoaPorId(c.vendedor_id) || {}).equipe_id === alvo.equipe_id) :
    (c.vendedor_id === alvo.id || c.fechador_id === alvo.id))).sort((a, b) => a.venda - b.venda);
}
const linhasRelParc = alvo => carteiraRelatorio(alvo).map(c => ({ c, s: { 3: statusParc(c, 3), 4: statusParc(c, 4), 5: statusParc(c, 5) } }))
  .filter(x => RP.parc.some(k => RP.st.includes(x.s[k])));
const alvoRel = () => podeVerTodasCarteiras() ? pessoaPorId($('ctPessoa').value) : ME;
function renderRelParc() {
  const el = $('rpParc'); if (!el) return; el.hidden = !RP.aberto; if (!RP.aberto) return;
  const alvo = alvoRel(); if (!alvo) return;
  const todas = carteiraRelatorio(alvo), L = linhasRelParc(alvo);
  const chip = { paga: 'c-pago', informada: 'c-inf', nao_paga: 'c-atrasado', a_vencer: 'c-aberto', cancelada: 'c-canc' };
  const cont = k => Object.keys(ST_PARC).map(s => `${ST_PARC[s]}: <b>${todas.filter(c => statusParc(c, k) === s).length}</b>`).join(' · ');
  const cel = (x, k) => `<td><span class="chip ${chip[x.s[k]]}">${ST_PARC[x.s[k]].replace(' (aguardando Disal)', '')}</span><span class="sub2">venc. ${fdate(venc(x.c, k))}</span></td>`;
  const caixa = (attr, v, txt, on) => `<label style="display:inline-flex;flex-direction:row;align-items:center;gap:4px;margin-right:12px;font-size:13px"><input type="checkbox" ${attr}="${v}" ${on ? 'checked' : ''} style="width:auto"> ${txt}</label>`;
  el.innerHTML = `<div class="panel-head"><h2>Relatório de parcelas · ${esc(alvo.nome)}</h2><div class="acts"><button class="btn gold sm" type="button" data-rp="pdf">Gerar PDF</button><button class="btn ghost sm" type="button" data-rp="fechar">Fechar</button></div></div>
    <div style="display:flex;flex-wrap:wrap;gap:16px;margin:8px 0">
      <div><div class="note" style="margin-bottom:4px">Parcelas</div>${[3, 4, 5].map(k => caixa('data-rpk', k, k + 'ª', RP.parc.includes(k))).join('')}</div>
      <div><div class="note" style="margin-bottom:4px">Situação</div>${Object.keys(ST_PARC).map(s => caixa('data-rps', s, ST_PARC[s], RP.st.includes(s))).join('')}</div>
    </div>
    <p class="note">${todas.length} clientes na carteira (incluindo cancelados) · mostrando ${L.length}<br>${[3, 4, 5].map(k => `<b>${k}ª parcela</b> — ${cont(k)}`).join('<br>')}</p>
    <div class="tbl-wrap"><table><thead><tr><th>Cliente</th><th>Contrato</th><th>Venda</th><th class="r">Crédito</th><th>Vendedor / fechador</th><th>Adm</th>${RP.parc.map(k => `<th>${k}ª parcela</th>`).join('')}</tr></thead><tbody>
    ${L.map(x => `<tr><td>${esc(x.c.cliente)}${x.c.status === 'cancelada' ? '<span class="sub2">venda cancelada</span>' : ''}</td><td class="n">${esc(x.c.contrato || '—')}</td><td class="n">${fdate(x.c.venda)}</td><td class="r n">${brl(x.c.credito)}</td><td>${esc(x.c.vendedor)}<span class="sub2">${esc(x.c.fechador)}</span></td><td>${esc(x.c.adm)}</td>${RP.parc.map(k => cel(x, k)).join('')}</tr>`).join('') || `<tr><td colspan="9" class="empty">Nenhum cliente com esses filtros.</td></tr>`}
    </tbody></table></div>`;
}
async function gerarPdfParcelas() {
  try { await carregarScript(LIB_PDF, 'jspdf'); await carregarScript(LIB_PDFT); } catch (e) { return toast('Erro: ' + e.message); }
  const alvo = alvoRel(); if (!alvo) return;
  const L = linhasRelParc(alvo), todas = carteiraRelatorio(alvo);
  const t = s => String(s == null || s === '' ? '-' : s).replace(/—/g, '-').replace(/ /g, ' ');
  const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  doc.setFillColor(15, 37, 71); doc.rect(0, 0, 297, 26, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(t(`Relatório de parcelas (3ª, 4ª e 5ª) - ${alvo.nome}`), 14, 12);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(t(`Parcelas: ${RP.parc.map(k => k + 'ª').join(', ')} | Situação: ${RP.st.map(s => ST_PARC[s]).join(', ')} | ${L.length} de ${todas.length} clientes`), 14, 20);
  doc.setTextColor(13, 26, 48);
  doc.autoTable({ startY: 31, head: [['Parcela', ...Object.values(ST_PARC)]], body: [3, 4, 5].map(k => [k + 'ª', ...Object.keys(ST_PARC).map(s => String(todas.filter(c => statusParc(c, k) === s).length))]),
    styles: { fontSize: 8, cellPadding: 1.5 }, headStyles: { fillColor: [15, 37, 71] }, tableWidth: 200 });
  const cor = { paga: [214, 238, 220], informada: [222, 232, 248], nao_paga: [248, 220, 216], a_vencer: [244, 244, 244], cancelada: [226, 226, 226] };
  doc.autoTable({ startY: doc.lastAutoTable.finalY + 6,
    head: [['Cliente', 'Contrato', 'Venda', 'Crédito', 'Vendedor', 'Fechador', 'Adm', ...RP.parc.map(k => k + 'ª parcela')]],
    body: L.map(x => [t(x.c.cliente + (x.c.status === 'cancelada' ? ' (venda cancelada)' : '')), t(x.c.contrato), x.c.venda.toLocaleDateString('pt-BR'), t(brl(x.c.credito)), t(x.c.vendedor), t(x.c.fechador), t(x.c.adm),
      ...RP.parc.map(k => `${ST_PARC[x.s[k]].replace(' (aguardando Disal)', '')}\nvenc. ${venc(x.c, k).toLocaleDateString('pt-BR')}`)]),
    styles: { fontSize: 7.5, cellPadding: 1.4 }, headStyles: { fillColor: [15, 37, 71] }, columnStyles: { 3: { halign: 'right' } },
    didParseCell: d => { if (d.section === 'body' && d.column.index >= 7) { const x = L[d.row.index], k = RP.parc[d.column.index - 7]; if (x && k) d.cell.styles.fillColor = cor[x.s[k]]; } } });
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(90, 105, 132); doc.text(t(`Gerado em ${new Date().toLocaleString('pt-BR')} pelo Vortelli OS | página ${i} de ${n}`), 14, 203); }
  doc.save(`Parcelas_3a_5a_${alvo.nome.replace(/\s+/g, '_')}_${iso(TODAY)}.pdf`);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-rp]'); if (!b) return;
  if (b.dataset.rp === 'abrir') { RP.aberto = true; renderRelParc(); $('rpParc').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  else if (b.dataset.rp === 'fechar') { RP.aberto = false; renderRelParc(); }
  else if (b.dataset.rp === 'pdf') gerarPdfParcelas();
});
document.addEventListener('change', e => {
  const x = e.target;
  if (x.id === 'ctPessoa') renderRelParc();
  else if (x.dataset && x.dataset.rpk) { const k = +x.dataset.rpk; RP.parc = x.checked ? [...new Set([...RP.parc, k])].sort() : RP.parc.filter(v => v !== k); renderRelParc(); }
  else if (x.dataset && x.dataset.rps) { const s = x.dataset.rps; RP.st = x.checked ? [...new Set([...RP.st, s])] : RP.st.filter(v => v !== s); renderRelParc(); }
});
function renderCarteira() {
  if (!ME || !$('ctFiltro')) return;
  const todas = podeVerTodasCarteiras();
  $('ctPessoaL').hidden = !todas;
  if (todas && !$('ctPessoa').options.length) {
    $('ctPessoa').innerHTML = PESSOAS.filter(p => p.ativo && !['ceo', 'tv'].includes(p.funcao)).sort((a, b) => a.nome.localeCompare(b.nome))
      .map(p => `<option value="${p.id}">${esc(p.nome)} · ${funcaoNome(p)}</option>`).join('');
    if (ME.funcao === 'gerente_adm') $('ctPessoa').value = ME.id;
  }
  const alvo = todas ? pessoaPorId($('ctPessoa').value) : ME;
  if (!alvo) return;
  $('ctTitulo').textContent = alvo.id === ME.id ? 'Minha carteira' : `Carteira de ${alvo.nome}`;
  const fil = $('ctFiltro').value, q = $('ctBusca').value.trim().toLowerCase();
  const base = carteiraDe(alvo).map(c => linhaCarteira(c, alvo));
  const L = base.filter(x => (fil === 'todas' || situacaoCart(x.c) === fil || (fil === 'receber' && (x.previsto > 0 || x.semBaixa > 0)) || (fil === 'risco' && x.risco > 0) || (fil === 'cancelamentos' && x.c.canc))
      && (!q || `${x.c.cliente} ${x.c.contrato || ''} ${x.c.vendedor}`.toLowerCase().includes(q)))
    .sort((a, b) => (a.prox ? +venc(a.c, a.prox) : 9e15) - (b.prox ? +venc(b.c, b.prox) : 9e15));
  $('ctMotivos').innerHTML = fil === 'cancelamentos' ? resumoMotivos(base.filter(x => x.c.canc).map(x => x.c)) : '';
  const soma = (l, k) => l.reduce((s, x) => s + x[k], 0);
  const lim = addDays(TODAY, 30), prox30 = base.reduce((s, x) => s + x.prev.filter(p => p.data <= lim).reduce((a, p) => a + p.valor, 0), 0);
  const andamento = base.filter(x => ['andamento', 'atrasada', 'aguardando'].includes(situacaoCart(x.c))).length;
  $('kpisCt').innerHTML =
    kpi('Clientes', base.length, `${andamento} em andamento · ${base.filter(x => situacaoCart(x.c) === 'atrasada').length} com parcela atrasada · ${base.filter(x => situacaoCart(x.c) === 'aguardando').length} pagos aguardando Disal${base.some(x => [2, 3, 4, 5].some(k => diasSemConfirmar(x.c, k) > INF_ALERTA_DIAS)) ? ` (<b class="neg">${base.filter(x => [2, 3, 4, 5].some(k => diasSemConfirmar(x.c, k) > INF_ALERTA_DIAS)).length} há mais de ${INF_ALERTA_DIAS} dias</b>)` : ''}`) +
    kpi('Já recebido', brl(soma(base, 'recebido'), 2), 'Comissões e recorrências pagas') +
    kpi('Previsão a receber', brl(soma(base, 'previsto'), 2), 'Se os clientes pagarem em dia') +
    kpi('Próximos 30 dias', brl(prox30, 2), 'Parte da previsão') +
    kpi('Vencidas sem baixa', brl(soma(base, 'semBaixa'), 2), 'Entram quando a parcela for baixada como paga') +
    kpi('Em risco na 2ª', `<span class="${soma(base, 'risco') ? 'neg' : ''}">${brl(soma(base, 'risco'), 2)}</span>`, 'Estorno de 50% se a 2ª não for paga');
  // Previsão por mês (pela sexta em que cai o pagamento)
  const porMes = {};
  base.forEach(x => x.prev.forEach(p => { const ym = ymOf(sextaPagamento(p.data)); porMes[ym] = (porMes[ym] || 0) + p.valor; }));
  const meses = Object.keys(porMes).map(Number).sort((a, b) => a - b).slice(0, 6);
  $('ctMeses').innerHTML = meses.length ? meses.map(ym => `<div class="row"><div class="l">${MESES[ym % 12][0].toUpperCase() + MESES[ym % 12].slice(1)} de ${Math.floor(ym / 12)}</div><b>${brl(porMes[ym], 2)}</b></div>`).join('') : '<p class="note">Nada previsto por enquanto.</p>';
  const sitChip = { andamento: '<span class="chip c-aberto">Em dia</span>', atrasada: '<span class="chip c-atrasado">Atrasada</span>', concluida: '<span class="chip c-pago">Concluída</span>', estornada: '<span class="chip c-canc">Estornada</span>', aguardando: '<span class="chip c-inf">Pago · aguardando Disal</span>', cancelando: '<span class="chip c-atrasado">Cancelamento em andamento</span>', cancelada: '<span class="chip c-canc">Cancelada</span>' };
  $('tbCt').innerHTML = L.length ? L.slice(0, 400).map(x => { const c = x.c;
    return `<tr><td>${esc(c.cliente)}<span class="sub2">${esc(c.telefone || 'sem telefone')}${podeInformar() ? ` · <button type="button" class="linkbtn" style="font-size:11px" data-tel="${c.id}">editar</button>` : ''}</span></td><td class="n">${esc(c.contrato || '—')}</td><td class="n">${fdate(c.venda)}</td><td class="r n">${brl(c.credito)}</td>
      <td>${esc(c.vendedor)}<span class="sub2">adm: ${esc(c.adm)}</span></td>
      <td><span class="pp">${[1, 2, 3, 4, 5].map(k => { const s = stView(c, k); return `<i class="s-${s}" title="${k}ª: ${s} · venc. ${fdate(venc(c, k))}">${k}</i>`; }).join('')}</span></td>
      <td class="n">${x.prox ? `${x.prox}ª · ${fdate(venc(c, x.prox))}` : '—'}${x.prox === 2 && podeAjustarVenc(c) ? ` <button type="button" class="linkbtn" style="font-size:11px" data-venc2="${c.id}">ajustar</button>` : ''}<div class="acts" style="margin-top:4px">${x.prox && !c.canc ? acaoPagou(c, x.prox) : ''}${acaoCanc(c)}</div></td><td>${sitChip[situacaoCart(c)]}</td>
      <td class="r n">${x.recebido ? brl(x.recebido, 2) : '—'}</td><td class="r n">${x.previsto ? `<strong>${brl(x.previsto, 2)}</strong>` : '—'}${x.semBaixa ? `<span class="sub2">+ ${brl(x.semBaixa, 2)} vencida sem baixa</span>` : ''}</td><td class="r n ${x.risco ? 'neg' : ''}">${x.risco ? '−' + brl(x.risco, 2) : '—'}</td></tr>`; }).join('') +
    `<tr class="total"><td colspan="8">Total (${L.length} clientes)</td><td class="r n">${brl(soma(L, 'recebido'), 2)}</td><td class="r n">${brl(soma(L, 'previsto'), 2)}</td><td class="r n neg">${soma(L, 'risco') ? '−' + brl(soma(L, 'risco'), 2) : '—'}</td></tr>`
    : `<tr><td colspan="11" class="empty">Nenhum cliente neste filtro.</td></tr>`;
}
['ctPessoa', 'ctFiltro'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('change', renderCarteira); });
(() => { const el = document.getElementById('ctBusca'); if (el) el.addEventListener('input', renderCarteira); })();
/* <<< CARTEIRA <<< */
/* >>> PAGOU >>> */
// "Cliente pagou" com comprovante: administrativo, supervisor, gerente adm e CEO (vendedor não).
// A parcela fica "paga – aguardando Disal" até o relatório oficial da Disal dar a baixa.
const podeInformar = () => GESTOR || (ME && ['gerente', 'administrativo', 'gerente_adm'].includes(ME.funcao));
const INF_ALERTA_DIAS = 10;
const diasSemConfirmar = (c, k) => c.inf && c.inf[k] ? Math.floor((TODAY - (c.inf[k].at || c.inf[k].em)) / 864e5) : 0;
function acaoPagou(c, k) {
  if (!k || c.status === 'cancelada') return '';
  const i = c.inf && c.inf[k];
  if (i) {
    const d = diasSemConfirmar(c, k), late = d > INF_ALERTA_DIAS;
    return `<span class="chip ${late ? 'c-atrasado' : 'c-inf'}" title="Pago em ${fdate(i.em)} · registrado por ${esc(nomeP(i.por))}">${k}ª paga · aguardando Disal${late ? ` há ${d} dias` : ''}</span>`
      + (podeInformar() ? ` <button class="btn ghost sm" data-comprov="${c.id}:${k}">Comprovante</button> <button class="btn ghost sm" data-desfaz="${c.id}:${k}" title="Desfazer o informe">Desfazer</button>` : '');
  }
  return podeInformar() && c.p[k] === 'aberto' ? `<button class="btn sm" data-pagou="${c.id}:${k}">Cliente pagou</button>` : '';
}
function abrirPagou(c, k) {
  $('pgTitulo').textContent = `${c.cliente} · ${k}ª parcela`;
  $('pgInfo').textContent = `Vencimento ${fdate(venc(c, k))} · ${brl(c.parcela, 2)} · contrato ${c.contrato || '—'}`;
  $('pgData').value = iso(TODAY); $('pgArq').value = ''; $('pgErro').textContent = '';
  $('dlgPagou').dataset.alvo = `${c.id}:${k}`; $('dlgPagou').showModal();
}
async function salvarPagou() {
  const [id, k] = $('dlgPagou').dataset.alvo.split(':').map(Number);
  const c = COTAS.find(x => x.id === id), f = $('pgArq').files[0], dt = $('pgData').value;
  if (!f) { $('pgErro').textContent = 'Anexe o comprovante (foto ou PDF).'; return; }
  if (f.size > 10 * 1024 * 1024) { $('pgErro').textContent = 'Arquivo muito grande (máximo 10 MB).'; return; }
  if (!dt) { $('pgErro').textContent = 'Informe a data do pagamento.'; return; }
  $('pgSalvar').disabled = true; $('pgErro').textContent = 'Enviando…';
  const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
  const path = `${id}/${k}-${Date.now()}.${ext}`;
  const up = await sb.storage.from('comprovantes').upload(path, f, { contentType: f.type || undefined });
  if (up.error) { $('pgSalvar').disabled = false; $('pgErro').textContent = 'Não foi possível enviar o comprovante: ' + up.error.message; return; }
  const { error } = await sb.rpc('informar_pagamento', { p_cota: id, p_num: k, p_data: dt, p_arquivo: path });
  $('pgSalvar').disabled = false;
  if (error) { $('pgErro').textContent = 'Não foi possível salvar: ' + error.message; return; }
  (c.inf ||= {})[k] = { em: parseD(dt), por: ME.id, at: TODAY, arq: path };
  $('dlgPagou').close(); toast(`${k}ª parcela de ${c.cliente.split(' ')[0]}: paga, aguardando a Disal`); renderAll();
}
async function verComprovante(c, k) {
  const i = c.inf && c.inf[k]; if (!i || !i.arq) return toast('Sem comprovante');
  const { data, error } = await sb.storage.from('comprovantes').createSignedUrl(i.arq, 300);
  if (error) return toast('Não foi possível abrir: ' + error.message);
  window.open(data.signedUrl, '_blank', 'noopener');
}
async function desfazerPagou(c, k) {
  const { error } = await sb.rpc('desfazer_informe', { p_cota: c.id, p_num: k });
  if (error) return toast('Não foi possível desfazer: ' + error.message);
  if (c.inf) delete c.inf[k]; toast('Informe desfeito'); renderAll();
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-pagou],[data-comprov],[data-desfaz]'); if (!a) return;
  const [id, k] = (a.dataset.pagou || a.dataset.comprov || a.dataset.desfaz).split(':').map(Number);
  const c = COTAS.find(x => x.id === id); if (!c) return;
  if (a.dataset.pagou) abrirPagou(c, k); else if (a.dataset.comprov) verComprovante(c, k); else desfazerPagou(c, k);
});
(() => { const s = document.getElementById('pgSalvar'); if (s) s.addEventListener('click', salvarPagou);
  const x = document.getElementById('pgCancelar'); if (x) x.addEventListener('click', () => $('dlgPagou').close()); })();
/* <<< PAGOU <<< */
/* >>> CANCELAMENTO >>> */
// Pedido de cancelamento (motivo + contrato assinado) e confirmação pelo extrato da Disal (lido automaticamente).
const MOTIVOS_CANC = ['Desistência / arrependimento', 'Condição financeira', 'Não entendeu o plano', 'Promessa diferente do contratado',
  'Insatisfação com o atendimento', 'Comprou em outro lugar', 'Demora na contemplação', 'Outro'];
async function carregarCanc() {
  const { data } = await sb.from('cancelamentos').select('*');
  (data || []).forEach(k => { const c = COTAS.find(x => x.id === k.cota_id); if (c) c.canc = {
    motivo: k.motivo, detalhe: k.detalhe, pedido: parseD(k.pedido_em), arq: k.contrato_arq, por: k.registrado_por,
    conf: parseD(k.confirmado_em), pct: k.pct_devolucao, ext: k.extrato_arq, info: k.extrato_info, doc: k.contrato_conf, hist: k.contrato_hist || [] }; });
}
const podeEditarCanc = c => !!(c.canc && ME && (GESTOR || ME.funcao === 'gerente_adm' || c.canc.por === ME.id));
const podeDesfazerConf = () => !!(ME && (GESTOR || ME.funcao === 'gerente_adm'));
const CONF_DOC = { manual: 'documento conferido à mão', divergente: 'documento com divergência' };
function acaoCanc(c) {
  const k = c.canc, tip = k ? `${esc(k.motivo)}${k.detalhe ? ' · ' + esc(k.detalhe) : ''}` : '';
  const doc = k && k.arq ? ` <button class="btn ghost sm" data-cdoc="${c.id}">Contrato</button>` : '';
  const aviso = k && k.doc && k.doc !== 'ok' ? ` <span class="chip ${k.doc === 'divergente' ? 'c-atrasado' : 'c-inf'}" title="Revisar o documento anexado">${CONF_DOC[k.doc]}</span>` : '';
  if (k && k.conf) return `<span class="chip c-canc" title="${tip}">Cancelada em ${fdate(k.conf)} · devolve ${k.pct}%</span>${aviso}${doc}` +
    (podeDesfazerConf() ? ` <button class="btn ghost sm" data-cdesf="${c.id}">Desfazer</button>` : '');
  if (k) return `<span class="chip c-atrasado" title="${tip}">Cancelamento em andamento</span>${aviso}` +
    (podeInformar() ? ` <button class="btn sm" data-cconf="${c.id}">Confirmar com extrato</button>${doc}` : doc) +
    (podeEditarCanc(c) ? ` <button class="btn ghost sm" data-cedit="${c.id}">Editar</button>` : '');
  return podeInformar() && c.status !== 'cancelada' ? `<button class="btn ghost sm" data-canc="${c.id}">Cancelamento</button>` : '';
}
function abrirCanc(c, editar) {
  const k = editar ? c.canc : null, dlg = $('dlgCanc');
  $('ccTitulo').textContent = `${k ? 'Editar cancelamento' : 'Cancelamento'} · ${c.cliente}`;
  const dias = Math.round((TODAY - c.venda) / 864e5);
  $('ccInfo').textContent = `Venda ${fdate(c.venda)} (${dias} dias) · contrato ${c.contrato || '—'} · grupo ${c.grupo || '—'} · cota ${c.cotaNum || '—'}`;
  $('ccMotivo').innerHTML = '<option value="">Escolha o motivo…</option>' + MOTIVOS_CANC.map(m => `<option>${m}</option>`).join('');
  $('ccMotivo').value = k ? k.motivo : ''; $('ccDetalhe').value = k ? (k.detalhe || '') : '';
  $('ccData').value = iso(k && k.pedido ? k.pedido : TODAY); $('ccArq').value = ''; $('ccErro').textContent = ''; $('ccDoc').innerHTML = '';
  $('ccArqL').firstChild.textContent = k ? 'Trocar o contrato de cancelamento (deixe vazio para manter o atual)' : 'Contrato de cancelamento assinado (foto ou PDF)';
  $('ccNota').hidden = !!k; $('ccDesfazer').hidden = !k;
  $('ccSalvar').textContent = k ? 'Salvar alterações' : 'Registrar cancelamento';
  dlg.dataset.alvo = c.id; dlg.dataset.modo = k ? 'editar' : 'novo'; dlg.doc = null; dlg.showModal();
}
// Confere se o documento anexado é do cliente: PDF com texto é lido; foto ou PDF escaneado exige conferência manual
async function textoPdf(f) {
  const lib = await carregarPdfjs();
  const pdf = await lib.getDocument({ data: await f.arrayBuffer() }).promise;
  let txt = '';
  for (let i = 1; i <= Math.min(pdf.numPages, 4); i++) { const pg = await pdf.getPage(i); const tc = await pg.getTextContent(); txt += ' ' + tc.items.map(x => x.str).join(' '); }
  let img = '';
  try { const pg = await pdf.getPage(1), vp0 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: 360 / vp0.width });
    const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; img = cv.toDataURL('image/jpeg', .7); } catch (e) { img = ''; }
  return { txt: txt.replace(/\s+/g, ' '), img };
}
function docBateCom(c, txt) {
  const t = normN(txt), so = t.replace(/[^0-9]/g, ' ');
  const nome = normN(c.cliente), partes = nome.split(' ').filter(p => p.length > 2);
  const nomeOk = t.includes(nome) || (partes.length >= 2 && partes.every(p => t.includes(p)));
  const contratoOk = !!c.contrato && new RegExp(`(^|\\D)${c.contrato}(\\D|$)`).test(so);
  const cotaOk = !!c.grupo && !!c.cotaNum && new RegExp(`(^|\\D)0*${+c.grupo}(\\D|$)`).test(so) && new RegExp(`(^|\\D)0*${+c.cotaNum}(\\D|$)`).test(so);
  return { nomeOk, contratoOk, cotaOk };
}
async function conferirDoc() {
  const dlg = $('dlgCanc'), c = COTAS.find(x => x.id === +dlg.dataset.alvo), f = $('ccArq').files[0], box = $('ccDoc');
  dlg.doc = null; $('ccErro').textContent = ''; if (!f) { box.innerHTML = ''; return; }
  const marca = (txt) => `<label style="display:flex;gap:8px;align-items:flex-start;margin-top:8px;font-weight:600"><input type="checkbox" id="ccMarca" style="width:auto;margin-top:3px"> <span>${txt}</span></label>`;
  const prev = src => src ? `<img src="${src}" alt="Prévia do documento" style="display:block;max-width:100%;max-height:220px;margin-top:8px;border:1px solid var(--line);border-radius:8px">` : '';
  const nomeC = esc(c.cliente);
  if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) {
    box.innerHTML = '<p class="note">Conferindo o documento…</p>';
    try {
      const { txt, img } = await textoPdf(f);
      if (txt.replace(/\s/g, '').length < 40) {
        dlg.doc = { conf: 'manual', marcar: true };
        box.innerHTML = `<p class="note">PDF escaneado: não dá para ler o texto. Confira na prévia.</p>${prev(img)}${marca(`Conferi: o documento é de ${nomeC}`)}`;
        return;
      }
      const r = docBateCom(c, txt);
      if (r.nomeOk && (r.contratoOk || r.cotaOk || !c.contrato)) {
        dlg.doc = { conf: 'ok', marcar: false };
        box.innerHTML = `<p style="margin:0;color:var(--pos,#067647);font-weight:600">✓ O documento confere com ${nomeC}${r.contratoOk ? ' · contrato ' + esc(c.contrato) : r.cotaOk ? ' · grupo e cota' : ''}</p>${prev(img)}`;
      } else if (r.nomeOk) {
        dlg.doc = { conf: 'ok', marcar: false };
        box.innerHTML = `<p style="margin:0;color:var(--pos,#067647);font-weight:600">✓ O nome ${nomeC} está no documento</p><p class="note" style="margin:4px 0 0">O número do contrato não foi encontrado; confira na prévia.</p>${prev(img)}`;
      } else {
        dlg.doc = { conf: 'divergente', marcar: true };
        box.innerHTML = `<p class="neg" style="margin:0;font-weight:600">⚠ Este documento não parece ser de ${nomeC}.</p><p class="note" style="margin:4px 0 0">Não encontrei o nome do cliente${c.contrato ? ' nem o contrato ' + esc(c.contrato) : ''} no PDF. Troque o arquivo ou confira com atenção.</p>${prev(img)}${marca(`Conferi e o documento é mesmo de ${nomeC}`)}`;
      }
    } catch (e) {
      dlg.doc = { conf: 'manual', marcar: true };
      box.innerHTML = `<p class="note">Não consegui ler o PDF (${esc(e.message)}). Confira o arquivo antes de salvar.</p>${marca(`Conferi: o documento é de ${nomeC}`)}`;
    }
  } else {
    dlg.doc = { conf: 'manual', marcar: true };
    box.innerHTML = `<p class="note">Foto: o sistema não lê a imagem. Confira o nome no documento.</p>${prev(URL.createObjectURL(f))}${marca(`Conferi: o documento é de ${nomeC}`)}`;
  }
}
async function enviarArquivo(id, prefixo, f) {
  const ext = (f.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'pdf';
  const path = `${id}/${prefixo}-${Date.now()}.${ext}`;
  const up = await sb.storage.from('comprovantes').upload(path, f, { contentType: f.type || undefined });
  return up.error ? { erro: up.error.message } : { path };
}
async function salvarCanc() {
  const dlg = $('dlgCanc'), editar = dlg.dataset.modo === 'editar';
  const id = +dlg.dataset.alvo, c = COTAS.find(x => x.id === id), f = $('ccArq').files[0];
  const motivo = $('ccMotivo').value, det = $('ccDetalhe').value.trim(), dt = $('ccData').value;
  if (!motivo) return ($('ccErro').textContent = 'Escolha o motivo.');
  if (motivo === 'Outro' && !det) return ($('ccErro').textContent = 'Descreva o motivo no detalhe.');
  if (!dt) return ($('ccErro').textContent = 'Informe a data do pedido.');
  if (!f && !editar) return ($('ccErro').textContent = 'Anexe o contrato de cancelamento assinado.');
  if (f && f.size > 10 * 1024 * 1024) return ($('ccErro').textContent = 'Arquivo muito grande (máximo 10 MB).');
  if (f && !dlg.doc) return ($('ccErro').textContent = 'Aguarde a conferência do documento.');
  if (f && dlg.doc.marcar && !($('ccMarca') && $('ccMarca').checked)) return ($('ccErro').textContent = 'Confira o documento e marque a confirmação antes de salvar.');
  $('ccSalvar').disabled = true; $('ccErro').textContent = 'Enviando…';
  let path = null;
  if (f) { const up = await enviarArquivo(id, 'canc', f); if (up.erro) { $('ccSalvar').disabled = false; return ($('ccErro').textContent = 'Não foi possível enviar: ' + up.erro); } path = up.path; }
  const conf = f ? dlg.doc.conf : null;
  const { error } = editar
    ? await sb.rpc('editar_cancelamento', { p_cota: id, p_motivo: motivo, p_detalhe: det, p_pedido: dt, p_arquivo: path, p_conf: conf })
    : await sb.rpc('registrar_cancelamento', { p_cota: id, p_motivo: motivo, p_detalhe: det, p_pedido: dt, p_arquivo: path, p_conf: conf });
  $('ccSalvar').disabled = false;
  if (error) return ($('ccErro').textContent = 'Não foi possível salvar: ' + error.message);
  if (editar) Object.assign(c.canc, { motivo, detalhe: det, pedido: parseD(dt) }, path ? { arq: path, doc: conf } : {});
  else c.canc = { motivo, detalhe: det, pedido: parseD(dt), arq: path, por: ME.id, doc: conf };
  dlg.close(); toast(editar ? `Cancelamento de ${c.cliente.split(' ')[0]} atualizado` : `Cancelamento de ${c.cliente.split(' ')[0]} registrado. Falta confirmar com o extrato da Disal.`); renderAll();
}
async function desfazerCanc(c) {
  const conf = !!c.canc.conf;
  if (!confirm(conf ? `Desfazer o cancelamento CONFIRMADO de ${c.cliente}? A cota volta à situação anterior.` : `Desfazer o registro de cancelamento de ${c.cliente}? O cliente volta ao normal.`)) return;
  const { error } = await sb.rpc('desfazer_cancelamento', { p_cota: c.id });
  if (error) return toast('Não foi possível desfazer: ' + error.message);
  if ($('dlgCanc').open) $('dlgCanc').close();
  if (conf) { toast('Cancelamento desfeito. Atualizando…'); return setTimeout(() => location.reload(), 900); }
  delete c.canc; toast(`Cancelamento de ${c.cliente.split(' ')[0]} desfeito`); renderAll();
}
// Leitura do extrato (PDF da Disal) no próprio navegador
let pdfjsPronto = null;
function carregarPdfjs() {
  if (pdfjsPronto) return pdfjsPronto;
  pdfjsPronto = new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; ok(window.pdfjsLib); };
    s.onerror = () => { pdfjsPronto = null; falha(new Error('Não foi possível carregar o leitor de PDF')); };
    document.head.appendChild(s);
  });
  return pdfjsPronto;
}
async function lerExtrato(f) {
  const lib = await carregarPdfjs();
  const pdf = await lib.getDocument({ data: await f.arrayBuffer() }).promise;
  let txt = '';
  for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) { const pg = await pdf.getPage(i); const tc = await pg.getTextContent(); txt += ' ' + tc.items.map(x => x.str).join(' '); }
  txt = txt.replace(/\s+/g, ' ');
  const g1 = txt.match(/Grupo:?\s*(\d{6})\b/), c1 = txt.match(/Cota:?\s*(\d{1,5}-\d{2})\b/), gc0 = txt.match(/\b(\d{6})\s+(\d{1,5}-\d{2})\b/);
  const gc = g1 && c1 ? [null, g1[1], c1[1]] : gc0;
  const sit = (txt.match(/\b(CANCELAD[AO]|NORMAL|N[ÃA]O CONTEMPLADA[^D]{0,20}|CONTEMPLAD[AO]|EXCLU[IÍ]D[AO]|DESISTENTE)\b/i) || [])[1] || '';
  return { grupo: gc ? gc[1] : '', cota: gc ? gc[2] : '', situacao: sit.trim().toUpperCase(), disal: /DISAL/i.test(txt), texto: txt };
}
const normN = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
function abrirConf(c) {
  $('cfTitulo').textContent = `Confirmar cancelamento · ${c.cliente}`;
  $('cfInfo').textContent = `Cadastro: grupo ${c.grupo || '—'} · cota ${c.cotaNum || '—'} · motivo: ${c.canc.motivo}`;
  $('cfArq').value = ''; $('cfLeitura').innerHTML = ''; $('cfErro').textContent = ''; $('cfSalvar').disabled = true;
  $('dlgCancConf').dataset.alvo = c.id; $('dlgCancConf').leitura = null; $('dlgCancConf').showModal();
}
async function analisarExtrato() {
  const id = +$('dlgCancConf').dataset.alvo, c = COTAS.find(x => x.id === id), f = $('cfArq').files[0];
  $('cfSalvar').disabled = true; $('cfErro').textContent = ''; if (!f) return;
  $('cfLeitura').innerHTML = '<p class="note">Lendo o extrato…</p>';
  try {
    const L = await lerExtrato(f);
    const nomeOk = normN(L.texto).includes(normN(c.cliente));
    const gOk = L.grupo && (+L.grupo === +c.grupo), cOk = L.cota && (+L.cota.split('-')[0] === +c.cotaNum), sOk = /CANCELAD/.test(L.situacao);
    const lin = (ok, t) => `<div class="row"><div class="l">${t}</div><b class="${ok ? '' : 'neg'}">${ok ? '✓' : '✗'}</b></div>`;
    $('cfLeitura').innerHTML = `<div class="list">${lin(L.disal, 'Extrato da Disal')}${lin(nomeOk, 'Nome: ' + esc(c.cliente))}${lin(gOk, `Grupo: ${L.grupo || 'não encontrado'} (cadastro ${c.grupo || '—'})`)}${lin(cOk, `Cota: ${L.cota || 'não encontrada'} (cadastro ${c.cotaNum || '—'})`)}${lin(sOk, 'Situação de cobrança: ' + (L.situacao || 'não encontrada'))}</div>`;
    $('dlgCancConf').leitura = L;
    if (L.disal && nomeOk && gOk && cOk && sOk) $('cfSalvar').disabled = false;
    else $('cfErro').textContent = !sOk ? 'O extrato não mostra a cota como CANCELADA na Disal. Ainda não dá para confirmar.' : 'Os dados do extrato não batem com o cadastro deste cliente.';
  } catch (e) { $('cfLeitura').innerHTML = ''; $('cfErro').textContent = 'Não consegui ler o PDF: ' + e.message; }
}
async function confirmarCanc() {
  const id = +$('dlgCancConf').dataset.alvo, c = COTAS.find(x => x.id === id), L = $('dlgCancConf').leitura, f = $('cfArq').files[0];
  if (!L || !f) return;
  $('cfSalvar').disabled = true; $('cfErro').textContent = 'Enviando…';
  const up = await enviarArquivo(id, 'extrato', f);
  if (up.erro) { $('cfSalvar').disabled = false; return ($('cfErro').textContent = 'Não foi possível enviar: ' + up.erro); }
  const { data, error } = await sb.rpc('confirmar_cancelamento', { p_cota: id, p_arquivo: up.path, p_grupo: L.grupo, p_cota_txt: L.cota, p_situacao: L.situacao });
  if (error) { $('cfSalvar').disabled = false; return ($('cfErro').textContent = 'Não foi possível confirmar: ' + error.message); }
  Object.assign(c.canc, { conf: TODAY, pct: data, ext: up.path });
  c.status = 'cancelada'; [2, 3, 4, 5].forEach(k => { if (c.p[k] === 'aberto') c.p[k] = 'cancelado'; });
  $('dlgCancConf').close(); toast(`Cancelamento de ${c.cliente.split(' ')[0]} confirmado pela Disal. Equipe devolve ${data}% da comissão.`); renderAll();
}
async function verArquivo(path) {
  const { data, error } = await sb.storage.from('comprovantes').createSignedUrl(path, 300);
  if (error) return toast('Não foi possível abrir: ' + error.message);
  window.open(data.signedUrl, '_blank', 'noopener');
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-canc],[data-cconf],[data-cdoc],[data-cedit],[data-cdesf]'); if (!a) return;
  const c = COTAS.find(x => x.id === +(a.dataset.canc || a.dataset.cconf || a.dataset.cdoc || a.dataset.cedit || a.dataset.cdesf)); if (!c) return;
  if (a.dataset.canc) abrirCanc(c); else if (a.dataset.cconf) abrirConf(c); else if (a.dataset.cedit) abrirCanc(c, true);
  else if (a.dataset.cdesf) desfazerCanc(c); else if (c.canc && c.canc.arq) verArquivo(c.canc.arq);
});
(() => {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  on('ccSalvar', 'click', salvarCanc); on('ccCancelar', 'click', () => $('dlgCanc').close());
  on('ccArq', 'change', conferirDoc);
  on('ccDesfazer', 'click', () => { const c = COTAS.find(x => x.id === +$('dlgCanc').dataset.alvo); if (c && c.canc) desfazerCanc(c); });
  on('cfArq', 'change', analisarExtrato); on('cfSalvar', 'click', confirmarCanc); on('cfCancelar', 'click', () => $('dlgCancConf').close());
})();
// Resumo de motivos (aparece no filtro "Cancelamentos" da carteira)
function resumoMotivos(lista) {
  const por = {}, porV = {};
  lista.forEach(c => { por[c.canc.motivo] = (por[c.canc.motivo] || 0) + 1; porV[c.vendedor] = (porV[c.vendedor] || 0) + 1; });
  const linhas = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="row"><div class="l">${esc(k)}</div><b>${n}</b></div>`).join('');
  return lista.length ? `<div class="grid2" style="margin-bottom:16px"><div class="panel"><div class="panel-head"><h2>Motivos</h2><span class="note">${lista.length} cancelamento${lista.length > 1 ? 's' : ''}${lista.some(c => c.canc.doc && c.canc.doc !== 'ok') ? ` · <b class="neg">${lista.filter(c => c.canc.doc && c.canc.doc !== 'ok').length} documento(s) para revisar</b>` : ''}</span></div><div class="list">${linhas(por)}</div></div><div class="panel"><div class="panel-head"><h2>Por vendedor</h2></div><div class="list">${linhas(porV)}</div></div></div>` : '';
}
/* <<< CANCELAMENTO <<< */
/* >>> DEBITOS >>> */
// Débitos da equipe: a gerente adm e o CEO lançam qualquer débito (descrição livre) e escolhem como descontar na sexta.
// O saldo negativo de uma sexta passa sozinho para a seguinte a partir de CARRY_DESDE.
let DEB = [], DPAG = [], CONTA = {};
const CARRY_DESDE = new Date(2026, 9, 23);
const podeDeb = () => !!(ME && (GESTOR || ME.funcao === 'gerente_adm'));
const FORMAS_DEB = { unico: 'Tudo de uma vez', parcelas: 'Parcelado', fixo: 'Valor fixo por sexta', abater: 'Abater da comissão até quitar', direto: 'Paga direto à loja, com vencimentos' };
const PERIODOS = { semanal: 'semanal', quinzenal: 'quinzenal', mensal: 'mensal' };
const r2 = v => Math.round(v * 100) / 100;
async function carregarDebitos() {
  try {
    const [d, p] = await Promise.all([sb.from('debitos').select('*').order('criado_em'), sb.from('debito_pagamentos').select('*').order('data')]);
    if (d.error) throw d.error;
    DEB = (d.data || []).map(x => ({ ...x, valor_total: Number(x.valor_total), valor_sexta: x.valor_sexta == null ? null : Number(x.valor_sexta), ini: parseD(x.inicio), venc1: x.primeiro_venc ? parseD(x.primeiro_venc) : null }));
    DPAG = (p.data || []).map(x => ({ ...x, valor: Number(x.valor), dt: parseD(x.data) }));
  } catch (e) { console.warn('Débitos ainda não disponíveis:', e.message || e); DEB = []; DPAG = []; }
}
// Parcela k (0-based) de um débito parcelado: divide em partes iguais, a última fecha os centavos
const parcelaDeb = (d, k) => { const p = Math.floor(d.valor_total / d.parcelas * 100) / 100; return k === d.parcelas - 1 ? r2(d.valor_total - p * (d.parcelas - 1)) : p; };
// Pagamento direto: parcelas com vencimento (semanal, quinzenal ou mensal); os pagamentos registrados quitam na ordem
function vencDireto(d, k) {
  if (d.periodicidade === 'mensal') { const x = new Date(d.venc1.getFullYear(), d.venc1.getMonth() + k, 1), ult = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate(); x.setDate(Math.min(d.venc1.getDate(), ult)); return x; }
  return addDays(d.venc1, k * (d.periodicidade === 'quinzenal' ? 14 : 7));
}
function agendaDireto(d) {
  let pago = DPAG.filter(p => p.debito_id === d.id).reduce((s, p) => s + p.valor, 0);
  return Array.from({ length: d.parcelas || 1 }, (_, k) => { const v = parcelaDeb(d, k), quitada = pago >= v - 0.005; pago = r2(pago - v); return { k, venc: vencDireto(d, k), v, quitada, parcial: !quitada && pago > -v ? r2(v + pago) : 0 }; });
}
const vencidasDireto = d => d.forma === 'direto' && d.status === 'ativo' ? agendaDireto(d).filter(x => !x.quitada && x.venc < TODAY) : [];
function aplicarConta(base) {
  const ativos = DEB.filter(d => d.status === 'ativo' && d.forma !== 'direto');
  const inicio = new Date(Math.min(+CARRY_DESDE, ...ativos.map(d => +d.ini)));
  const porP = {};
  base.forEach(e => { const s = +sextaPagamento(e.data); if (s < +inicio) return; const m = porP[e.pessoa] ||= {}; m[s] = (m[s] || 0) + e.valor; });
  ativos.forEach(d => { porP[d.pessoa_id] ||= {}; });
  const agora = +sextaApos(addDays(TODAY, -7));
  const extra = []; CONTA = {};
  DEB.forEach(d => { CONTA[d.id] = { descontado: 0, previsto: 0, fora: DPAG.filter(p => p.debito_id === d.id).reduce((s, p) => s + p.valor, 0), linhas: [], prox: null, fim: null }; });
  Object.entries(porP).forEach(([pid, semanas]) => {
    const meus = ativos.filter(d => d.pessoa_id === pid).sort((a, b) => a.ini - b.ini || a.id - b.id);
    const ultimaBase = Math.max(agora, ...Object.keys(semanas).map(Number));
    const ultimaParc = Math.max(0, ...meus.filter(d => d.forma === 'parcelas').map(d => +addDays(d.ini, 7 * (d.parcelas - 1))));
    const fim = Math.max(ultimaBase, ultimaParc, ...meus.filter(d => d.forma === 'unico').map(d => +d.ini)) + 7 * 864e5 * (meus.some(d => d.forma === 'fixo') ? 104 : 1);
    const rest = {}; meus.forEach(d => { rest[d.id] = d.valor_total; });
    let carry = 0;
    for (let s = +inicio; s <= fim; s = +addDays(new Date(s), 7)) {
      const S = new Date(s), seg = addDays(S, -11);
      if (!ativoEm(pid, seg)) break;
      let net = (semanas[s] || 0) + carry;
      if (carry < 0) extra.push({ pessoa: pid, papel: 'Saldo anterior', data: seg, valor: r2(carry), tipo: 'desc', cota: { id: `sa${pid}${s}`, cliente: `Saldo negativo da sexta ${fdate(addDays(S, -7))}` } });
      const desconta = (d, v, txt) => {
        v = r2(Math.min(v, rest[d.id])); if (!(v > 0)) return;
        rest[d.id] = r2(rest[d.id] - v); net -= v;
        extra.push({ pessoa: pid, papel: 'Débito', data: seg, valor: -v, tipo: 'desc', cota: { id: `db${d.id}-${s}`, cliente: txt } });
        const C = CONTA[d.id]; C.linhas.push({ s: S, v }); if (s <= agora) C.descontado += v; else { C.previsto += v; if (!C.prox) C.prox = { s: S, v }; }
        if (rest[d.id] <= 0) C.fim = S;
      };
      // pagamentos por fora até esta sexta
      meus.forEach(d => { DPAG.filter(p => p.debito_id === d.id && +sextaPagamento(p.dt) === s).forEach(p => { rest[d.id] = r2(Math.max(0, rest[d.id] - p.valor)); if (rest[d.id] <= 0 && !CONTA[d.id].fim) CONTA[d.id].fim = S; }); });
      meus.forEach(d => {
        if (s < +d.ini || rest[d.id] <= 0) return;
        const k = Math.round((s - +d.ini) / (7 * 864e5));
        if (d.forma === 'unico' && k === 0) desconta(d, d.valor_total, d.descricao);
        if (d.forma === 'parcelas' && k < d.parcelas) desconta(d, parcelaDeb(d, k), `${d.descricao} (${k + 1}/${d.parcelas})`);
        if (d.forma === 'fixo') desconta(d, d.valor_sexta, d.descricao);
      });
      meus.forEach(d => { if (d.forma === 'abater' && s >= +d.ini && rest[d.id] > 0 && net > 0) desconta(d, net, `${d.descricao} (abatimento)`); });
      carry = s >= +CARRY_DESDE ? Math.min(0, r2(net)) : 0;
      if (s > ultimaBase && meus.every(d => rest[d.id] <= 0 || d.forma === 'abater' || (d.forma === 'parcelas' && s >= +addDays(d.ini, 7 * (d.parcelas - 1))))) {
        if (carry < 0) extra.push({ pessoa: pid, papel: 'Saldo anterior', data: addDays(seg, 7), valor: r2(carry), tipo: 'desc', cota: { id: `sa${pid}${s + 7 * 864e5}`, cliente: `Saldo negativo da sexta ${fdate(S)}` } });
        break;
      }
    }
  });
  DEB.filter(d => d.forma === 'direto').forEach(d => { const a = agendaDireto(d), n = a.find(x => !x.quitada); CONTA[d.id].linhas = a.map(x => ({ s: x.venc, v: x.v, direto: true, quitada: x.quitada })); if (n && d.status === 'ativo') CONTA[d.id].prox = { s: n.venc, v: r2(n.v - n.parcial), direto: true }; });
  return base.concat(extra);
}
const restanteDeb = d => d.status !== 'ativo' ? 0 : r2(Math.max(0, d.valor_total - CONTA[d.id].fora - CONTA[d.id].descontado));
function situacaoDeb(d) {
  if (d.status === 'cancelado') return '<span class="chip c-canc">Cancelado</span>';
  const p = pessoaPorId(d.pessoa_id) || {}, falta = restanteDeb(d);
  if (falta <= 0) return '<span class="chip c-pago">Quitado</span>';
  const venc = vencidasDireto(d); if (venc.length) return `<span class="chip c-atrasado">${venc.length} ${venc.length === 1 ? 'parcela vencida' : 'parcelas vencidas'}</span>`;
  if (p.data_saida || p.ativo === false) return '<span class="chip c-atrasado">Saiu devendo</span>';
  return '<span class="chip c-aberto">Em aberto</span>';
}
function formaTxt(d) {
  if (d.forma === 'direto') return `${d.parcelas}× de ${brl(parcelaDeb(d, 0), 2)} · ${PERIODOS[d.periodicidade] || ''} · direto à loja`;
  return d.forma === 'parcelas' ? `${d.parcelas}× de ${brl(parcelaDeb(d, 0), 2)}` : d.forma === 'fixo' ? `${brl(d.valor_sexta, 2)} por sexta` : d.forma === 'abater' ? 'Abate da comissão' : 'Uma vez';
}
function renderDebitos() {
  if (!$('tbDeb') || !podeDeb()) return;
  todosEventosEquipe();   // atualiza CONTA
  const q = tira($('dbBusca').value), todos = $('dbTodos').checked;
  const lista = DEB.filter(d => (todos || (d.status === 'ativo' && restanteDeb(d) > 0)) && (!q || tira(`${(pessoaPorId(d.pessoa_id) || {}).nome} ${d.descricao}`).includes(q)))
    .sort((a, b) => (restanteDeb(b) > 0) - (restanteDeb(a) > 0) || ((pessoaPorId(a.pessoa_id) || {}).nome || '').localeCompare((pessoaPorId(b.pessoa_id) || {}).nome || ''));
  const abertos = DEB.filter(d => restanteDeb(d) > 0), prox = sextaApos(TODAY);
  const naProx = abertos.reduce((s, d) => s + (CONTA[d.id].prox && !CONTA[d.id].prox.direto && +CONTA[d.id].prox.s === +prox ? CONTA[d.id].prox.v : 0), 0);
  const sairam = abertos.filter(d => { const p = pessoaPorId(d.pessoa_id) || {}; return p.data_saida || p.ativo === false; });
  $('kpisDeb').innerHTML = kpi('Em aberto', brl(abertos.reduce((s, d) => s + restanteDeb(d), 0), 2), `${abertos.length} ${abertos.length === 1 ? 'débito' : 'débitos'}`) +
    kpi('Pessoas devendo', new Set(abertos.map(d => d.pessoa_id)).size, (() => { const n = DEB.reduce((s, d) => s + vencidasDireto(d).length, 0); return n ? `<b class="neg">${n} ${n === 1 ? 'parcela direta vencida' : 'parcelas diretas vencidas'}</b>` : 'Nenhuma parcela direta vencida'; })()) +
    kpi(`Desconta em ${fdate(prox)}`, brl(naProx, 2), 'Da comissão de sexta') +
    kpi('Saiu devendo', `<span class="${sairam.length ? 'neg' : ''}">${brl(sairam.reduce((s, d) => s + restanteDeb(d), 0), 2)}</span>`, sairam.length ? 'Não volta pela comissão' : 'Ninguém');
  $('tbDeb').innerHTML = lista.length ? lista.map(d => {
    const C = CONTA[d.id], p = pessoaPorId(d.pessoa_id) || {}, falta = restanteDeb(d), pago = r2(C.descontado + C.fora);
    return `<tr><td>${esc(p.nome || '—')}</td><td>${esc(d.descricao)}${d.obs ? `<br><span class="note">${esc(d.obs)}</span>` : ''}</td><td>${formaTxt(d)}<br><span class="note">${d.forma === 'direto' ? '1º vencimento' : 'desde'} ${fdate(d.ini)}</span></td><td class="r n">${brl(d.valor_total, 2)}</td><td class="r n">${brl(pago, 2)}</td><td class="r n ${falta > 0 ? 'neg' : ''}"><strong>${brl(falta, 2)}</strong></td>
      <td class="n">${C.prox && d.status === 'ativo' ? `${C.prox.direto ? 'vence ' : ''}${fdate(C.prox.s)} · ${brl(C.prox.v, 2)}` : '—'}</td><td>${situacaoDeb(d)}</td>
      <td><div class="acts"><button class="btn ghost sm" data-deb="ver:${d.id}">Detalhes</button>${d.status === 'ativo' && falta > 0 ? `<button class="btn ghost sm" data-deb="pag:${d.id}">Registrar pagamento</button><button class="btn ghost sm" data-deb="canc:${d.id}">Cancelar</button>` : ''}</div></td></tr>
      <tr data-debdet="${d.id}" hidden><td colspan="9">${detalheDeb(d)}</td></tr>`;
  }).join('') : `<tr><td colspan="9" class="empty">${todos ? 'Nenhum débito lançado.' : 'Ninguém devendo agora.'}</td></tr>`;
}
function detalheDeb(d) {
  const C = CONTA[d.id], agora = +sextaApos(addDays(TODAY, -7));
  const linhas = C.linhas.map(x => x.direto ? { t: x.s, txt: `Vencimento ${fdate(x.s)}`, v: x.v, ok: x.quitada, st: x.quitada ? 'pago' : x.s < TODAY ? '<b class="neg">vencida</b>' : 'a vencer' } : { t: x.s, txt: `Sexta ${fdate(x.s)}`, v: x.v, ok: +x.s <= agora })
    .concat(DPAG.filter(p => p.debito_id === d.id).map(p => ({ t: p.dt, txt: `Pagamento em ${fdate(p.dt)}${p.obs ? ' · ' + esc(p.obs) : ''}`, v: p.valor, ok: true, pid: p.id })))
    .sort((a, b) => a.t - b.t);
  const quem = d.criado_por ? ` · lançado por ${esc(nomeP(d.criado_por))}` : '';
  return `<div class="list" style="max-width:640px">${linhas.map(x => `<div class="row"><div class="l">${x.txt}<span>${x.st || (x.pid ? 'recebido' : x.ok ? 'descontado' : 'previsto')}</span></div><b>${brl(x.v, 2)}</b>${x.pid && podeDeb() ? ` <button class="btn ghost sm" data-deb="delpag:${x.pid}">Excluir</button>` : ''}</div>`).join('') || '<p class="note">Nada descontado ainda.</p>'}</div>
    <p class="note" style="margin-top:6px">${FORMAS_DEB[d.forma]}${quem}${d.status === 'cancelado' ? ` · cancelado: ${esc(d.motivo_cancel || '')}` : ''}${d.forma === 'abater' ? ' · desconta o que houver de comissão em cada sexta' : ''}</p>`;
}
// Formulário de novo débito
function abrirNovoDeb() {
  $('dbPessoa').innerHTML = '<option value="">Escolha…</option>' + PESSOAS.filter(p => p.ativo && !['ceo', 'tv'].includes(p.funcao)).sort((a, b) => a.nome.localeCompare(b.nome)).map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
  const s0 = sextaApos(TODAY);
  $('dbInicio').innerHTML = Array.from({ length: 12 }, (_, i) => addDays(s0, 7 * i)).map((d, i) => `<option value="${iso(d)}">${d.toLocaleDateString('pt-BR')}${i === 0 ? ' (próxima)' : ''}</option>`).join('');
  ['dbDesc', 'dbValor', 'dbObs', 'dbJaPago'].forEach(id => $(id).value = ''); $('dbParc').value = 2; $('dbFixo').value = ''; $('dbVenc').value = iso(addDays(TODAY, 30)); $('dbPer').value = 'mensal';
  document.querySelector('input[name="dbForma"][value="parcelas"]').checked = true;
  $('dbErro').textContent = ''; resumoDeb(); $('dlgDeb').showModal();
}
function lerFormDeb() {
  const forma = (document.querySelector('input[name="dbForma"]:checked') || {}).value;
  return { pessoa_id: $('dbPessoa').value, descricao: $('dbDesc').value.trim(), valor_total: r2(+$('dbValor').value), forma,
    parcelas: forma === 'parcelas' || forma === 'direto' ? Math.max(1, Math.min(104, Math.round(+$('dbParc').value || 0))) : null,
    valor_sexta: forma === 'fixo' ? r2(+$('dbFixo').value) : null, inicio: forma === 'direto' ? $('dbVenc').value : $('dbInicio').value, obs: $('dbObs').value.trim() || null,
    periodicidade: forma === 'direto' ? $('dbPer').value : null, primeiro_venc: forma === 'direto' ? $('dbVenc').value || null : null };
}
function resumoDeb() {
  const f = lerFormDeb();
  $('dbParcL').hidden = !['parcelas', 'direto'].includes(f.forma); $('dbFixoL').hidden = f.forma !== 'fixo';
  $('dbInicioL').hidden = f.forma === 'direto'; $('dbVencL').hidden = $('dbPerL').hidden = f.forma !== 'direto';
  $('dbParcL').firstChild.textContent = f.forma === 'direto' ? 'Quantas parcelas' : 'Em quantas sextas';
  const ini = f.inicio ? parseD(f.inicio) : null, nome = (pessoaPorId(f.pessoa_id) || {}).nome || 'o colaborador';
  let t = '';
  if (f.valor_total > 0 && ini) {
    if (f.forma === 'unico') t = `Desconta ${brl(f.valor_total, 2)} de ${esc(nome)} na sexta ${fdate(ini)}.`;
    if (f.forma === 'parcelas' && f.parcelas) { const d = { valor_total: f.valor_total, parcelas: f.parcelas }; t = `${f.parcelas}× de ${brl(parcelaDeb(d, 0), 2)}${parcelaDeb(d, f.parcelas - 1) !== parcelaDeb(d, 0) ? ` (a última de ${brl(parcelaDeb(d, f.parcelas - 1), 2)})` : ''}, de ${fdate(ini)} a ${fdate(addDays(ini, 7 * (f.parcelas - 1)))}.`; }
    if (f.forma === 'fixo' && f.valor_sexta > 0) { const n = Math.ceil(f.valor_total / f.valor_sexta - 1e-9); t = `${brl(f.valor_sexta, 2)} por sexta a partir de ${fdate(ini)}: ${n} ${n === 1 ? 'sexta' : 'sextas'}, quitado em ${fdate(addDays(ini, 7 * (n - 1)))}.`; }
    if (f.forma === 'direto' && f.parcelas && f.primeiro_venc) { const d = { valor_total: f.valor_total, parcelas: f.parcelas, periodicidade: f.periodicidade, venc1: parseD(f.primeiro_venc) }; const vs = Array.from({ length: Math.min(f.parcelas, 4) }, (_, k) => fdate(vencDireto(d, k))).join(', '); t = `${f.parcelas}× de ${brl(parcelaDeb(d, 0), 2)}, ${PERIODOS[f.periodicidade]}, vencendo ${vs}${f.parcelas > 4 ? '…' : ''}. Não sai da comissão: cada pagamento é registrado no sistema, e parcela vencida fica em vermelho.`; }
    if (f.forma === 'abater') t = `A partir de ${fdate(ini)}, toda comissão de ${esc(nome)} abate a dívida até chegar a ${brl(f.valor_total, 2)}. Sem comissão na sexta, não desconta nada.`;
  }
  const jp = r2(+$('dbJaPago').value || 0); if (t && jp > 0) t += ` Já pago antes: ${brl(jp, 2)} (falta ${brl(Math.max(0, f.valor_total - jp), 2)}).`;
  $('dbResumo').innerHTML = t ? `<b>Resumo:</b> ${t}${f.forma !== 'direto' ? ' Se a comissão da sexta não cobrir, o que faltar passa para a sexta seguinte.' : ''}` : 'Preencha valor e forma de desconto para ver o resumo.';
}
async function salvarDeb() {
  const f = lerFormDeb();
  if (!f.pessoa_id) return ($('dbErro').textContent = 'Escolha a pessoa.');
  if (!f.descricao) return ($('dbErro').textContent = 'Escreva o que é o débito.');
  if (!(f.valor_total > 0)) return ($('dbErro').textContent = 'Informe o valor total.');
  if (!f.forma) return ($('dbErro').textContent = 'Escolha como descontar.');
  if (f.forma === 'fixo' && !(f.valor_sexta > 0)) return ($('dbErro').textContent = 'Informe o valor por sexta.');
  if (f.forma === 'direto' && !f.primeiro_venc) return ($('dbErro').textContent = 'Informe o primeiro vencimento.');
  const jaPago = r2(+$('dbJaPago').value || 0);
  if (jaPago < 0 || jaPago >= f.valor_total) return ($('dbErro').textContent = jaPago >= f.valor_total ? 'O valor já pago é igual ou maior que o total: não há o que lançar.' : 'Valor já pago inválido.');
  $('dbSalvar').disabled = true; $('dbErro').textContent = 'Salvando…';
  const { data: novo, error } = await sb.from('debitos').insert(f).select('id').single();
  if (!error && jaPago > 0) { const r = await sb.from('debito_pagamentos').insert({ debito_id: novo.id, data: iso(TODAY), valor: jaPago, obs: 'Pago antes do lançamento no sistema' }); if (r.error) toast('Débito salvo, mas o valor já pago não foi registrado: ' + r.error.message); }
  $('dbSalvar').disabled = false;
  if (error) return ($('dbErro').textContent = 'Não foi possível salvar: ' + error.message);
  $('dlgDeb').close(); await carregarDebitos(); renderAll(); toast(`Débito lançado para ${(pessoaPorId(f.pessoa_id) || {}).nome}`);
}
async function pagouFora(id) {
  const d = DEB.find(x => x.id === id); if (!d) return;
  const sug = CONTA[d.id] && CONTA[d.id].prox && CONTA[d.id].prox.direto ? CONTA[d.id].prox.v : restanteDeb(d);
  const v = prompt(`Quanto ${(pessoaPorId(d.pessoa_id) || {}).nome} pagou direto (dinheiro/Pix)? Falta ${brl(restanteDeb(d), 2)}.`, String(sug).replace('.', ','));
  if (v == null) return;
  const valor = r2(+String(v).replace(/\./g, '').replace(',', '.'));
  if (!(valor > 0)) return toast('Valor inválido');
  const obs = prompt('Observação (opcional): ex. Pix em 17/10') || null;
  const { error } = await sb.from('debito_pagamentos').insert({ debito_id: id, data: iso(TODAY), valor, obs });
  if (error) return toast('Não foi possível registrar: ' + error.message);
  await carregarDebitos(); renderAll(); toast(`Pagamento de ${brl(valor, 2)} registrado`);
}
async function cancelarDeb(id) {
  const d = DEB.find(x => x.id === id); if (!d) return;
  const m = prompt(`Cancelar o débito "${d.descricao}" de ${(pessoaPorId(d.pessoa_id) || {}).nome}? O que já foi descontado continua descontado. Motivo:`);
  if (m == null) return;
  if (!m.trim()) return toast('Informe o motivo para cancelar');
  const { error } = await sb.from('debitos').update({ status: 'cancelado', motivo_cancel: m.trim(), cancelado_em: new Date().toISOString(), cancelado_por: ME.id }).eq('id', id);
  if (error) return toast('Não foi possível cancelar: ' + error.message);
  await carregarDebitos(); renderAll(); toast('Débito cancelado');
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-deb]'); if (!b) return;
  const [acao, v] = b.dataset.deb.split(':'), id = +v;
  if (acao === 'novo') abrirNovoDeb();
  if (acao === 'ver') { const tr = document.querySelector(`[data-debdet="${id}"]`); if (tr) tr.hidden = !tr.hidden; }
  if (acao === 'pag') pagouFora(id);
  if (acao === 'canc') cancelarDeb(id);
  if (acao === 'delpag') { if (!confirm('Excluir este pagamento por fora?')) return; const { error } = await sb.from('debito_pagamentos').delete().eq('id', id); if (error) return toast('Não foi possível excluir: ' + error.message); await carregarDebitos(); renderAll(); }
  if (acao === 'sugestao') { $('dbDesc').value = b.textContent; resumoDeb(); }
});
(() => {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  on('dbSalvar', 'click', salvarDeb); on('dbVoltar', 'click', () => $('dlgDeb').close());
  ['dbPessoa', 'dbValor', 'dbParc', 'dbFixo', 'dbInicio', 'dbVenc', 'dbPer', 'dbJaPago'].forEach(id => { on(id, 'input', resumoDeb); on(id, 'change', resumoDeb); });
  document.querySelectorAll('input[name="dbForma"]').forEach(r => r.addEventListener('change', resumoDeb));
  on('dbBusca', 'input', renderDebitos); on('dbTodos', 'change', renderDebitos);
})();
// Quadro "Meus débitos" na Minha comissão
function meusDebitosHtml(pid) {
  const l = DEB.filter(d => d.pessoa_id === pid && d.status === 'ativo');
  if (!l.length) return '<p class="note">Nenhum débito em aberto.</p>';
  return l.map(d => { const C = CONTA[d.id] || {}, falta = restanteDeb(d);
    return `<div class="row"><div class="l">${esc(d.descricao)}<span>${formaTxt(d)} · total ${brl(d.valor_total, 2)} · já descontado ${brl(r2((C.descontado || 0) + (C.fora || 0)), 2)}${C.prox ? ` · ${C.prox.direto ? 'próximo vencimento' : 'próxima sexta'}: ${fdate(C.prox.s)} (${brl(C.prox.v, 2)})` : ''}${vencidasDireto(d).length ? ' · <b class="neg">parcela vencida</b>' : ''}</span></div><b class="${falta > 0 ? 'neg' : ''}">${falta > 0 ? 'falta ' + brl(falta, 2) : 'quitado'}</b></div>`; }).join('');
}
/* <<< DEBITOS <<< */
/* >>> TELEFONE >>> */
// Corrigir o telefone do cliente direto na carteira (administrativo, supervisor, gerente adm e CEO)
async function editarTelefone(c) {
  const v = prompt(`Telefone de ${c.cliente} (com DDD):`, c.telefone || '');
  if (v == null) return;
  const dig = v.replace(/\D/g, '');
  if (dig && !(dig.length === 10 || dig.length === 11)) return toast('Telefone inválido: use DDD + número (10 ou 11 dígitos).');
  const tel = dig.length === 11 ? `${dig.slice(0, 2)} ${dig.slice(2, 3)} ${dig.slice(3, 7)}-${dig.slice(7)}` : dig.length === 10 ? `${dig.slice(0, 2)} ${dig.slice(2, 6)}-${dig.slice(6)}` : null;
  const { error } = await sb.from('cotas').update({ telefone: tel }).eq('id', c.id);
  if (error) return toast('Não foi possível salvar: ' + error.message);
  c.telefone = tel; toast(`Telefone de ${c.cliente.split(' ')[0]} atualizado`); renderAll();
}
document.addEventListener('click', e => { const b = e.target.closest('[data-tel]'); if (!b) return; const c = COTAS.find(x => x.id === +b.dataset.tel); if (c) editarTelefone(c); });
// Ajustar o vencimento da 2ª (ex.: cliente que ainda vai para a assembleia e só paga no mês seguinte)
const addMeses = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth() + n, 1); x.setDate(Math.min(d.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); return x; };
const podeAjustarVenc = c => podeInformar() && valida(c) && !['pago', 'nao_pago', 'cancelado'].includes(c.p[2]);
async function ajustarVenc2(c) {
  const atual = venc(c, 2), br = d => d.toLocaleDateString('pt-BR');
  const v = prompt(`Novo vencimento da 2ª parcela de ${c.cliente} (dd/mm/aaaa).\nHoje está ${br(atual)}. A 3ª, 4ª e 5ª passam a vencer mês a mês depois dela.`, br(addMeses(atual, 1)));
  if (v == null) return;
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/); if (!m) return toast('Use o formato dd/mm/aaaa');
  const d = new Date(+(m[3].length === 2 ? '20' + m[3] : m[3]), +m[2] - 1, +m[1]);
  if (d.getDate() !== +m[1] || d.getMonth() !== +m[2] - 1) return toast('Data inválida');
  const motivo = (prompt('Motivo do ajuste (ex.: vai participar da assembleia de novembro):', '') || '').trim();
  if (!motivo) return toast('Ajuste não feito: informe o motivo');
  const { error } = await sb.rpc('ajustar_venc2', { p_cota: c.id, p_data: iso(d), p_motivo: motivo });
  if (error) return toast('Não foi possível ajustar: ' + error.message);
  for (let k = 2; k <= 5; k++) if (!['pago', 'nao_pago', 'cancelado'].includes(c.p[k])) c.venc[k] = addMeses(d, k - 2);
  toast(`A 2ª de ${c.cliente.split(' ')[0]} agora vence em ${br(d)}`); renderAll();
}
document.addEventListener('click', e => { const b = e.target.closest('[data-venc2]'); if (!b) return; const c = COTAS.find(x => x.id === +b.dataset.venc2); if (c) ajustarVenc2(c); });
/* <<< TELEFONE <<< */
iniciar();
})();
