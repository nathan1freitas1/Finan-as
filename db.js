/* Camada de dados do Meu Caixa: IndexedDB, com memória como plano B.
   O resto do app só fala com este objeto; trocar por banco online depois é mexer só aqui. */
const DBLocal = (function () {
  const NOME = 'meucaixa';
  const VERSAO = 3; // v2 acrescentou 'fixos' e 'excecoes'; v3 acrescentou 'apagados' (lista de exclusões, para a sincronização)
  const STORES = { lancamentos: 'id', config: 'chave', fixos: 'id', excecoes: 'id', apagados: 'k' };
  // configurações que viajam para a nuvem quando a sincronização do Privado está ligada
  const CFG_SYNC = ['saldoInicial', 'saldoDefinido', 'autoPagoDesde', 'catMemoria', 'juros'];
  let aoMudar = null; // a sincronização se registra aqui para ser avisada de cada alteração
  let db = null;
  let emMemoria = false;
  const mem = { lancamentos: [], fixos: [], excecoes: [], config: {}, apagados: [] };

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

  // grava sem carimbar nem avisar a sincronização (usado por ela mesma ao aplicar o que veio da nuvem)
  async function gravarCru(store, obj) {
    if (emMemoria && store === 'config') { mem.config[obj.chave] = obj.valor; return obj; }
    if (emMemoria) {
      const i = mem[store].findIndex((x) => x[STORES[store]] === obj[STORES[store]]);
      if (i >= 0) mem[store][i] = obj; else mem[store].push(obj);
      return obj;
    }
    await pedido(store, 'readwrite', (s) => s.put(obj));
    return obj;
  }
  async function apagarCru(store, chave) {
    if (emMemoria) { mem[store] = mem[store].filter((x) => x[STORES[store]] !== chave); return; }
    await pedido(store, 'readwrite', (s) => s.delete(chave));
  }

  async function salvar(store, obj) {
    if (!obj.id) { obj.id = novoId(); obj.criadoEm = Date.now(); }
    obj.atualizadoEm = Date.now();
    await gravarCru(store, obj);
    await apagarCru('apagados', store + ':' + obj.id); // recriado depois de apagado: vale o novo
    if (aoMudar) aoMudar();
    return obj;
  }

  async function excluir(store, id) {
    await apagarCru(store, id);
    await gravarCru('apagados', { k: store + ':' + id, tabela: store, id, em: Date.now() });
    if (aoMudar) aoMudar();
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
    await gravarCru('config', { chave, valor });
    if (CFG_SYNC.includes(chave)) {
      const em = await cfgEm(); em[chave] = Date.now();
      await gravarCru('config', { chave: 'syncEm', valor: em });
      if (aoMudar) aoMudar();
    }
  }
  // quando cada configuração sincronizável mudou pela última vez
  async function cfgEm() {
    const l = (await lerConfig()).syncEm;
    return Object.assign({}, l || {});
  }

  // ---- backup: tudo num JSON ----
  async function exportar() {
    return JSON.stringify({
      app: 'meu-caixa', versao: 2, geradoEm: new Date().toISOString(),
      config: Object.assign(await lerConfig(), { syncEm: undefined }),
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

  // ---- ganchos da sincronização (sync.js) ----
  const sync = {
    avisarMudancas: (fn) => { aoMudar = fn; },
    CFG_SYNC,
    listarCru: (store) => listar(store),
    aplicar: (store, obj) => gravarCru(store, obj),
    removerSemMarca: (store, id) => apagarCru(store, id),
    apagados: () => listar('apagados'),
    esquecerApagados: async (chaves) => { for (const k of chaves) await apagarCru('apagados', k); },
    cfgEm,
    configSalva: async () => { // só o que foi de fato gravado, sem os valores padrão
      if (emMemoria) return Object.assign({}, mem.config);
      const o = {}; (await pedido('config', 'readonly', (s) => s.getAll())).forEach((x) => { o[x.chave] = x.valor; }); return o;
    },
    aplicarConfig: async (chave, valor, em) => {
      await gravarCru('config', { chave, valor });
      const m = await cfgEm(); m[chave] = em;
      await gravarCru('config', { chave: 'syncEm', valor: m });
    },
  };

  return {
    init, lerConfig, salvarConfig, exportar, importar, lerBackup, sync,
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

/* Fachada: o app fala com DB e ele escolhe de onde vêm os dados.
   'privado' = este aparelho (IndexedDB). 'juntos' = nuvem compartilhada (juntos.js).
   Só estas chaves de configuração são compartilhadas no Juntos; o resto (backup, juros, visão) continua no aparelho. */
const DB = (function (Loc) {
  let modo = 'privado';
  const CFG_JUNTOS = ['saldoInicial', 'saldoDefinido', 'autoPagoDesde', 'catMemoria'];
  const J = () => (typeof Juntos !== 'undefined' ? Juntos : null);
  const r = (loc, jun) => (...a) => (modo === 'juntos' ? jun(...a) : loc(...a));
  return Object.assign({}, Loc, {
    usarEspaco: (m) => { modo = (m === 'juntos' && J() && J().pronto()) ? 'juntos' : 'privado'; return modo; },
    espaco: () => modo,
    listarLancamentos: r(Loc.listarLancamentos, async () => J().listar('lancamentos')),
    salvarLancamento: r(Loc.salvarLancamento, (l) => { if (!l.id) { l.id = crypto.randomUUID(); l.criadoEm = Date.now(); } return J().salvar('lancamentos', l); }),
    excluirLancamento: r(Loc.excluirLancamento, (id) => J().excluir('lancamentos', id)),
    listarFixos: r(Loc.listarFixos, async () => J().listar('fixos')),
    salvarFixo: r(Loc.salvarFixo, (f) => { if (!f.id) { f.id = crypto.randomUUID(); f.criadoEm = Date.now(); } return J().salvar('fixos', f); }),
    excluirFixo: r(Loc.excluirFixo, (id) => J().excluir('fixos', id)),
    listarExcecoes: r(Loc.listarExcecoes, async () => J().listar('excecoes')),
    salvarExcecao: r(Loc.salvarExcecao, (e) => J().salvar('excecoes', e)),
    excluirExcecao: r(Loc.excluirExcecao, (id) => J().excluir('excecoes', id)),
    lerConfig: async () => {
      const base = await Loc.lerConfig();
      if (modo !== 'juntos') return base;
      CFG_JUNTOS.forEach((k) => delete base[k]);
      return Object.assign(base, { saldoInicial: 0, saldoDefinido: true }, J().lerConfig());
    },
    salvarConfig: async (k, v) => (modo === 'juntos' && CFG_JUNTOS.includes(k) ? J().salvarConfig(k, v) : Loc.salvarConfig(k, v)),
  });
})(DBLocal);
