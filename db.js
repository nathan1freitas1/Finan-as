/* Camada de dados do Meu Caixa: IndexedDB, com memória como plano B.
   O resto do app só fala com este objeto; trocar por banco online depois é mexer só aqui. */
const DB = (function () {
  const NOME = 'meucaixa';
  const VERSAO = 2; // v2 acrescentou 'fixos' e 'excecoes'
  const STORES = { lancamentos: 'id', config: 'chave', fixos: 'id', excecoes: 'id' };
  let db = null;
  let emMemoria = false;
  const mem = { lancamentos: [], fixos: [], excecoes: [], config: {} };

  const novoId = () =>
    (self.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2));

  function abrir() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(NOME, VERSAO);
        req.onupgradeneeded = () => {
          // cria só o que falta: quem já tinha a v1 mantém os dados
          Object.entries(STORES).forEach(([nome, chave]) => {
            if (!req.result.objectStoreNames.contains(nome)) req.result.createObjectStore(nome, { keyPath: chave });
          });
        };
        req.onsuccess = () => { db = req.result; resolve(true); };
        req.onerror = () => { emMemoria = true; resolve(false); };
      } catch (e) {
        emMemoria = true;
        resolve(false);
      }
    });
  }

  function pedido(store, modo, fn) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, modo);
      const r = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(r && r.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function init() {
    await abrir();
    // pede ao navegador para não apagar estes dados quando faltar espaço (quando ele permite)
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* sem problema */ }
    return { persistente: !emMemoria };
  }

  // ---- genéricos (lancamentos, fixos, excecoes) ----
  async function listar(store) {
    if (emMemoria) return mem[store].slice();
    return pedido(store, 'readonly', (s) => s.getAll());
  }

  async function salvar(store, obj) {
    if (!obj.id) { obj.id = novoId(); obj.criadoEm = Date.now(); }
    if (emMemoria) {
      const i = mem[store].findIndex((x) => x.id === obj.id);
      if (i >= 0) mem[store][i] = obj; else mem[store].push(obj);
      return obj;
    }
    await pedido(store, 'readwrite', (s) => s.put(obj));
    return obj;
  }

  async function excluir(store, id) {
    if (emMemoria) { mem[store] = mem[store].filter((x) => x.id !== id); return; }
    await pedido(store, 'readwrite', (s) => s.delete(id));
  }

  // ---- config ----
  async function lerConfig() {
    let linhas;
    if (emMemoria) linhas = Object.entries(mem.config).map(([chave, valor]) => ({ chave, valor }));
    else linhas = await pedido('config', 'readonly', (s) => s.getAll());
    const cfg = { saldoInicial: 0, saldoDefinido: false };
    linhas.forEach((x) => { cfg[x.chave] = x.valor; });
    return cfg;
  }

  async function salvarConfig(chave, valor) {
    if (emMemoria) { mem.config[chave] = valor; return; }
    await pedido('config', 'readwrite', (s) => s.put({ chave, valor }));
  }

  // ---- backup: tudo num JSON ----
  async function exportar() {
    return JSON.stringify({
      app: 'meu-caixa', versao: 2, geradoEm: new Date().toISOString(),
      config: await lerConfig(),
      lancamentos: await listar('lancamentos'),
      fixos: await listar('fixos'),
      excecoes: await listar('excecoes'),
    }, null, 1);
  }

  // lê e confere o texto de um backup, sem mexer em nada
  function lerBackup(texto) {
    let d;
    try { d = JSON.parse(texto); } catch (e) { throw new Error('O arquivo não é um backup do Meu Caixa'); }
    if (!d || d.app !== 'meu-caixa' || !Array.isArray(d.lancamentos)) throw new Error('O arquivo não é um backup do Meu Caixa');
    d.config = d.config || {};
    return d;
  }

  // modo 'substituir': apaga o que há aqui e coloca o do arquivo.
  // modo 'juntar': mantém o que há aqui e acrescenta o do arquivo (mesmo registro = vale o do arquivo).
  async function importar(texto, modo) {
    const d = lerBackup(texto);
    const cfgLocal = await lerConfig();
    for (const nome of ['lancamentos', 'fixos', 'excecoes']) {
      if (modo !== 'juntar') for (const x of await listar(nome)) await excluir(nome, x.id);
      for (const x of d[nome] || []) await salvar(nome, x); // backup antigo (v1) não tem fixos: tudo bem
    }
    if (modo !== 'juntar' || !cfgLocal.saldoDefinido) {
      await salvarConfig('saldoInicial', d.config.saldoInicial || 0);
      await salvarConfig('saldoDefinido', true);
    }
    if (d.config.catMemoria) await salvarConfig('catMemoria', modo === 'juntar' ? Object.assign({}, d.config.catMemoria, cfgLocal.catMemoria || {}) : d.config.catMemoria);
    if (d.config.juros && modo !== 'juntar') await salvarConfig('juros', d.config.juros);
  }

  return {
    init, lerConfig, salvarConfig, exportar, importar, lerBackup,
    listarLancamentos: () => listar('lancamentos'),
    salvarLancamento: (l) => salvar('lancamentos', l),
    excluirLancamento: (id) => excluir('lancamentos', id),
    listarFixos: () => listar('fixos'),
    salvarFixo: (f) => salvar('fixos', f),
    excluirFixo: (id) => excluir('fixos', id),
    listarExcecoes: () => listar('excecoes'),
    salvarExcecao: (e) => salvar('excecoes', e),
    excluirExcecao: (id) => excluir('excecoes', id),
  };
})();
