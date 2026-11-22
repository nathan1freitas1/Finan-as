const { JSDOM } = require('jsdom'); const fs = require('fs'); const dir = '/home/claude/meu-caixa/';
const dom = new JSDOM('<!DOCTYPE html><body><div id="app"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window; const d = w.document; w.scrollTo = () => {};
w.eval(fs.readFileSync(dir + 'logic.js', 'utf8')); w.eval(fs.readFileSync(dir + 'db.js', 'utf8').replace('const DB =', 'window.DB ='));
const ok = (c, m) => { console.log(c ? 'OK   ' : 'FALHA', m); if (!c) process.exitCode = 1; };
const esp = (ms = 80) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await w.DB.init(); await w.DB.salvarConfig('saldoDefinido', true);
  w.eval(fs.readFileSync(dir + 'app.js', 'utf8').replace("estado.persistente = r.persistente;", "estado.persistente = true;")); await esp(300);
  d.querySelector('[aria-label="Ajustes"]').click(); await esp(40);
  ok(d.querySelector('.folha').textContent.includes('Atualizar o aplicativo') && d.querySelector('.folha').textContent.includes('Versão instalada: 4'), 'ajustes tem o botão e a versão');
})();
