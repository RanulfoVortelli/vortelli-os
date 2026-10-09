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
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

/* ---------------- Estado ---------------- */
let ME = null, GESTOR = false;
let EQUIPES = [], PESSOAS = [], R = {}, COTAS = [], LANC = [];
const r = k => (R[k] ? Number(R[k].valor) : 0);
const pessoaPorId = id => PESSOAS.find(p => p.id === id);
const nomeP = id => (pessoaPorId(id) || {}).nome || '—';
const equipeNome = id => (EQUIPES.find(e => e.id === id) || {}).nome || '—';
const FUNCAO = {ceo:'CEO', gerente:'Gerente', vendedor:'Vendedor', gerente_adm:'Gerente adm', administrativo:'Administrativo'};

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
  $('loginMsg').textContent = error ? 'Não foi possível enviar: ' + error.message : 'Enviamos um link para ' + email + '. Abra o e-mail neste aparelho e toque no link para criar a sua senha.';
}
$('btnPrimeiro').addEventListener('click', () => enviarLinkSenha('primeiro'));
$('btnEsqueci').addEventListener('click', () => enviarLinkSenha('esqueci'));
let definirSenha = new URLSearchParams(location.search).has('definir');
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
    let { data: eu } = await sb.from('pessoas').select('*').eq('user_id', user.id).maybeSingle();
    if (!eu) { await sb.rpc('vincular_meu_login'); ({ data: eu } = await sb.from('pessoas').select('*').eq('user_id', user.id).maybeSingle()); }
    if (!eu) { await sb.auth.signOut(); mostrarLogin(`O e-mail ${user.email} não está cadastrado no Vortelli OS. Peça ao administrativo para cadastrar.`); return; }
    ME = eu; GESTOR = ['ceo', 'gerente_adm'].includes(eu.funcao);
    const [eq, ps, rg, ct, lc, cn] = await Promise.all([
      sb.from('equipes').select('*').order('id'),
      sb.from('pessoas').select('*').order('nome'),
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
    $('login').hidden = true; $('app').hidden = false;
    $('quem').textContent = `${ME.nome} · ${FUNCAO[ME.funcao]}`;
    document.querySelectorAll('[data-gestor]').forEach(b => b.hidden = !GESTOR);
    document.querySelectorAll('[data-pode-lancar]').forEach(b => b.hidden = !(GESTOR || ['gerente', 'administrativo'].includes(ME.funcao)));
    initFiltros(); renderRegras(); renderAll();
    let start = GESTOR ? 'painel' : 'cotas';
    try { const v = localStorage.getItem('vos_view'); if (v && !(document.querySelector(`[data-view="${v}"]`) || {}).hidden) start = v; } catch (e) {}
    go(start);
  } catch (e) {
    console.error(e); mostrarLogin('Erro ao carregar os dados: ' + (e.message || e));
  }
}
function montarCota(c, contatos) {
  const p = {}, venc = {};
  (c.parcelas || []).forEach(x => { p[x.numero] = x.status; venc[x.numero] = parseD(x.vencimento); });
  for (let k = 1; k <= 5; k++) { if (!p[k]) p[k] = k === 1 ? 'pago' : 'aberto'; }
  return {
    id: c.id, contrato: c.contrato, cliente: c.cliente, telefone: c.telefone, credito: Number(c.credito || 0), parcela: Number(c.parcela_valor || 0),
    venda: parseD(c.data_venda), venc, p, status: c.status, estornoDoc: c.estorno_documento, recuperacao: parseD(c.recuperacao_data), equipeId: c.equipe_id,
    vendedor_id: c.vendedor_id, fechador_id: c.fechador_id, adm_id: c.adm_id,
    vendedor: nomeP(c.vendedor_id), fechador: nomeP(c.fechador_id), adm: c.adm_id ? nomeP(c.adm_id) : 'Sem carteira',
    equipe: equipeNome(c.equipe_id || (pessoaPorId(c.vendedor_id) || {}).equipe_id), contato: contatos.has(c.id)
  };
}
const valida = c => c.status !== 'cancelada' && c.credito > 0;
const venc = (c, k) => c.venc[k] || addDays(c.venda, 30 * (k - 1));
// Status mostrado: parcela vencida há mais de 3 dias sem baixa aparece como "atrasado"
const stView = (c, k) => (c.p[k] === 'aberto' && venc(c, k) < addDays(TODAY, -3)) ? 'atrasado' : c.p[k];

