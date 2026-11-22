const { JSDOM } = require('jsdom'); const fs = require('fs'); const dir = '/home/claude/meu-caixa/';
const dom = new JSDOM('<!DOCTYPE html><body><div id="app"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window; const d = w.document; w.scrollTo = () => {};
w.eval(fs.readFileSync(dir + 'logic.js', 'utf8')); w.eval(fs.readFileSync(dir + 'db.js', 'utf8').replace('const DB =', 'window.DB ='));
const esp = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { console.log(c ? 'OK   ' : 'FALHA', m); if (!c) process.exitCode = 1; };
const q = (s) => d.querySelector(s); const qa = (s) => [...d.querySelectorAll(s)];
const btn = (t) => qa('button').filter((b) => b.textContent.trim() === t).pop();
(async () => {
  await w.DB.init(); await w.DB.salvarConfig('saldoDefinido', true);
  w.eval(fs.readFileSync(dir + 'app.js', 'utf8').replace("estado.persistente = r.persistente;", "estado.persistente = true;")); await esp(400);
  q('.fab').click(); await esp(40);
  ok(!/Até quando/.test(q('.folha').textContent), 'sem campo "Até quando" (única)');
  btn('Fixa').click(); await esp(20);
  ok(!/Até quando/.test(q('.folha').textContent) && !q('input[type=month]'), 'sem campo "Até quando" (fixa)');
  btn('Única').click();
  // somador
  btn('＋ Somar valores').click(); await esp(40);
  const folhas = qa('.folha'); ok(folhas.length === 2, 'somador abre por cima do formulário');
  const inN = folhas[1].querySelector('input');
  const add = (t) => { inN.value = t; btn('Adicionar').click(); };
  add('12,50'); add('8'); add('3,20'); add('abc');
  ok(folhas[1].querySelectorAll('.soma-item').length === 3, '3 itens na lista (inválido ignorado)');
  ok(folhas[1].textContent.includes('R$ 23,70') || folhas[1].textContent.includes('23,70'), 'total 23,70: ' + q('.soma-total').textContent);
  folhas[1].querySelectorAll('.soma-item button')[1].click(); // remove 8
  ok(q('.soma-total').textContent.includes('15,70'), 'após remover 8: ' + q('.soma-total').textContent);
  inN.value = '4,30'; btn('Usar total').click(); await esp(20); // digitado e não adicionado entra junto
  ok(qa('.folha').length === 1, 'somador fecha');
  ok(q('.folha .valor-grande').value === '20,00', 'valor do campo = 20,00: ' + q('.folha .valor-grande').value);
  q('.folha input[type=text]:not(.valor-grande)').value = 'Padaria e outros';
  [...qa('.folha .primario')].pop().click(); await esp(150);
  ok(q('#app').textContent.includes('Padaria e outros') && q('#app').textContent.includes('20,00'), 'lançamento salvo com 20,00');
  // fixa sem fim
  q('.fab').click(); await esp(40); btn('Fixa').click(); q('.folha .valor-grande').value = '100';
  [...qa('.folha .primario')].pop().click(); await esp(150);
  const fx = await w.DB.listarFixos(); ok(fx.length === 1 && fx[0].fim === null, 'fixa criada com fim=null');
  // somador reabre com valor atual como 1º item (edição)
  qa('.item')[0].click(); await esp(40); btn('＋ Somar valores').click(); await esp(30);
  ok(qa('.soma-item').length === 1, 'somador na edição já traz o valor atual');
  console.log('fim');
})().catch((e) => { console.error('ERRO', e); process.exit(1); });
