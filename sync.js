/* Meu Caixa: sincronização do Privado com a nuvem (só a sua conta enxerga).
   O Privado continua funcionando no aparelho, mesmo sem internet. Quando há internet, este arquivo:
   1) baixa o que mudou em outros aparelhos; 2) envia o que mudou aqui.
   Conflito: vale a alteração mais recente de cada lançamento. Exclusão também sincroniza. */
(function (root) {
  'use strict';
  const LS = 'mc_sync';
  const TABELAS = ['lancamentos', 'fixos', 'excecoes'];
  let rodando = null;
  let pedirDeNovo = false;
  let timer = null;
  let ultimaVolta = 0;
  const ouvintes = [];

  const ler = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } };
  const gravar = (e) => { try { localStorage.setItem(LS, JSON.stringify(e)); } catch (er) { /* sem espaço: tudo bem */ } };
  const avisar = () => ouvintes.forEach((f) => { try { f(); } catch (e) { /* ouvinte com erro não derruba a sincronização */ } });
  const D = () => DB.sync;

  function estado() {
    const e = ler();
    const logado = typeof Nuvem !== 'undefined' && Nuvem.logado();
    return {
      ativo: !!e.ativo,
      logado,
      outraConta: !!(e.ativo && logado && Nuvem.meuId() !== e.user),
      ultimo: e.ultimo || 0,
      erro: e.erro || '',
      rodando: !!rodando,
    };
  }

  async function passada(e) {
    const T = D();
    const t0 = Date.now();
    let recebidos = 0, enviados = 0;
    // ---- 1) baixar ----
    const locais = {};
    for (const t of TABELAS) { locais[t] = {}; (await T.listarCru(t)).forEach((x) => { locais[t][x.id] = x; }); }
    const tombs = {}; (await T.apagados()).forEach((x) => { tombs[x.k] = x; });
    let cfgEm = await T.cfgEm();
    let cursor = e.cursor || '';
    for (;;) {
      const lote = await Nuvem.ler('p_registros', 'select=*&order=recebido_em.asc&limit=1000' + (cursor ? '&recebido_em=gt.' + encodeURIComponent(cursor) : ''));
      for (const r of lote) {
        if (r.tabela === 'config') {
          if (T.CFG_SYNC.includes(r.id) && r.atualizado_em > (cfgEm[r.id] || 0) && r.dados && 'valor' in r.dados) {
            await T.aplicarConfig(r.id, r.dados.valor, r.atualizado_em); cfgEm[r.id] = r.atualizado_em; recebidos++;
          }
          continue;
        }
        if (!locais[r.tabela]) continue;
        const loc = locais[r.tabela][r.id];
        const tomb = tombs[r.tabela + ':' + r.id];
        if (r.apagado) {
          if (loc && (loc.atualizadoEm || 0) <= r.atualizado_em) { await T.removerSemMarca(r.tabela, r.id); delete locais[r.tabela][r.id]; recebidos++; }
          continue;
        }
        if (tomb && tomb.em >= r.atualizado_em) continue; // apaguei aqui depois: a exclusão é mais nova e vai subir
        if (!loc || (loc.atualizadoEm || 0) < r.atualizado_em) {
          const novo = Object.assign({}, r.dados, { id: r.id, atualizadoEm: r.atualizado_em });
          await T.aplicar(r.tabela, novo); locais[r.tabela][r.id] = novo;
          if (tomb) { await T.esquecerApagados([tomb.k]); delete tombs[tomb.k]; }
          recebidos++;
        }
      }
      if (lote.length) cursor = lote[lote.length - 1].recebido_em;
      if (lote.length < 1000) break;
    }
    // ---- 2) enviar ----
    const uid = Nuvem.meuId();
    const tudo = e.empurrado === 0 || e.empurrado === undefined;
    const desde = e.empurrado || 0;
    const linhas = [];
    for (const t of TABELAS) {
      for (const x of await T.listarCru(t)) {
        const em = x.atualizadoEm || 0;
        if (!tudo && em < desde) continue;
        const dados = Object.assign({}, x); delete dados.id; delete dados.atualizadoEm;
        linhas.push({ user_id: uid, tabela: t, id: x.id, dados, apagado: false, atualizado_em: em || 1 });
      }
    }
    const apag = await T.apagados();
    apag.forEach((x) => linhas.push({ user_id: uid, tabela: x.tabela, id: x.id, dados: null, apagado: true, atualizado_em: x.em }));
    const salvas = await T.configSalva(); cfgEm = await T.cfgEm();
    T.CFG_SYNC.forEach((k) => {
      if (!(k in salvas)) return;
      const em = cfgEm[k] || 0;
      if (!tudo && em < desde) return;
      linhas.push({ user_id: uid, tabela: 'config', id: k, dados: { valor: salvas[k] }, apagado: false, atualizado_em: em || 1 });
    });
    for (let i = 0; i < linhas.length; i += 200) await Nuvem.gravar('p_registros', linhas.slice(i, i + 200));
    enviados = linhas.length;
    if (apag.length) await T.esquecerApagados(apag.map((x) => x.k));
    return { recebidos, enviados, cursor, t0 };
  }

  async function sincronizar() {
    const e0 = ler();
    if (!e0.ativo || typeof Nuvem === 'undefined' || !Nuvem.logado() || Nuvem.meuId() !== e0.user) return null;
    if (rodando) { pedirDeNovo = true; return rodando; }
    rodando = (async () => {
      avisar();
      let r = null;
      try {
        const e = ler();
        r = await passada(e);
        gravar(Object.assign(ler(), { cursor: r.cursor, empurrado: r.t0, ultimo: Date.now(), erro: '' }));
        if (r.recebidos > 0 && root.Sync.aoReceber) await root.Sync.aoReceber(r);
      } catch (er) {
        gravar(Object.assign(ler(), { erro: er.offline ? 'Sem internet: vai sincronizar quando voltar.' : (er.message || 'Falha ao sincronizar.') }));
      } finally {
        rodando = null;
        avisar();
        if (pedirDeNovo) { pedirDeNovo = false; agendar(300); }
      }
      return r;
    })();
    return rodando;
  }

  function agendar(ms) {
    if (!ler().ativo) return;
    clearTimeout(timer);
    timer = setTimeout(sincronizar, ms == null ? 1500 : ms);
  }

  async function ligar() {
    if (!Nuvem.logado()) throw new Error('Entre na sua conta primeiro.');
    gravar({ ativo: true, user: Nuvem.meuId(), cursor: '', empurrado: 0, ultimo: 0, erro: '' });
    const r = await sincronizar();
    const e = ler();
    if (e.erro && !r) throw new Error(e.erro);
    return r;
  }
  function desligar() { clearTimeout(timer); gravar({}); avisar(); }

  function iniciar() {
    if (typeof DB !== 'undefined' && DB.sync) DB.sync.avisarMudancas(() => agendar());
    if (typeof addEventListener === 'function') {
      addEventListener('online', () => agendar(500));
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && Date.now() - ultimaVolta > 20000) { ultimaVolta = Date.now(); agendar(300); }
      });
    }
    agendar(800);
  }

  root.Sync = { estado, ligar, desligar, sincronizar, iniciar, aoMudarEstado: (f) => ouvintes.push(f), aoReceber: null };
})(typeof window !== 'undefined' ? window : globalThis);