/* ---------------- Motor de cálculo ---------------- */
function eventosLoja(c) {
  if (!valida(c)) return [];
  const ev = [{ data: c.venda, tipo: 'entrada', valor: r('entrada') - c.parcela },
              { data: c.venda, tipo: 'disal', valor: c.credito * r('disal_venda') / 100 }];
  for (let k = 3; k <= 5; k++) {
    if (c.p[k] === 'pago') ev.push({ data: venc(c, k), tipo: 'disal', valor: c.credito * r('disal_p345') / 100 });
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
const ativoEm = (id, d) => { const p = pessoaPorId(id); return !(p && p.data_saida && d >= parseD(p.data_saida)); };
function eventosEquipe(c) {
  if (!valida(c)) return [];
  const ev = [];
  const { partes } = partesVenda(c);
  partes.forEach(x => ev.push({ pessoa: x.pessoa, papel: x.papel, data: c.venda, valor: x.valor, tipo: 'com', cota: c }));
  // Estorno de 50% quando a 2ª não é paga (não vale para estorno por documento)
  if (c.p[2] === 'nao_pago' && !c.estornoDoc) {
    const d = addDays(venc(c, 2), 5), f = r('estorno_equipe') / 100;
    const vendedorRecebeu = partes.some(x => x.papel === 'Vendedor');
    partes.forEach(x => {
      if (x.papel === 'Gerente' && !vendedorRecebeu) return;
      ev.push({ pessoa: x.pessoa, papel: x.papel, data: d, valor: -x.valor * f, tipo: 'est', cota: c });
      if (c.recuperacao) ev.push({ pessoa: x.pessoa, papel: x.papel, data: c.recuperacao, valor: x.valor * f, tipo: 'rec', cota: c });
    });
  }
  // Administrativo e gerente administrativo: 0,05% por 3ª, 4ª e 5ª parcela paga
  const gerAdm = PESSOAS.filter(p => p.funcao === 'gerente_adm' && p.ativo);
  for (let k = 3; k <= 5; k++) {
    if (c.p[k] !== 'pago') continue;
    const d = venc(c, k);
    if (c.adm_id) ev.push({ pessoa: c.adm_id, papel: 'Administrativo', data: d, valor: c.credito * r('adm_parcela') / 100, tipo: 'com', cota: c });
    gerAdm.forEach(g => ev.push({ pessoa: g.id, papel: 'Gerente adm', data: d, valor: c.credito * r('gerente_adm_parcela') / 100, tipo: 'com', cota: c }));
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
const todosEventosEquipe = () => COTAS.flatMap(eventosEquipe).concat(bonusGerenteGeral());
function mesResumo(ym) {
  const vendas = COTAS.filter(c => valida(c) && noMes(c.venda, ym));
  let disal = 0, entrada = 0, equipe = 0;
  COTAS.forEach(c => {
    eventosLoja(c).forEach(e => { if (noMes(e.data, ym) && e.data <= TODAY && !e.previsto) { if (e.tipo === 'disal') disal += e.valor; else entrada += e.valor; } });
    eventosEquipe(c).forEach(e => { if (noMes(e.data, ym) && e.data <= TODAY) equipe += e.valor; });
  });
  bonusGerenteGeral().forEach(e => { if (noMes(e.data, ym) && e.data <= TODAY) equipe += e.valor; });
  return { vendas, disal, entrada, imp: Math.max(0, disal) * r('imposto') / 100, equipe };
}
function despesasMes(ym) {
  return LANC.filter(l => noMes(l.data, ym) && l.data <= TODAY).reduce((s, l) => s + (l.tipo === 'saida' ? l.valor : -l.valor), 0);
}
function alertasLista() {
  const lim = addDays(TODAY, 15);
  return COTAS.filter(c => valida(c) && c.p[2] === 'aberto' && venc(c, 2) <= lim && venc(c, 2) >= addDays(TODAY, -45))
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
  const desp = despesasMes(ymNow), res = m.entrada + m.disal - m.imp - m.equipe - desp;
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
    ['Despesas lançadas', -desp, 'Financeiro'],
  ].map(([t, v, s]) => `<div class="row"><div class="l">${t}<span>${s}</span></div><b class="${v < 0 ? 'neg' : ''}">${brl(v)}</b></div>`).join('') +
    `<div class="row"><div class="l"><strong>Resultado parcial</strong><span>Inclua folha e aluguel no Financeiro</span></div><b class="${res < 0 ? 'neg' : 'pos'}" style="font-size:17px">${brl(res)}</b></div>`;
  const porEq = EQUIPES.filter(e => e.nome !== 'Administrativo').map(e => { const v = m.vendas.filter(c => c.equipe === e.nome); const ger = PESSOAS.find(p => p.equipe_id === e.id && p.funcao === 'gerente'); return { nome: e.nome, ger: ger ? ger.nome : '', n: v.length, cred: v.reduce((s, c) => s + c.credito, 0) }; }).sort((a, b) => b.n - a.n || b.cred - a.cred);
  $('rankEquipes').innerHTML = porEq.map((e, i) => `<div class="row"><div class="l"><span style="font-family:var(--f-num)">${i + 1}º</span>${esc(e.nome)} · ${esc(e.ger)}</div><b>${e.n} cotas · ${brl(e.cred)}</b></div>`).join('');
  const atras = al.filter(c => stView(c, 2) === 'atrasado').length;
  const prox = sextaApos(addDays(TODAY, -1));
  const aPagar = todosEventosEquipe().filter(e => +sextaPagamento(e.data) === +prox).reduce((s, e) => s + e.valor, 0);
  const semCarteira = COTAS.filter(c => valida(c) && !c.adm_id && c.p[5] !== 'pago').length;
  const pend = Object.values(R).filter(x => x.pendente).length;
  $('atencao').innerHTML = [
    [`${atras} clientes com a 2ª vencida sem baixa`, 'Ligar hoje antes do estorno', 'alertas'],
    [`${al.length - atras} clientes com a 2ª vencendo em 15 dias`, 'Contato preventivo do administrativo', 'alertas'],
    [`Pagamento da sexta ${fdate(prox)}: ${brl(aPagar)}`, 'Conferir antes de liberar', 'comissoes'],
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
const podeBaixar = () => GESTOR || (ME && ME.funcao === 'administrativo');
function renderCotas() {
  const ym = +$('qMes').value, eq = $('qEquipe').value, q = $('qBusca').value.trim().toLowerCase();
  const rows = COTAS.filter(c => noMes(c.venda, ym) && (!eq || c.equipe === eq) && (!q || `${c.cliente} ${c.vendedor} ${c.contrato || ''}`.toLowerCase().includes(q)));
  $('tbCotas').innerHTML = rows.length ? rows.map(c => `<tr><td class="n">${fdate(c.venda)}</td><td class="n">${esc(c.contrato || '—')}</td><td>${esc(c.cliente)}</td><td class="r n">${c.credito ? brl(c.credito) : '—'}</td><td>${esc(c.vendedor)}</td><td>${esc(c.fechador)}</td><td>${esc(c.adm)}</td>
    <td><span class="pp">${[1, 2, 3, 4, 5].map(k => { const s = stView(c, k); const t = `${k}ª: ${s} · venc. ${fdate(venc(c, k))}`; return k > 1 && podeBaixar() && c.status !== 'cancelada' ? `<button data-parc="${c.id}:${k}" title="${t}" aria-label="${t}"><i class="s-${s}">${k}</i></button>` : `<i class="s-${s}" title="${t}">${k}</i>`; }).join('')}</span></td><td>${chipSit(c)}</td></tr>`).join('')
    : `<tr><td colspan="9" class="empty">Nenhuma cota neste filtro.</td></tr>`;
}

function renderComissoes() {
  const sexta = new Date(+$('qSexta').value);
  const ev = todosEventosEquipe().filter(e => +sextaPagamento(e.data) === +sexta && (GESTOR || e.pessoa === ME.id || (ME.funcao === 'gerente')));
  const map = {};
  ev.forEach(e => { const m = map[e.pessoa] ||= { id: e.pessoa, cotas: new Set(), com: 0, est: 0 }; if (e.tipo === 'com' || e.tipo === 'rec') { m.com += e.valor; if (e.tipo === 'com') m.cotas.add(e.cota.id); } else m.est += e.valor; });
  const lista = Object.values(map).sort((a, b) => (b.com + b.est) - (a.com + a.est));
  const tc = lista.reduce((s, x) => s + x.com, 0), te = lista.reduce((s, x) => s + x.est, 0);
  $('kpisCom').innerHTML = kpi('Comissões', brl(tc)) + kpi('Estornos', `<span class="neg">${brl(te)}</span>`) + kpi('Total a pagar', brl(tc + te)) + kpi('Pessoas', lista.length);
  $('tbCom').innerHTML = lista.length ? lista.map(x => { const p = pessoaPorId(x.id) || {}; return `<tr><td>${esc(p.nome)}</td><td>${FUNCAO[p.funcao] || '—'}</td><td>${esc(equipeNome(p.equipe_id))}</td><td class="r n">${x.cotas.size}</td><td class="r n">${brl(x.com, 2)}</td><td class="r n ${x.est ? 'neg' : ''}">${x.est ? brl(x.est, 2) : '—'}</td><td class="r n"><strong>${brl(x.com + x.est, 2)}</strong></td></tr>`; }).join('') +
    `<tr class="total"><td colspan="4">Total</td><td class="r n">${brl(tc, 2)}</td><td class="r n neg">${brl(te, 2)}</td><td class="r n">${brl(tc + te, 2)}</td></tr>`
    : `<tr><td colspan="7" class="empty">Nada a pagar nesta sexta.</td></tr>`;
}

function renderAlertas() {
  const L = alertasLista();
  $('badgeAlert').textContent = L.length;
  $('kpisAlert').innerHTML = kpi('Clientes no radar', L.length) + kpi('Vencidas sem baixa', `<span class="neg">${L.filter(c => stView(c, 2) === 'atrasado').length}</span>`) + kpi('Contatos feitos', L.filter(c => c.contato).length) + kpi('Dinheiro em risco', brl(L.reduce((s, c) => s + riscoCota(c), 0)), 'Estorno loja + equipe');
  $('tbAlert').innerHTML = L.length ? L.map(c => `<tr><td class="n">${fdate(venc(c, 2))}</td><td>${esc(c.cliente)}</td><td class="n">${esc(c.telefone || '—')}</td><td>${esc(c.adm)}</td><td>${esc(c.vendedor)}</td><td class="r n">${brl(c.parcela, 2)}</td><td class="r n neg">${brl(riscoCota(c))}</td>
    <td>${stView(c, 2) === 'atrasado' ? '<span class="chip c-atrasado">Vencida</span>' : '<span class="chip c-aberto">A vencer</span>'} ${c.contato ? '<span class="chip c-pago">Contato feito</span>' : ''}</td>
    <td><div class="acts">${c.contato ? '' : `<button class="btn ghost sm" data-contato="${c.id}">Contato feito</button>`}${podeBaixar() ? `<button class="btn sm" data-baixa="${c.id}:pago">Pagou</button><button class="btn ghost sm" data-baixa="${c.id}:nao_pago">Não pagou</button>` : ''}</div></td></tr>`).join('')
    : `<tr><td colspan="9" class="empty">Nenhum cliente no radar.</td></tr>`;
}

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
  const todos = [...auto, ...man].sort((a, b) => b.data - a.data);
  const ent = todos.filter(x => x.sinal > 0).reduce((s, x) => s + x.valor, 0), sai = todos.filter(x => x.sinal < 0).reduce((s, x) => s + x.valor, 0);
  const traf = man.filter(l => l.cat === 'Tráfego pago').reduce((s, l) => s + l.valor, 0);
  const vendas = COTAS.filter(c => valida(c) && noMes(c.venda, ymNow)).length;
  $('kpisFin').innerHTML = kpi('Entradas no mês', brl(ent)) + kpi('Saídas no mês', `<span class="neg">${brl(sai)}</span>`) + kpi('Saldo', brl(ent - sai)) + kpi('Tráfego por cota', vendas && traf ? brl(traf / vendas) : '—', `${brl(traf)} em tráfego`);
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
      <div class="list">${ger.map(g => `<div class="row"><div class="l">${esc(g.nome)}<span>Gerente e fechador</span></div><b>${vm.filter(c => c.fechador_id === g.id).length} fechadas</b></div>`).join('')}
      ${vend.map(p => `<div class="row"><div class="l">${esc(p.nome)}<span>Vendedor</span></div><b>${vm.filter(c => c.vendedor_id === p.id).length} cotas</b></div>`).join('')}</div></article>`;
  }).join('') + `<article class="team"><div class="team-head"><h2>Administrativo</h2><span class="pill">${ativos.filter(p => ['administrativo', 'gerente_adm'].includes(p.funcao)).length} pessoas</span></div>
    <div class="list">${ativos.filter(p => ['administrativo', 'gerente_adm'].includes(p.funcao)).map(p => `<div class="row"><div class="l">${esc(p.nome)}<span>${FUNCAO[p.funcao]}</span></div><b>${COTAS.filter(c => valida(c) && c.adm_id === p.id && c.p[5] !== 'pago' && c.p[2] !== 'nao_pago').length} clientes</b></div>`).join('')}</div></article>`;
}

const GRUPOS = [['Disal e loja', ['entrada', 'disal_venda', 'disal_p345', 'estorno_disal', 'estorno_doc', 'recuperacao', 'imposto', 'meta_cotas']], ['Venda (por situação)', ['vendedor', 'vendedor_fecha', 'fechador_pct', 'fixo_fechador_sozinho', 'fixo_gerente_propria_equipe', 'fixo_fechador_outra_equipe', 'gerente_fechador_outra_equipe', 'gerente_vendedor_fecha_pct', 'gerente_vendedor_fecha_fixo']], ['Parcelas, estorno e bônus', ['adm_parcela', 'gerente_adm_parcela', 'estorno_equipe', 'gg_min_cotas', 'gg_por_cota']]];
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
  const sel = $('fuEquipe').value;
  $('fuEquipe').innerHTML = '<option value="">Sem equipe</option>' + EQUIPES.map(e => `<option value="${e.id}">${esc(e.nome)}</option>`).join('');
  $('fuEquipe').value = sel;
  const lista = [...PESSOAS].sort((a, b) => (b.ativo - a.ativo) || a.nome.localeCompare(b.nome));
  $('tbUsuarios').innerHTML = lista.map(p => {
    const st = !p.ativo ? '<span class="chip c-canc">Inativo</span>' : p.user_id ? '<span class="chip c-pago">Acesso ativo</span>' : p.email ? '<span class="chip c-atrasado">Convite enviado</span>' : '<span class="chip c-aberto">Sem e-mail</span>';
    const acao = p.ativo && !p.user_id ? `<button class="btn sm" data-convidar="${p.id}">${p.email ? 'Reenviar convite' : 'Salvar e convidar'}</button>` : '';
    return `<tr><td>${esc(p.nome)}</td><td>${FUNCAO[p.funcao] || '—'}</td><td>${esc(equipeNome(p.equipe_id))}</td><td><input type="email" aria-label="E-mail de ${esc(p.nome)}" value="${esc(p.email || '')}" data-email-de="${p.id}" placeholder="email@exemplo.com" style="min-width:220px" ${p.user_id ? 'disabled' : ''}></td><td>${st}</td><td>${acao}</td></tr>`;
  }).join('');
}
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
  toast('Convite enviado para ' + email);
}
function initFiltros() {
  const yms = [...new Set(COTAS.map(c => ymOf(c.venda)).concat([ymNow]))].sort((a, b) => b - a);
  $('qMes').innerHTML = yms.map(ym => `<option value="${ym}">${ymLabel(ym)}</option>`).join('');
  $('qEquipe').innerHTML = '<option value="">Todas</option>' + EQUIPES.filter(e => e.nome !== 'Administrativo').map(e => `<option>${esc(e.nome)}</option>`).join('');
  const sextas = []; let s = addDays(sextaApos(addDays(TODAY, -1)), 7); for (let i = 0; i < 10; i++) { sextas.push(s); s = addDays(s, -7); }
  $('qSexta').innerHTML = sextas.map((d, i) => `<option value="${+d}">${d.toLocaleDateString('pt-BR')}${+d === +sextaApos(addDays(TODAY, -1)) ? ' (esta semana)' : i === 0 ? ' (previsão)' : ''}</option>`).join('');
  const ativos = PESSOAS.filter(p => p.ativo);
  const opt = l => l.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
  $('fVend').innerHTML = opt(ativos.filter(p => ['vendedor', 'gerente'].includes(p.funcao)));
  $('fFech').innerHTML = opt(ativos.filter(p => ['gerente', 'vendedor'].includes(p.funcao)));
  $('fAdm').innerHTML = '<option value="">Sem carteira</option>' + opt(ativos.filter(p => ['administrativo', 'gerente_adm'].includes(p.funcao)));
  $('fData').value = iso(TODAY); $('lData').value = iso(TODAY);
}
function renderAll() { renderPainel(); renderCotas(); renderComissoes(); renderAlertas(); renderFin(); renderEquipes(); renderManual(); renderUsuarios(); }
function go(view) {
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
['qMes', 'qEquipe', 'qBusca'].forEach(id => $(id).addEventListener('input', renderCotas));
$('qSexta').addEventListener('change', renderComissoes);
$('btnNova').addEventListener('click', () => { $('formCota').hidden = false; $('fCliente').focus(); });
$('btnCancelar').addEventListener('click', () => { $('formCota').hidden = true; });
$('fCredito').addEventListener('input', () => { $('fParc').value = ((+$('fCredito').value || 0) * 0.011781).toFixed(2); });
$('formCota').addEventListener('submit', async ev => {
  ev.preventDefault();
  const vend = pessoaPorId($('fVend').value);
  const row = {
    cliente: $('fCliente').value.trim(), telefone: $('fTel').value.trim() || null, credito: +$('fCredito').value, parcela_valor: +$('fParc').value,
    data_venda: $('fData').value, vencimento_1: $('fVenc').value || $('fData').value, contrato: $('fContrato').value.trim() || null,
    login_disal: $('fLogin').value, vendedor_id: vend.id, fechador_id: $('fFech').value, adm_id: $('fAdm').value || null, equipe_id: vend.equipe_id
  };
  const { data, error } = await sb.from('cotas').insert(row).select('*, parcelas(*)').single();
  if (error) return toast('Não foi possível salvar: ' + error.message);
  COTAS.unshift(montarCota(data, new Set())); COTAS.sort((a, b) => b.venda - a.venda);
  $('formCota').reset(); $('formCota').hidden = true; initFiltros(); $('qMes').value = ymOf(parseD(row.data_venda));
  toast('Cota lançada'); renderAll();
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
  const { data, error } = await sb.from('pessoas').insert({ nome, apelido, funcao: $('fuFuncao').value, equipe_id: $('fuEquipe').value ? +$('fuEquipe').value : null, ativo: true }).select().single();
  if (error) return toast('Não foi possível criar: ' + error.message);
  PESSOAS.push(data); $('formUsuario').reset();
  await convidar(data, email);
});
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-convidar]'); if (!b) return;
  const p = pessoaPorId(b.dataset.convidar);
  const inp = document.querySelector(`[data-email-de="${p.id}"]`);
  b.disabled = true; await convidar(p, inp ? inp.value : p.email); b.disabled = false;
});

iniciar();
})();
