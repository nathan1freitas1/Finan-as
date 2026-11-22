const { JSDOM } = require('jsdom'); const fs = require('fs'); const dir = '/home/claude/meu-caixa/';
const dom = new JSDOM('<!DOCTYPE html><body><div id="app"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window; const d = w.document; w.scrollTo = () => {};
w.eval(fs.readFileSync(dir + 'logic.js', 'utf8')); w.eval(fs.readFileSync(dir + 'db.js', 'utf8').replace('const DB =', 'window.DB ='));
const esp = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { console.log(c ? 'OK   ' : 'FALHA', m); if (!c) process.exitCode = 1; };
const q = (s) => d.querySelector(s); const qa = (s) => [...d.querySelectorAll(s)];
const btn = (t) => qa('button').filter((b) => b.textContent.trim().startsWith(t)).pop();
const Lg = w.Logic;
(async () => {
  // ---- lógica pura
  const ex = Lg.vencidosPendentes(
    [{ id: 1, status: 'pendente', data: '2026-11-23' }, { id: 2, status: 'pendente', data: '2026-11-20' }, { id: 3, status: 'pendente', data: '2026-11-23', manualPendente: true }, { id: 4, status: 'pendente', data: '2026-11-25' }, { id: 5, status: 'pago', data: '2026-11-23' }],
    [{ id: 'f1', dia: 23, inicio: '2026-09', fim: null }, { id: 'f2', dia: 23, inicio: '2026-11', fim: null }],
    [{ id: 'f2|2026-11', status: 'pendente' }], '2026-11-23', '2026-11-22');
  ok(ex.lancs.map((l) => l.id).join() === '1', 'só o pendente de hoje (>desde) vira pago: ' + ex.lancs.map((l) => l.id));
  ok(ex.fixos.length === 1 && ex.fixos[0].fixoId === 'f1' && ex.fixos[0].mes === '2026-11', 'fixa f1 de novembro vira paga; f2 (desmarcada) e meses antigos não');
  const g = Lg.agruparPorCategoria([{ categoria: 'mercado', valor: 500, status: 'pago' }, { categoria: null, valor: 9000, status: 'pendente' }, { categoria: 'moradia', valor: 1000, status: 'pendente' }, { categoria: 'mercado', valor: 700, status: 'pendente' }]);
  ok(g.map((x) => x.nome).join() === 'Mercado,Moradia,Sem categoria' && g[0].total === 1200 && g[0].pendentes === 1, 'agrupa e ordena: ' + g.map((x) => x.nome + ':' + x.total));

  // ---- app
  await w.DB.init(); await w.DB.salvarConfig('saldoDefinido', true);
  const hoje = Lg.hojeISO(); const ch = hoje.slice(0, 7);
  await w.DB.salvarConfig('autoPagoDesde', '2000-01-01'); // simula recurso ligado há tempo
  await w.DB.salvarLancamento({ tipo: 'despesa', valor: 5000, status: 'pendente', data: hoje, descricao: 'Fatura cartão', categoria: 'online' });
  await w.DB.salvarLancamento({ tipo: 'despesa', valor: 3000, status: 'pendente', data: hoje, descricao: 'Desmarcada', manualPendente: true });
  await w.DB.salvarLancamento({ tipo: 'despesa', valor: 2000, status: 'pendente', data: ch + '-28', descricao: 'Futura', categoria: 'mercado' });
  await w.DB.salvarLancamento({ tipo: 'despesa', valor: 1000, status: 'pendente', data: ch + '-28', descricao: 'Futura2', categoria: 'mercado' });
  w.eval(fs.readFileSync(dir + 'app.js', 'utf8').replace("estado.persistente = r.persistente;", "estado.persistente = true;")); await esp(400);
  const ls = await w.DB.listarLancamentos();
  const por = (n) => ls.find((l) => l.descricao === n);
  ok(por('Fatura cartão').status === 'pago', 'pendente que venceu virou pago ao abrir o app');
  ok(por('Desmarcada').status === 'pendente', 'o que foi desmarcado de propósito continua pendente');
  ok(por('Futura').status === 'pendente', 'futuro continua pendente');
  // desmarcar pelo toque => manualPendente
  qa('.check')[0].click(); await esp(100);
  // visão por categoria
  btn('Por categoria').click(); await esp(60);
  ok(qa('.grupo').length >= 2, 'grupos: ' + qa('.grupo-nome').map((x) => x.textContent));
  const mer = qa('.grupo-cab').find((b) => b.textContent.includes('Mercado')); mer.click(); await esp(40);
  ok(!!btn('Marcar tudo como pago (1)'), 'botão pagar tudo com 1 pendente');
  btn('Marcar tudo como pago').click(); await esp(150);
  const ls2 = await w.DB.listarLancamentos();
  ok(ls2.filter((l) => l.categoria === 'mercado').every((l) => l.status === 'pago'), 'categoria toda paga');
  ok((await w.DB.lerConfig()).visao === 'categorias', 'visão salva');
  // formulário: categoria só em despesa
  btn('Lista').click(); await esp(40);
  q('.fab').click(); await esp(40);
  ok(!!q('.folha select') && q('.folha select').parentElement.style.display !== 'none', 'select de categoria visível em despesa');
  btn('Receita').click(); ok(q('.folha select').parentElement.style.display === 'none', 'oculto em receita'); btn('Despesa').click();
  q('.folha .valor-grande').value = '45'; q('.folha select').value = 'combustivel';
  [...qa('.folha .primario')].pop().click(); await esp(150);
  const nova = (await w.DB.listarLancamentos()).find((l) => l.valor === 4500);
  ok(nova && nova.categoria === 'combustivel', 'lançamento salvo com categoria combustivel');
  console.log('fim');
})().catch((e) => { console.error('ERRO', e); process.exit(1); });
