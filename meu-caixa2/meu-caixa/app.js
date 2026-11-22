/* Meu Caixa — telas. Depende de Logic (logic.js) e DB (db.js). */
(function () {
  const L = Logic;
  const hoje0 = new Date();
  const estado = {
    ano: hoje0.getFullYear(),
    mes: hoje0.getMonth() + 1,
    lancs: [], fixos: [], excecoes: [],
    filtroTipo: null, soPendentes: false,
    tela: 'mes', // 'mes' | 'previsao' | 'juros'
    juros: { inicial: '1000,00', aporte: '200,00', taxa: '10', taxaPor: 'ano', prazo: '10', prazoEm: 'anos' },
    jurosCarregado: false,
    cfg: { saldoInicial: 0, saldoDefinido: false },
    persistente: true,
  };

  // helper para criar elementos (usa textContent: nada de HTML injetado)
  function h(tag, props, ...filhos) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    });
    filhos.flat().forEach((f) => {
      if (f == null || f === false) return;
      el.append(f.nodeType ? f : document.createTextNode(f));
    });
    return el;
  }

  const classeSinal = (c) => (c < 0 ? 'neg' : '');
  const excId = (fixoId, mes) => fixoId + '|' + mes;
  const excDe = (fixoId, mes) =>
    estado.excecoes.find((e) => e.id === excId(fixoId, mes)) || { id: excId(fixoId, mes), fixoId, mes };

  // Lançamentos avulsos + ocorrências dos fixos. Expande até o mês mais distante que importa:
  // o mês exibido, o mês de hoje, ou o último mês com fixo já marcado como pago.
  function todos() {
    const chaveVista = L.chaveMes(estado.ano, estado.mes);
    let ate = chaveVista > L.hojeISO().slice(0, 7) ? chaveVista : L.hojeISO().slice(0, 7);
    estado.excecoes.forEach((e) => { if (e.status === 'pago' && e.mes > ate) ate = e.mes; });
    return L.todosLancamentos(estado.lancs, estado.fixos, estado.excecoes, ate);
  }

  // No dia do vencimento, o que estava pendente vira pago sozinho (o dinheiro sai da conta nesse dia).
  async function autoPagar() {
    const hoje = L.hojeISO();
    if (!estado.cfg.autoPagoDesde) { // primeira vez: só vale para datas daqui pra frente
      await DB.salvarConfig('autoPagoDesde', hoje);
      estado.cfg.autoPagoDesde = hoje;
    }
    const r = L.vencidosPendentes(estado.lancs, estado.fixos, estado.excecoes, hoje, estado.cfg.autoPagoDesde);
    for (const l of r.lancs) { l.status = 'pago'; await DB.salvarLancamento(l); }
    for (const x of r.fixos) {
      const e = excDe(x.fixoId, x.mes); e.status = 'pago'; await DB.salvarExcecao(e);
      if (!estado.excecoes.includes(e)) estado.excecoes.push(e);
    }
    return r.lancs.length + r.fixos.length > 0;
  }

  async function recarregar() {
    estado.lancs = await DB.listarLancamentos();
    estado.fixos = await DB.listarFixos();
    estado.excecoes = await DB.listarExcecoes();
    estado.cfg = await DB.lerConfig();
    if (await autoPagar()) {
      estado.lancs = await DB.listarLancamentos();
      estado.excecoes = await DB.listarExcecoes();
    }
    if (estado.agrupar === undefined) estado.agrupar = estado.cfg.visao === 'categorias';
    if (!estado.jurosCarregado) {
      if (estado.cfg.juros) Object.assign(estado.juros, estado.cfg.juros);
      estado.jurosCarregado = true;
    }
    desenhar();
  }

  function mudarMes(delta) {
    let m = estado.mes + delta, a = estado.ano;
    if (m < 1) { m = 12; a--; }
    if (m > 12) { m = 1; a++; }
    estado.mes = m; estado.ano = a;
    desenhar();
  }

  async function alternarPago(l) {
    const novo = l.status === 'pago' ? 'pendente' : 'pago';
    if (l.fixo) {
      const e = excDe(l.fixoId, l.mes);
      e.status = novo;
      await DB.salvarExcecao(e);
    } else {
      l.status = novo;
      if (novo === 'pendente') l.manualPendente = true; else delete l.manualPendente; // desmarcou de propósito: não paga sozinho
      await DB.salvarLancamento(l);
    }
    await recarregar();
  }

  // ---------- tela principal ----------
  function desenhar() {
    if (estado.tela === 'previsao') { desenharPrevisao(); return; }
    if (estado.tela === 'juros') { desenharJuros(); return; }
    const { ano, mes, cfg } = estado;
    const t = todos();
    const atual = L.saldoAtual(cfg, t);
    const previsto = L.saldoPrevistoFimMes(cfg, t, ano, mes);
    const r = L.resumoMes(t, ano, mes);
    const doMes = L.doMes(t, ano, mes);
    const itens = L.filtrar(doMes, estado.filtroTipo, estado.soPendentes);
    const bal = L.balancoMes(r);
    const alternarTipo = (tipo) => { estado.filtroTipo = estado.filtroTipo === tipo ? null : tipo; desenhar(); };
    const rotuloBalanco = (v) => (v > 0 ? 'positivo' : v < 0 ? 'negativo' : 'zerado');
    const classeBalanco = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

    const app = document.getElementById('app');
    app.replaceChildren(...[
      h('div', { class: 'topo' },
        h('button', { class: 'icone', 'aria-label': 'Ajustes', onclick: abrirAjustes }, '⚙'),
        h('div', { style: 'display:flex;align-items:center;gap:6px' },
          h('button', { class: 'icone', 'aria-label': 'Mês anterior', onclick: () => mudarMes(-1) }, '‹'),
          h('div', { class: 'mes' }, L.MESES[mes - 1] + (ano !== hoje0.getFullYear() ? ' ' + ano : '')),
          h('button', { class: 'icone', 'aria-label': 'Próximo mês', onclick: () => mudarMes(1) }, '›')),
        h('div', { style: 'width:42px' })),

      !estado.persistente && h('div', { class: 'aviso' }, 'Este navegador não está guardando dados: o que você lançar some ao fechar a página.'),
      estado.persistente && avisoBackup(),

      h('div', { class: 'hero' },
        h('div', { class: 'rotulo' }, 'Saldo atual'),
        h('div', { class: 'grande ' + classeSinal(atual) }, L.formatBRL(atual)),
        h('div', { class: 'prev' }, 'Previsto no fim do mês: ',
          h('span', { class: classeSinal(previsto) }, L.formatBRL(previsto)))),

      h('div', { class: 'duplo' },
        h('button', { class: 'caixa filtro' + (estado.filtroTipo === 'receita' ? ' ativo-rec' : ''), 'aria-pressed': String(estado.filtroTipo === 'receita'), onclick: () => alternarTipo('receita') },
          h('div', { class: 't' }, h('span', { class: 'bolinha', style: 'background:var(--verde)' }, '+'), 'Receitas'),
          h('div', { class: 'v' }, L.formatBRL(r.receitaPaga)),
          h('div', { class: 'p' }, 'Previsto ' + L.formatBRL(r.receitaPrevista))),
        h('button', { class: 'caixa filtro' + (estado.filtroTipo === 'despesa' ? ' ativo-des' : ''), 'aria-pressed': String(estado.filtroTipo === 'despesa'), onclick: () => alternarTipo('despesa') },
          h('div', { class: 't' }, h('span', { class: 'bolinha', style: 'background:var(--vermelho)' }, '−'), 'Despesas'),
          h('div', { class: 'v' }, L.formatBRL(r.despesaPaga)),
          h('div', { class: 'p' }, 'Previsto ' + L.formatBRL(r.despesaPrevista)))),

      cartaoBalanco(L.composicaoMes(doMes), rotuloBalanco, classeBalanco),

      h('div', { class: 'cab-lista' },
        h('h2', {}, 'Lançamentos' + (doMes.length ? ' (' + itens.length + (itens.length !== doMes.length ? ' de ' + doMes.length : '') + ')' : '')),
        h('div', { class: 'chips' },
          h('button', { class: 'chip' + (estado.soPendentes ? '' : ' on'), onclick: () => { estado.soPendentes = false; desenhar(); } }, 'Todos'),
          h('button', { class: 'chip' + (estado.soPendentes ? ' on' : ''), onclick: () => { estado.soPendentes = true; desenhar(); } }, 'Pendentes'))),
      h('div', { class: 'seg' },
        h('button', { class: estado.agrupar ? '' : 'on neutro', onclick: () => trocarVisao(false) }, 'Lista'),
        h('button', { class: estado.agrupar ? 'on neutro' : '', onclick: () => trocarVisao(true) }, 'Por categoria')),
      itens.length
        ? (estado.agrupar ? visaoCategorias(itens) : h('div', { class: 'lista' }, itens.map(linhaItem)))
        : h('div', { class: 'lista' }, h('div', { class: 'vazio' },
          doMes.length ? 'Nenhum lançamento com esse filtro.' : 'Nada lançado neste mês.\nToque no + para começar.')),

      h('button', { class: 'fab', 'aria-label': 'Novo lançamento', onclick: () => abrirFormulario(null) }, '+'),
      barraInferior()
    ].filter(Boolean)); // tira os "false"/"null" dos avisos que não se aplicam
  }

  async function trocarVisao(agrupar) {
    estado.agrupar = agrupar;
    await DB.salvarConfig('visao', agrupar ? 'categorias' : 'lista');
    estado.cfg.visao = agrupar ? 'categorias' : 'lista';
    desenhar();
  }

  // despesas agrupadas por categoria (toque abre) + receitas num grupo só
  function visaoCategorias(itens) {
    estado.abertas = estado.abertas || new Set();
    const despesas = itens.filter((l) => l.tipo === 'despesa');
    const receitas = itens.filter((l) => l.tipo === 'receita');
    const totalDes = despesas.reduce((s, l) => s + l.valor, 0) || 1;
    const grupos = L.agruparPorCategoria(despesas).map((g) => Object.assign(g, { chave: 'd:' + g.id, sinal: '−' }));
    if (receitas.length) {
      grupos.push({ chave: 'receitas', nome: 'Receitas', cor: '#6fc7a1', itens: receitas, total: receitas.reduce((s, l) => s + l.valor, 0),
        pendentes: receitas.filter((l) => l.status === 'pendente').length, sinal: '+' });
    }
    return h('div', { class: 'grupos' }, grupos.map((g) => {
      const aberto = estado.abertas.has(g.chave);
      const pct = g.sinal === '−' ? Math.round((g.total / totalDes) * 100) : null;
      return h('div', { class: 'grupo' },
        h('button', { class: 'grupo-cab', 'aria-expanded': String(aberto), onclick: () => { aberto ? estado.abertas.delete(g.chave) : estado.abertas.add(g.chave); desenhar(); } },
          h('span', { class: 'ponto', style: 'background:' + g.cor }),
          h('span', { class: 'grupo-meio' },
            h('span', { class: 'grupo-nome' }, g.nome),
            h('span', { class: 'sub' }, g.itens.length + (g.itens.length === 1 ? ' item' : ' itens') + (g.pendentes ? ' · ' + g.pendentes + ' pendente' + (g.pendentes === 1 ? '' : 's') : ' · tudo pago')),
            pct != null && h('span', { class: 'barra' }, h('span', { style: 'width:' + Math.max(pct, 2) + '%;background:' + g.cor }))),
          h('span', { class: 'grupo-val' }, L.formatBRL(g.total), pct != null && h('span', { class: 'sub' }, pct + '%')),
          h('span', { class: 'seta' }, aberto ? '▾' : '▸')),
        aberto && h('div', { class: 'grupo-corpo' },
          g.itens.map(linhaItem),
          g.pendentes > 0 && h('button', { class: 'pagar-tudo', onclick: () => pagarTudo(g.itens) },
            (g.sinal === '+' ? 'Marcar tudo como recebido' : 'Marcar tudo como pago') + ' (' + g.pendentes + ')')));
    }));
  }

  // ---------- balanço do mês: gráfico redondo ----------
  function svgEl(tag, attrs, txt) {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    if (txt != null) e.textContent = txt;
    return e;
  }

  // anel dividido em receitas (verde) e despesas (vermelho), proporcional ao valor previsto do mês.
  // tom claro = ainda pendente, tom cheio = já pago/recebido
  function donutSVG(c) {
    const R = 42, C = 2 * Math.PI * R;
    const svg = svgEl('svg', { viewBox: '0 0 120 120', role: 'img', 'aria-label': 'Receitas ' + c.pctRec + '% e despesas ' + c.pctDes + '% do mês' });
    svg.append(svgEl('circle', { cx: 60, cy: 60, r: R, fill: 'none', stroke: '#2c2c30', 'stroke-width': 12 }));
    const total = c.totalRec + c.totalDes;
    let acumulado = 0;
    [[c.recPago, '#6fc7a1', 1], [c.recPend, '#6fc7a1', 0.4], [c.desPago, '#e57373', 1], [c.desPend, '#e57373', 0.4]].forEach(([v, cor, op]) => {
      if (!v || !total) return;
      const len = (v / total) * C;
      svg.append(svgEl('circle', {
        cx: 60, cy: 60, r: R, fill: 'none', stroke: cor, 'stroke-opacity': op, 'stroke-width': 12,
        'stroke-dasharray': len + ' ' + (C - len), 'stroke-dashoffset': -acumulado, transform: 'rotate(-90 60 60)',
      }));
      acumulado += len;
    });
    return svg;
  }

  // o buraco do anel é pequeno: números mais longos usam fonte menor para não encostar no anel
  const tamanhoCentro = (txt) => (txt.length <= 10 ? 15 : txt.length <= 12 ? 13 : 11);

  function cartaoBalanco(c, rotuloBalanco, classeBalanco) {
    const itens = (n) => n + (n === 1 ? ' item' : ' itens');
    const vazio = c.nRec + c.nDes === 0;
    const linha = (cor, nome, n, valor, pct) => h('div', { class: 'leg' },
      h('span', { class: 'dot', style: 'background:' + cor }),
      h('div', {},
        h('div', { class: 'p' }, nome + ' · ' + itens(n)),
        h('div', { class: 'v2' }, L.formatBRL(valor) + (vazio ? '' : ' · ' + pct + '%'))));
    return h('div', { class: 'caixa balanco' },
      h('div', { class: 't' }, h('span', { class: 'bolinha', style: 'background:var(--azul)' }, '='), 'Balanço do mês'),
      h('div', { class: 'balanco-corpo' },
        h('div', { class: 'donut' },
          donutSVG(c),
          h('div', { class: 'centro' },
            h('div', { class: 'rot' }, 'Previsto'),
            h('div', { class: 'valc ' + classeBalanco(c.balancoPrevisto), style: 'font-size:' + tamanhoCentro(L.formatBRL(c.balancoPrevisto)) + 'px' }, L.formatBRL(c.balancoPrevisto)),
            h('div', { class: 'rot' }, vazio ? 'sem lançamentos' : rotuloBalanco(c.balancoPrevisto)))),
        h('div', { class: 'legenda' },
          linha('var(--verde)', 'Receitas', c.nRec, c.totalRec, c.pctRec),
          linha('var(--vermelho)', 'Despesas', c.nDes, c.totalDes, c.pctDes))),
      h('div', { class: 'realizado' },
        h('span', {}, 'Já realizado (pago/recebido)'),
        h('span', { class: classeBalanco(c.balancoConsolidado) }, L.formatBRL(c.balancoConsolidado))),
      !vazio && h('div', { class: 'p', style: 'margin-top:6px' }, 'Tom claro no gráfico = ainda pendente'));
  }

  // ---------- lembrete de backup ----------
  // os dados ficam só neste aparelho: depois de uns lançamentos, lembra de exportar (nunca feito ou há mais de 30 dias)
  function diasSemBackup() {
    const u = estado.cfg.ultimoBackup;
    if (!u) return null;
    return Math.floor((new Date(L.hojeISO() + 'T12:00:00') - new Date(u + 'T12:00:00')) / 86400000);
  }
  function avisoBackup() {
    const dias = diasSemBackup();
    const temDados = estado.lancs.length + estado.fixos.length >= 5;
    if (!temDados || (dias !== null && dias <= 30)) return null;
    return h('button', { class: 'aviso aviso-btn', onclick: abrirAjustes },
      dias === null ? 'Você ainda não fez backup dos seus dados. Toque aqui para fazer agora.'
        : 'Seu último backup foi há ' + dias + ' dias. Toque aqui para atualizar.');
  }

  // ---------- calculadora de juros compostos ----------
  const pct2 = (x) => x.toFixed(2).replace('.', ',') + '%';
  const tamanhoGrande = (txt) => (txt.length <= 13 ? 40 : txt.length <= 16 ? 32 : 26);

  function graficoJuros(r) {
    const W = 360, H = 200, topo0 = 18, base = 28;
    const pts = r.serie.slice(1);
    const max = Math.max(...pts.map((p) => p.total), 1);
    const y = (v) => topo0 + (1 - v / max) * (H - topo0 - base);
    const slot = W / pts.length, bw = Math.min(slot * 0.7, 28);
    const cada = Math.ceil(pts.length / 8); // no máximo ~8 rótulos no eixo
    const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'grafico', role: 'img', 'aria-label': 'Evolução do valor investido e dos juros' });
    svg.append(svgEl('line', { x1: 0, x2: W, y1: y(0), y2: y(0), stroke: '#555', 'stroke-width': 1 }));
    pts.forEach((p, i) => {
      const x = i * slot + (slot - bw) / 2;
      const inv = svgEl('rect', { x, y: y(p.investido), width: bw, height: Math.max(y(0) - y(p.investido), 0), fill: '#8ab4f8' });
      const jur = svgEl('rect', { x, y: y(p.total), width: bw, height: Math.max(y(p.investido) - y(p.total), 0), fill: '#6fc7a1' });
      inv.append(svgEl('title', {}, L.textoPrazo(p.mes) + ' · investido ' + L.formatBRL(p.investido)));
      jur.append(svgEl('title', {}, L.textoPrazo(p.mes) + ' · juros ' + L.formatBRL(p.juros)));
      svg.append(inv, jur);
      if (i % cada === 0 || i === pts.length - 1) {
        svg.append(svgEl('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 10, fill: '#9a9aa2' }, L.rotuloMeses(p.mes)));
      }
    });
    const ult = pts.length - 1, xu = ult * slot + (slot - bw) / 2;
    svg.append(svgEl('text', { x: xu + bw, y: y(pts[ult].total) - 5, 'text-anchor': 'end', 'font-size': 10, 'font-weight': 600, fill: '#ececee' }, 'R$ ' + L.compacto(pts[ult].total)));
    return svg;
  }

  function resultadoJuros(j) {
    const vazioZero = (t) => (String(t).trim() === '' ? 0 : L.parseValor(t));
    const inicial = vazioZero(j.inicial), aporte = vazioZero(j.aporte);
    const taxa = L.parsePercentual(j.taxa), prazo = parseInt(j.prazo, 10);
    const erro = (msg) => [h('div', { class: 'alerta neg-bg' }, msg)];
    if (inicial === null) return erro('Valor inicial inválido.');
    if (aporte === null) return erro('Aporte mensal inválido.');
    if (taxa === null || taxa < 0 || taxa > 1000) return erro('Informe a taxa entre 0% e 1000%.');
    if (!(prazo >= 1) || (j.prazoEm === 'anos' ? prazo > 100 : prazo > 1200)) return erro('Informe o prazo de 1 mês até 100 anos.');
    if (inicial + aporte === 0) return erro('Informe um valor inicial ou um aporte mensal.');

    const r = L.simularJuros({ inicial, aporte, taxa, taxaPor: j.taxaPor, prazo, prazoEm: j.prazoEm });
    if (!Number.isSafeInteger(r.final) || r.final > 1e15) return erro('Resultado grande demais para calcular. Reduza a taxa ou o prazo.');

    const txtFinal = L.formatBRL(r.final);
    return [
      h('div', { class: 'hero', style: 'padding-top:4px' },
        h('div', { class: 'rotulo' }, 'Valor final em ' + L.textoPrazo(r.n)),
        h('div', { class: 'grande pos', style: 'font-size:' + tamanhoGrande(txtFinal) + 'px' }, txtFinal),
        h('div', { class: 'prev' }, j.taxaPor === 'ano'
          ? 'Taxa equivalente: ' + pct2(r.taxaMensal * 100) + ' ao mês'
          : 'Taxa equivalente: ' + pct2(r.taxaAnual * 100) + ' ao ano')),
      h('div', { class: 'duplo' },
        h('div', { class: 'caixa' },
          h('div', { class: 't' }, h('span', { class: 'dot', style: 'background:#8ab4f8;margin-top:0' }), 'Total investido'),
          h('div', { class: 'v' }, L.formatBRL(r.investido))),
        h('div', { class: 'caixa' },
          h('div', { class: 't' }, h('span', { class: 'dot', style: 'background:var(--verde);margin-top:0' }), 'Juros ganhos'),
          h('div', { class: 'v pos' }, L.formatBRL(r.juros)),
          h('div', { class: 'p' }, Math.round(r.pctJuros) + '% do valor final'))),
      h('div', { class: 'caixa', style: 'margin-bottom:20px' },
        h('div', { class: 't', style: 'margin-bottom:6px' }, 'Evolução do patrimônio'),
        graficoJuros(r),
        h('div', { class: 'legenda-graf' },
          h('span', {}, h('span', { class: 'dot', style: 'background:#8ab4f8;display:inline-block;margin:0 6px 0 0' }), 'Investido'),
          h('span', {}, h('span', { class: 'dot', style: 'background:var(--verde);display:inline-block;margin:0 6px 0 0' }), 'Juros'))),
      h('h2', {}, 'Período a período'),
      h('div', { class: 'lista' }, r.serie.slice(1).map((p) => h('div', { class: 'item' },
        h('div', { class: 'meio' },
          h('div', { class: 'desc' }, L.textoPrazo(p.mes)),
          h('div', { class: 'sub' }, 'Investido ' + L.formatBRL(p.investido) + ' · Juros ' + L.formatBRL(p.juros))),
        h('div', { class: 'val' }, L.formatBRL(p.total))))),
    ];
  }

  function desenharJuros() {
    const j = estado.juros;
    const inInicial = h('input', { type: 'text', inputmode: 'decimal', value: j.inicial, placeholder: '0,00' });
    const inAporte = h('input', { type: 'text', inputmode: 'decimal', value: j.aporte, placeholder: '0,00' });
    const inTaxa = h('input', { type: 'text', inputmode: 'decimal', value: j.taxa, placeholder: 'Ex.: 10,5' });
    const inPrazo = h('input', { type: 'text', inputmode: 'numeric', value: j.prazo, placeholder: 'Ex.: 10' });
    const resultado = h('div');
    const btn = (txt, campo, valor) => h('button', { type: 'button', 'data-campo': campo, 'data-valor': valor, onclick: () => { j[campo] = valor; marcar(); atualizar(); } }, txt);
    const botoes = [btn('ao ano', 'taxaPor', 'ano'), btn('ao mês', 'taxaPor', 'mes'), btn('anos', 'prazoEm', 'anos'), btn('meses', 'prazoEm', 'meses')];
    function marcar() { botoes.forEach((b) => { b.className = j[b.dataset.campo] === b.dataset.valor ? 'on neutro' : ''; }); }
    let timer;
    function atualizar() {
      j.inicial = inInicial.value; j.aporte = inAporte.value; j.taxa = inTaxa.value; j.prazo = inPrazo.value;
      clearTimeout(timer);
      timer = setTimeout(() => DB.salvarConfig('juros', Object.assign({}, j)), 400); // lembra a última simulação
      resultado.replaceChildren(...resultadoJuros(j));
    }
    [inInicial, inAporte, inTaxa, inPrazo].forEach((i) => i.addEventListener('input', atualizar));
    marcar(); atualizar();

    document.getElementById('app').replaceChildren(
      h('div', { class: 'topo' }, h('div', { style: 'width:42px' }), h('div', { class: 'mes' }, 'Juros compostos'), h('div', { style: 'width:42px' })),
      h('div', { class: 'caixa', style: 'margin-bottom:16px' },
        h('label', { class: 'campo' }, 'Valor inicial (R$)', inInicial),
        h('label', { class: 'campo' }, 'Aporte mensal (R$)', inAporte),
        h('label', { class: 'campo' }, 'Taxa de juros (%)', inTaxa),
        h('div', { class: 'seg' }, botoes[0], botoes[1]),
        h('label', { class: 'campo' }, 'Prazo', inPrazo),
        h('div', { class: 'seg' }, botoes[2], botoes[3])),
      resultado,
      h('p', { class: 'nota', style: 'margin:10px 4px 0' }, 'Simulação com taxa constante e aporte no fim de cada mês. O resultado é bruto: não desconta imposto de renda, taxas nem inflação, e rentabilidade estimada não garante resultado futuro.'),
      barraInferior()
    );
  }

  function barraInferior() {
    const aba = (tela, icone, nome) => h('button', {
      class: 'aba' + (estado.tela === tela ? ' on' : ''),
      'aria-current': estado.tela === tela ? 'page' : null,
      onclick: () => { estado.tela = tela; desenhar(); window.scrollTo(0, 0); },
    }, h('span', { class: 'ic' }, icone), nome);
    return h('nav', { class: 'barra' }, aba('mes', '▦', 'Mês'), aba('previsao', '↗', 'Previsão'), aba('juros', '％', 'Juros'));
  }

  // ---------- previsão dos próximos 12 meses ----------
  function graficoSVG(serie) {
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs, txt) => {
      const e = document.createElementNS(NS, tag);
      Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
      if (txt != null) e.textContent = txt;
      return e;
    };
    const W = 360, H = 200, topo0 = 22, base = 30;
    const vals = serie.map((x) => x.saldo);
    const max = Math.max(0, ...vals), min = Math.min(0, ...vals);
    const span = (max - min) || 1;
    const y = (v) => topo0 + ((max - v) / span) * (H - topo0 - base);
    const y0 = y(0);
    const slot = W / serie.length, bw = slot * 0.62;

    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'grafico', role: 'img', 'aria-label': 'Saldo previsto no fim de cada mês' });
    svg.append(el('line', { x1: 0, x2: W, y1: y0, y2: y0, stroke: '#555', 'stroke-width': 1 }));
    serie.forEach((p, i) => {
      const yv = y(p.saldo), topo = Math.min(yv, y0), alt = Math.max(Math.abs(yv - y0), 1);
      const barra = el('rect', { x: i * slot + (slot - bw) / 2, y: topo, width: bw, height: alt, rx: 3, fill: p.saldo < 0 ? '#e57373' : '#6fc7a1' });
      barra.append(el('title', {}, L.MESES[p.mes - 1] + ': ' + L.formatBRL(p.saldo)));
      svg.append(barra);
      svg.append(el('text', { x: i * slot + slot / 2, y: p.saldo >= 0 ? topo - 4 : topo + alt + 10, 'text-anchor': 'middle', 'font-size': 9, fill: '#9a9aa2' }, L.compacto(p.saldo)));
      svg.append(el('text', { x: i * slot + slot / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': 10, fill: '#9a9aa2' }, L.MESES[p.mes - 1].slice(0, 3)));
    });
    return svg;
  }

  function desenharPrevisao() {
    const serie = L.previsao(estado.cfg, estado.lancs, estado.fixos, estado.excecoes, L.hojeISO().slice(0, 7), 12);
    const rp = L.resumoPrevisao(serie);
    const nomeMes = (p) => L.MESES[p.mes - 1] + '/' + String(p.ano).slice(2);

    document.getElementById('app').replaceChildren(
      h('div', { class: 'topo' }, h('div', { style: 'width:42px' }), h('div', { class: 'mes' }, 'Previsão'), h('div', { style: 'width:42px' })),

      rp.primeiroNegativo
        ? h('div', { class: 'alerta neg-bg' }, 'Atenção: o saldo previsto fica negativo em ' + nomeMes(rp.primeiroNegativo) + '. O ponto mais baixo é ' + L.formatBRL(rp.menor.saldo) + ' em ' + nomeMes(rp.menor) + '.')
        : h('div', { class: 'alerta pos-bg' }, 'Saldo previsto positivo nos próximos 12 meses. O ponto mais baixo é ' + L.formatBRL(rp.menor.saldo) + ' em ' + nomeMes(rp.menor) + '.'),

      h('div', { class: 'duplo' },
        h('div', { class: 'caixa' },
          h('div', { class: 't' }, 'Saldo em ' + nomeMes(rp.final)),
          h('div', { class: 'v ' + classeSinal(rp.final.saldo) }, L.formatBRL(rp.final.saldo))),
        h('div', { class: 'caixa' },
          h('div', { class: 't' }, 'Menor saldo'),
          h('div', { class: 'v ' + classeSinal(rp.menor.saldo) }, L.formatBRL(rp.menor.saldo)),
          h('div', { class: 'p' }, nomeMes(rp.menor)))),

      h('div', { class: 'caixa', style: 'margin-bottom:20px' },
        h('div', { class: 't', style: 'margin-bottom:6px' }, 'Saldo previsto no fim de cada mês (R$)'),
        graficoSVG(serie)),

      h('h2', {}, 'Mês a mês'),
      h('div', { class: 'lista' }, serie.map((p) => h('button', {
        class: 'item',
        onclick: () => { estado.ano = p.ano; estado.mes = p.mes; estado.tela = 'mes'; desenhar(); window.scrollTo(0, 0); },
      },
        h('div', { class: 'meio' },
          h('div', { class: 'desc' }, L.MESES[p.mes - 1] + ' ' + p.ano),
          h('div', { class: 'sub' }, 'Entra ' + L.formatBRL(p.receitas) + ' · Sai ' + L.formatBRL(p.despesas) + ' · Balanço ' + L.formatBRL(p.balanco))),
        h('div', { class: 'val ' + classeSinal(p.saldo) }, L.formatBRL(p.saldo))))),
      h('p', { class: 'nota', style: 'margin:10px 4px 0' }, 'Considera seus lançamentos, fixos e parcelas. Gastos que você ainda não lançou não entram. Toque num mês para abri-lo.'),
      barraInferior()
    );
  }

  function linhaItem(l) {
    const pago = l.status === 'pago';
    const sinal = l.tipo === 'receita' ? 1 : -1;
    return h('div', { class: 'item ' + (sinal > 0 ? 'rec' : 'des') + (pago ? '' : ' pendente'), role: 'button', tabindex: '0', onclick: () => (l.fixo ? abrirFormularioFixo(l) : l.grupoId ? abrirFormularioParcela(l) : abrirFormulario(l)) },
      h('button', {
        class: 'check' + (pago ? ' ok' : ''),
        'aria-label': pago ? 'Marcar como pendente' : 'Marcar como pago',
        onclick: (e) => { e.stopPropagation(); alternarPago(l); },
      }, pago ? '✓' : ''),
      h('div', { class: 'meio' },
        h('div', { class: 'desc' }, L.rotulo(l)),
        h('div', { class: 'sub' }, L.formatData(l.data) + (l.fixo ? ' · fixo' : '') + (l.categoria && !estado.agrupar ? ' · ' + L.categoriaDe(l.categoria).nome : '') + (pago ? '' : ' · pendente'))),
      h('div', { class: 'val ' + (sinal > 0 ? 'pos' : 'neg') }, (sinal > 0 ? '+' : '') + L.formatBRL(sinal * l.valor)));
  }

  // ---------- folha (bottom sheet) ----------
  function abrirFolha(conteudo) {
    const fundo = h('div', { class: 'fundo', onclick: (e) => { if (e.target === fundo) fundo.remove(); } },
      h('div', { class: 'folha' }, conteudo));
    document.body.append(fundo);
    return () => fundo.remove();
  }


  // ---------- categoria ----------
  function campoCategoria(inicial) {
    const sel = h('select', {}, h('option', { value: '' }, 'Sem categoria'),
      ...L.CATEGORIAS.map((c) => h('option', { value: c.id }, c.nome)));
    sel.value = inicial || '';
    const el = h('label', { class: 'campo' }, 'Categoria', sel);
    return { el, sel, valor: () => sel.value || null };
  }

  async function pagarTudo(itens) {
    for (const l of itens) {
      if (l.status !== 'pendente') continue;
      if (l.fixo) { const e = excDe(l.fixoId, l.mes); e.status = 'pago'; await DB.salvarExcecao(e); }
      else { const x = estado.lancs.find((y) => y.id === l.id); x.status = 'pago'; delete x.manualPendente; await DB.salvarLancamento(x); }
    }
    await recarregar();
  }

  // ---------- campo de valor com somador ----------
  // Botão "Somar" abre uma lista: vai adicionando valores soltos e usa o total no campo.
  function abrirSomador(inValor) {
    let itens = [];
    const atual = L.parseValor(inValor.value);
    if (atual > 0) itens.push(atual);
    const inNovo = h('input', { type: 'text', inputmode: 'decimal', class: 'valor-grande', placeholder: '0,00' });
    const lista = h('div', { class: 'soma-lista' });
    const totalEl = h('div', { class: 'soma-total' });
    const erro = h('div', { class: 'erro' });
    let fechar;
    function desenhar() {
      lista.replaceChildren(...itens.map((v, i) => h('div', { class: 'soma-item' },
        h('span', {}, L.formatBRL(v)),
        h('button', { type: 'button', 'aria-label': 'Remover', onclick: () => { itens.splice(i, 1); desenhar(); inNovo.focus(); } }, '×'))));
      const total = itens.reduce((a, b) => a + b, 0);
      totalEl.textContent = 'Total (' + itens.length + (itens.length === 1 ? ' valor' : ' valores') + '): ' + L.formatBRL(total);
    }
    function adicionar() {
      const v = L.parseValor(inNovo.value);
      if (!v || v <= 0) { if (inNovo.value.trim() !== '') erro.textContent = 'Valor inválido.'; return false; }
      erro.textContent = '';
      itens.push(v); inNovo.value = ''; desenhar(); inNovo.focus();
      return true;
    }
    inNovo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); adicionar(); } });
    function usar() {
      if (inNovo.value.trim() !== '' && !adicionar()) return; // não perde o que está digitado
      const total = itens.reduce((a, b) => a + b, 0);
      if (!(total > 0)) { erro.textContent = 'Adicione ao menos um valor.'; return; }
      inValor.value = L.valorParaInput(total);
      inValor.dispatchEvent(new Event('input', { bubbles: true }));
      fechar();
    }
    fechar = abrirFolha([
      h('h3', {}, 'Somar valores'),
      h('p', { class: 'nota' }, 'Digite cada valor e toque em Adicionar. No fim, o total vira o valor do lançamento.'),
      h('div', { class: 'soma-linha' }, inNovo, h('button', { type: 'button', class: 'primario', onclick: adicionar }, 'Adicionar')),
      lista, totalEl, erro,
      h('div', { class: 'acoes' }, h('button', { type: 'button', onclick: () => fechar() }, 'Cancelar'),
        h('button', { type: 'button', class: 'primario', onclick: usar }, 'Usar total')),
    ]);
    desenhar();
    setTimeout(() => inNovo.focus(), 50);
  }

  function campoValor(inValor) {
    return h('div', { class: 'campo' },
      h('div', { class: 'valor-topo' }, h('span', {}, 'Valor'),
        h('button', { type: 'button', class: 'somar', onclick: () => abrirSomador(inValor) }, '＋ Somar valores')),
      inValor);
  }

  // confirmação em dois toques, para ações que não têm desfazer
  function doisToques(btn, textoConfirma, acao) {
    if (btn.dataset.confirma !== '1') { btn.dataset.confirma = '1'; btn.dataset.original = btn.textContent; btn.textContent = textoConfirma; return; }
    acao();
  }

  // ---------- novo lançamento (única ou fixa) / editar avulso ----------
  function abrirFormulario(existente) {
    const hoje = L.hojeISO();
    const mesAtualVisivel = L.chaveMes(estado.ano, estado.mes) === hoje.slice(0, 7);
    let tipo = existente ? existente.tipo : 'despesa';
    let repet = 'unica';
    let tocouPago = !!existente;

    const inValor = h('input', { type: 'text', inputmode: 'decimal', class: 'valor-grande', placeholder: '0,00',
      value: existente ? L.valorParaInput(existente.valor) : '' });
    const inDesc = h('input', { type: 'text', value: existente ? existente.descricao : '' });
    const inData = h('input', { type: 'date', value: existente ? existente.data : (mesAtualVisivel ? hoje : L.chaveMes(estado.ano, estado.mes) + '-01') });
    const inPago = h('input', { type: 'checkbox' });
    inPago.checked = existente ? existente.status === 'pago' : L.statusPadrao(inData.value, hoje) === 'pago';
    const txtData = h('span', {}, 'Data');
    const catNovo = campoCategoria(existente && existente.categoria);
    const erro = h('div', { class: 'erro' });
    // parcelado
    let modoParcela = 'parcela';
    const inParcelas = h('input', { type: 'number', inputmode: 'numeric', min: '2', max: '120', value: '2' });
    const previa = h('p', { class: 'nota' });
    const btnDaParcela = h('button', { type: 'button', onclick: () => trocarModo('parcela') }, 'Valor da parcela');
    const btnDoTotal = h('button', { type: 'button', onclick: () => trocarModo('total') }, 'Valor total');
    const blocoParcelas = h('div', { style: 'display:none' },
      h('label', { class: 'campo' }, 'Número de parcelas', inParcelas),
      h('div', { class: 'seg' }, btnDaParcela, btnDoTotal),
      previa);
    const linhaPago = h('label', { class: 'linha' }, inPago, 'Já foi pago/recebido');
    function trocarModo(m) {
      modoParcela = m;
      btnDaParcela.className = m === 'parcela' ? 'on neutro' : '';
      btnDoTotal.className = m === 'total' ? 'on neutro' : '';
      atualizarPrevia();
    }
    function atualizarPrevia() {
      const v = L.parseValor(inValor.value), n = parseInt(inParcelas.value, 10);
      if (!v || !(n >= 2 && n <= 120) || !inData.value) { previa.textContent = ''; return; }
      const ps = L.gerarParcelas({ valor: v, data: inData.value, n, modo: modoParcela });
      const total = ps.reduce((s, x) => s + x.valor, 0);
      previa.textContent = n + ' parcelas de ' + L.formatBRL(ps[0].valor) + ' (total ' + L.formatBRL(total) + '), de '
        + L.formatData(ps[0].data) + ' a ' + L.formatData(ps[n - 1].data) + '/' + ps[n - 1].data.slice(2, 4);
    }
    [inValor, inParcelas, inData].forEach((i) => i.addEventListener('input', atualizarPrevia));
    inData.addEventListener('change', atualizarPrevia);

    inPago.addEventListener('change', () => { tocouPago = true; });
    inData.addEventListener('change', () => {
      if (!tocouPago && repet === 'unica' && inData.value) inPago.checked = L.statusPadrao(inData.value, hoje) === 'pago';
    });

    const btnRec = h('button', { type: 'button', onclick: () => trocarTipo('receita') }, 'Receita');
    const btnDes = h('button', { type: 'button', onclick: () => trocarTipo('despesa') }, 'Despesa');
    function trocarTipo(t) {
      tipo = t;
      btnRec.className = tipo === 'receita' ? 'on receita' : '';
      btnDes.className = tipo === 'despesa' ? 'on despesa' : '';
      inDesc.placeholder = tipo === 'receita' ? 'Ex.: Salário' : 'Ex.: Mercado';
      catNovo.el.style.display = tipo === 'despesa' ? '' : 'none';
    }
    trocarTipo(tipo);

    const btnUnica = h('button', { type: 'button', onclick: () => trocarRepet('unica') }, 'Única');
    const btnFixa = h('button', { type: 'button', onclick: () => trocarRepet('fixa') }, 'Fixa');
    const btnParc = h('button', { type: 'button', onclick: () => trocarRepet('parcelada') }, 'Parcelada');
    function trocarRepet(r) {
      repet = r;
      btnUnica.className = r === 'unica' ? 'on neutro' : '';
      btnFixa.className = r === 'fixa' ? 'on neutro' : '';
      btnParc.className = r === 'parcelada' ? 'on neutro' : '';
      blocoParcelas.style.display = r === 'parcelada' ? '' : 'none';
      linhaPago.style.display = r === 'parcelada' ? 'none' : ''; // parcelas seguem a data: passada = paga, futura = pendente
      txtData.textContent = r === 'fixa' ? 'Primeiro vencimento (repete todo mês até você excluir)'
        : r === 'parcelada' ? 'Data da primeira parcela (as outras seguem mês a mês)' : 'Data';
      // fixo começa pendente: valor e data podem variar, você confirma quando pagar
      if (!tocouPago) inPago.checked = r === 'fixa' ? false : L.statusPadrao(inData.value, hoje) === 'pago';
      if (r === 'parcelada') { trocarModo(modoParcela); atualizarPrevia(); }
    }
    trocarRepet('unica');
    trocarModo('parcela');

    let fechar;
    async function salvar() {
      const valor = L.parseValor(inValor.value);
      if (!valor || valor <= 0) { erro.textContent = 'Informe um valor maior que zero.'; return; }
      if (!inData.value) { erro.textContent = 'Informe a data.'; return; }
      const descricao = inDesc.value.trim() || (tipo === 'receita' ? 'Receita' : 'Despesa');
      const categoria = tipo === 'despesa' ? catNovo.valor() : null;

      if (!existente && repet === 'parcelada') {
        const n = parseInt(inParcelas.value, 10);
        if (!(n >= 2 && n <= 120)) { erro.textContent = 'Informe de 2 a 120 parcelas.'; return; }
        const ps = L.gerarParcelas({ valor, data: inData.value, n, modo: modoParcela });
        if (ps.some((p) => p.valor <= 0)) { erro.textContent = 'O valor total é pequeno demais para esse número de parcelas.'; return; }
        const grupoId = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2);
        for (const p of ps) {
          await DB.salvarLancamento({ tipo, valor: p.valor, descricao, data: p.data, status: L.statusPadrao(p.data, hoje), grupoId, parcela: p.parcela, parcelaTotal: n, categoria: categoria });
        }
        fechar();
        estado.ano = +inData.value.slice(0, 4); estado.mes = +inData.value.slice(5, 7);
        await recarregar();
        return;
      }

      if (!existente && repet === 'fixa') {
        const inicio = inData.value.slice(0, 7);
        const f = await DB.salvarFixo({ tipo, valor, descricao, dia: +inData.value.slice(8, 10), inicio, fim: null, categoria });
        // 1º vencimento que já chegou e foi deixado como pendente: fica pendente de propósito, não paga sozinho
        if (inPago.checked || inData.value <= hoje) await DB.salvarExcecao({ id: excId(f.id, inicio), fixoId: f.id, mes: inicio, status: inPago.checked ? 'pago' : 'pendente' });
        fechar();
        estado.ano = +inicio.slice(0, 4); estado.mes = +inicio.slice(5, 7);
        await recarregar();
        return;
      }

      const l = existente || {};
      Object.assign(l, { tipo, valor, descricao, data: inData.value, status: inPago.checked ? 'pago' : 'pendente', categoria });
      if (!inPago.checked && inData.value <= hoje) l.manualPendente = true; else delete l.manualPendente;
      await DB.salvarLancamento(l);
      fechar();
      estado.ano = +l.data.slice(0, 4); estado.mes = +l.data.slice(5, 7);
      await recarregar();
    }

    const btnExcluir = existente && h('button', { type: 'button', class: 'perigo', onclick: (e) =>
      doisToques(e.currentTarget, 'Toque de novo para excluir', async () => { await DB.excluirLancamento(existente.id); fechar(); await recarregar(); }) }, 'Excluir');

    fechar = abrirFolha([
      h('h3', {}, existente ? 'Editar lançamento' : 'Novo lançamento'),
      h('div', { class: 'seg' }, btnRec, btnDes),
      !existente && h('div', { class: 'seg tres' }, btnUnica, btnFixa, btnParc),
      campoValor(inValor),
      h('label', { class: 'campo' }, 'Descrição', inDesc),
      catNovo.el,
      h('label', { class: 'campo' }, txtData, inData),
      blocoParcelas,
      linhaPago,
      erro,
      h('div', { class: 'acoes' }, btnExcluir, h('button', { type: 'button', class: 'primario', onclick: salvar }, 'Salvar')),
    ]);
    if (!existente) setTimeout(() => inValor.focus(), 50);
  }

  // ---------- editar / excluir uma parcela ----------
  function abrirFormularioParcela(l) {
    const grupo = estado.lancs.filter((x) => x.grupoId === l.grupoId);
    const inValor = h('input', { type: 'text', inputmode: 'decimal', class: 'valor-grande', value: L.valorParaInput(l.valor) });
    const inDesc = h('input', { type: 'text', value: l.descricao });
    const inData = h('input', { type: 'date', value: l.data });
    const inPago = h('input', { type: 'checkbox' });
    inPago.checked = l.status === 'pago';
    const catP = campoCategoria(l.categoria);
    const erro = h('div', { class: 'erro' });
    const zona = h('div');
    let fechar;

    function lerCampos() {
      const valor = L.parseValor(inValor.value);
      if (!valor || valor <= 0) { erro.textContent = 'Informe um valor maior que zero.'; return null; }
      if (!inData.value) { erro.textContent = 'Informe a data.'; return null; }
      erro.textContent = '';
      return { valor, descricao: inDesc.value.trim() || l.descricao, data: inData.value, status: inPago.checked ? 'pago' : 'pendente', categoria: catP.valor() };
    }

    async function aplicar(escopo) {
      const c = lerCampos();
      if (!c) { mostrar('botoes'); return; }
      const alvo = estado.lancs.find((x) => x.id === l.id);
      alvo.data = c.data; alvo.status = c.status; // data e "pago" valem só para esta parcela
      alvo.valor = c.valor; alvo.descricao = c.descricao; alvo.categoria = c.categoria;
      if (c.status === 'pendente' && c.data <= L.hojeISO()) alvo.manualPendente = true; else delete alvo.manualPendente;
      await DB.salvarLancamento(alvo);
      if (escopo === 'seguintes') {
        for (const x of grupo.filter((g) => g.parcela > l.parcela)) {
          x.valor = c.valor; x.descricao = c.descricao; x.categoria = c.categoria;
          await DB.salvarLancamento(x);
        }
      }
      fechar(); await recarregar();
    }

    async function salvar() {
      const c = lerCampos();
      if (!c) return;
      if (c.valor === l.valor && c.descricao === l.descricao && c.categoria === (l.categoria || null)) await aplicar('esta');
      else if (grupo.some((g) => g.parcela > l.parcela)) mostrar('escopo');
      else await aplicar('esta');
    }

    async function excluir(escopo) {
      if (escopo === 'esta') {
        await DB.excluirLancamento(l.id);
      } else {
        const apagar = grupo.filter((g) => g.parcela >= l.parcela);
        for (const g of apagar) await DB.excluirLancamento(g.id);
        // as que sobram passam a ser "x de (parcela-1)"
        for (const g of grupo.filter((x) => x.parcela < l.parcela)) { g.parcelaTotal = l.parcela - 1; await DB.salvarLancamento(g); }
      }
      fechar(); await recarregar();
    }

    function mostrar(modo) {
      if (modo === 'escopo') {
        zona.replaceChildren(
          h('p', { class: 'nota' }, 'Aplicar valor e descrição a quais parcelas?'),
          h('div', { class: 'acoes' },
            h('button', { type: 'button', onclick: () => aplicar('esta') }, 'Só esta'),
            h('button', { type: 'button', class: 'primario', onclick: () => aplicar('seguintes') }, 'Esta e as seguintes')),
          h('div', { class: 'acoes', style: 'margin-top:8px' }, h('button', { type: 'button', onclick: () => mostrar('botoes') }, 'Voltar')));
      } else {
        const temSeguintes = grupo.some((g) => g.parcela > l.parcela);
        zona.replaceChildren(
          h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'primario', onclick: salvar }, 'Salvar')),
          h('div', { class: 'acoes', style: 'margin-top:8px' },
            h('button', { type: 'button', class: 'perigo', onclick: (e) => doisToques(e.currentTarget, 'Toque de novo', () => excluir('esta')) }, 'Excluir esta'),
            temSeguintes && h('button', { type: 'button', class: 'perigo', onclick: (e) => doisToques(e.currentTarget, 'Toque de novo', () => excluir('seguintes')) }, 'Excluir esta e seguintes')));
      }
    }
    mostrar('botoes');

    fechar = abrirFolha([
      h('h3', {}, 'Parcela ' + l.parcela + ' de ' + l.parcelaTotal),
      campoValor(inValor),
      h('label', { class: 'campo' }, 'Descrição', inDesc),
      catP.el,
      h('label', { class: 'campo' }, 'Data', inData),
      h('label', { class: 'linha' }, inPago, 'Já foi pago/recebido'),
      erro,
      zona,
    ]);
  }

  // ---------- editar uma ocorrência de fixo ----------
  function abrirFormularioFixo(l) {
    const f = estado.fixos.find((x) => x.id === l.fixoId);
    if (!f) return;
    const inValor = h('input', { type: 'text', inputmode: 'decimal', class: 'valor-grande', value: L.valorParaInput(l.valor) });
    const inDesc = h('input', { type: 'text', value: l.descricao });
    const inPago = h('input', { type: 'checkbox' });
    inPago.checked = l.status === 'pago';
    const catF = campoCategoria(f.categoria);
    const erro = h('div', { class: 'erro' });
    const zona = h('div');
    const nomeMes = L.MESES[+l.mes.slice(5, 7) - 1];
    let fechar;

    function lerCampos() {
      const valor = L.parseValor(inValor.value);
      if (!valor || valor <= 0) { erro.textContent = 'Informe um valor maior que zero.'; return null; }
      erro.textContent = '';
      return { valor, descricao: inDesc.value.trim() || f.descricao, status: inPago.checked ? 'pago' : 'pendente' };
    }

    async function salvar() {
      const c = lerCampos();
      if (!c) return;
      if (catF.valor() !== (f.categoria || null)) { f.categoria = catF.valor(); await DB.salvarFixo(f); } // categoria vale para o fixo todo
      if (c.valor === l.valor && c.descricao === l.descricao) { // só mudou o "pago"
        const e = excDe(f.id, l.mes);
        e.status = c.status;
        await DB.salvarExcecao(e);
        fechar(); await recarregar();
      } else {
        mostrar('escopo');
      }
    }

    async function aplicar(escopo) {
      const c = lerCampos();
      if (!c) { mostrar('botoes'); return; }
      if (escopo === 'mes') {
        const e = excDe(f.id, l.mes);
        e.valor = c.valor !== f.valor ? c.valor : null;
        e.descricao = c.descricao !== f.descricao ? c.descricao : null;
        e.status = c.status;
        await DB.salvarExcecao(e);
      } else {
        await aplicarDaquiPraFrente(f, l.mes, c);
      }
      fechar(); await recarregar();
    }

    async function pular() {
      const e = excDe(f.id, l.mes);
      e.pulado = true;
      await DB.salvarExcecao(e);
      fechar(); await recarregar();
    }

    async function encerrar() {
      const pago = l.status === 'pago'; // ocorrência já paga não some: o fixo termina neste mês
      const ultimoMes = pago ? l.mes : L.chaveAnterior(l.mes);
      const doFixo = estado.excecoes.filter((e) => e.fixoId === f.id);
      if (ultimoMes < f.inicio) {
        for (const e of doFixo) await DB.excluirExcecao(e.id);
        await DB.excluirFixo(f.id);
      } else {
        for (const e of doFixo) if (pago ? e.mes > l.mes : e.mes >= l.mes) await DB.excluirExcecao(e.id);
        f.fim = ultimoMes;
        await DB.salvarFixo(f);
      }
      fechar(); await recarregar();
    }

    function mostrar(modo) {
      if (modo === 'escopo') {
        zona.replaceChildren(
          h('p', { class: 'nota' }, 'Aplicar a qual(is) mês(es)?'),
          h('div', { class: 'acoes' },
            h('button', { type: 'button', onclick: () => aplicar('mes') }, 'Só este mês'),
            h('button', { type: 'button', class: 'primario', onclick: () => aplicar('adiante') }, 'Este e os próximos')),
          h('div', { class: 'acoes', style: 'margin-top:8px' }, h('button', { type: 'button', onclick: () => mostrar('botoes') }, 'Voltar')));
      } else {
        zona.replaceChildren(
          h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'primario', onclick: salvar }, 'Salvar')),
          h('div', { class: 'acoes', style: 'margin-top:8px' },
            h('button', { type: 'button', class: 'perigo', onclick: (e) => doisToques(e.currentTarget, 'Toque de novo', pular) }, 'Pular este mês'),
            h('button', { type: 'button', class: 'perigo', onclick: (e) => doisToques(e.currentTarget, 'Toque de novo', encerrar) },
              l.status === 'pago' ? 'Encerrar após este mês' : 'Encerrar a partir deste mês')));
      }
    }
    mostrar('botoes');

    fechar = abrirFolha([
      h('h3', {}, 'Fixo · ' + nomeMes),
      campoValor(inValor),
      h('label', { class: 'campo' }, 'Descrição', inDesc),
      l.tipo === 'despesa' && catF.el,
      h('label', { class: 'linha' }, inPago, 'Já foi pago/recebido'),
      erro,
      zona,
    ]);
  }

  // "este e os próximos": o fixo antigo termina no mês anterior e um novo começa neste mês
  async function aplicarDaquiPraFrente(f, chave, c) {
    const futuras = estado.excecoes.filter((e) => e.fixoId === f.id && e.mes >= chave);
    let alvo;
    if (chave === f.inicio) { // é o primeiro mês: basta alterar o próprio fixo
      f.valor = c.valor; f.descricao = c.descricao;
      alvo = await DB.salvarFixo(f);
    } else {
      const fimOriginal = f.fim;
      f.fim = L.chaveAnterior(chave);
      await DB.salvarFixo(f);
      alvo = await DB.salvarFixo({ tipo: f.tipo, valor: c.valor, descricao: c.descricao, dia: f.dia, inicio: chave, fim: fimOriginal, categoria: f.categoria || null });
      for (const e of futuras) { // pagos/pulados dos meses seguintes acompanham o fixo novo
        await DB.excluirExcecao(e.id);
        await DB.salvarExcecao(Object.assign({}, e, { id: excId(alvo.id, e.mes), fixoId: alvo.id }));
      }
    }
    // neste mês vale o valor novo, sem sobras de ajustes antigos
    await DB.salvarExcecao({ id: excId(alvo.id, chave), fixoId: alvo.id, mes: chave, status: c.status });
  }

  // ---------- atualizar o app ----------
  // Apaga só os arquivos guardados do app (cache) e o service worker; o banco com os lançamentos não é tocado.
  const VERSAO_APP = '4';
  async function atualizarApp(btn) {
    btn.textContent = 'Atualizando…'; btn.disabled = true;
    try {
      if (!navigator.onLine) throw new Error('offline');
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) await r.unregister();
      }
      if (self.caches) for (const k of await caches.keys()) await caches.delete(k);
      location.reload();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Sem internet. Tente de novo';
    }
  }

  // ---------- ajustes ----------
  function abrirAjustes() {
    const inSaldo = h('input', { type: 'text', inputmode: 'decimal', value: L.valorParaInput(estado.cfg.saldoInicial), placeholder: '0,00' });
    const erro = h('div', { class: 'erro' });
    const caixaBackup = h('textarea', { placeholder: 'Para restaurar, cole aqui o backup e toque em Importar.' });
    const textoUltimoBackup = () => (estado.cfg.ultimoBackup ? 'Último backup: ' + estado.cfg.ultimoBackup.split('-').reverse().join('/') : 'Você ainda não fez nenhum backup.');
    const ultimo = h('p', { class: 'nota', style: 'font-weight:600' }, textoUltimoBackup());
    let fechar;

    async function salvarSaldo() {
      const v = L.parseValor(inSaldo.value);
      if (v == null) { erro.textContent = 'Valor inválido.'; return; }
      const neg = /^\s*-/.test(inSaldo.value); // aceita saldo negativo se digitar com "-"
      await DB.salvarConfig('saldoInicial', neg ? -v : v);
      await DB.salvarConfig('saldoDefinido', true);
      fechar();
      await recarregar();
    }

    async function exportar() {
      const json = await DB.exportar();
      caixaBackup.value = json;
      await DB.salvarConfig('ultimoBackup', L.hojeISO());
      estado.cfg.ultimoBackup = L.hojeISO();
      ultimo.textContent = textoUltimoBackup();
      desenhar();
      try {
        const a = h('a', { href: URL.createObjectURL(new Blob([json], { type: 'application/json' })), download: 'meu-caixa-backup-' + L.hojeISO() + '.json' });
        document.body.append(a); a.click(); a.remove();
      } catch (e) { /* alguns ambientes bloqueiam download; o texto fica na caixa para copiar */ }
      try { await navigator.clipboard.writeText(json); erro.textContent = 'Backup gerado e copiado.'; } catch (e) { erro.textContent = 'Backup gerado na caixa abaixo: copie o texto.'; }
    }

    async function importar(btn) {
      if (btn.dataset.confirma !== '1') { btn.dataset.confirma = '1'; btn.textContent = 'Substitui tudo. Toque de novo'; return; }
      try { await DB.importar(caixaBackup.value); fechar(); await recarregar(); }
      catch (e) { erro.textContent = 'Não consegui importar: ' + e.message; btn.dataset.confirma = ''; btn.textContent = 'Importar'; }
    }

    fechar = abrirFolha([
      h('h3', {}, 'Ajustes'),
      h('label', { class: 'campo' }, 'Saldo inicial (quanto você tem hoje, somando tudo)', inSaldo),
      h('p', { class: 'nota' }, 'É o ponto de partida. Os lançamentos pagos somam ou subtraem a partir dele.'),
      erro,
      h('div', { class: 'acoes' }, h('button', { type: 'button', class: 'primario', onclick: salvarSaldo }, 'Salvar saldo')),
      h('div', { class: 'sep' }),
      h('h3', {}, 'Backup'),
      h('p', { class: 'nota' }, 'Seus dados ficam só neste aparelho. Faça backup de vez em quando.'),
      ultimo,
      caixaBackup,
      h('div', { class: 'acoes', style: 'margin-top:10px' },
        h('button', { type: 'button', onclick: exportar }, 'Exportar'),
        h('button', { type: 'button', onclick: (e) => importar(e.currentTarget) }, 'Importar')),
      h('div', { class: 'sep' }),
      h('h3', {}, 'Atualizar o aplicativo'),
      h('p', { class: 'nota' }, 'Baixa a versão mais recente (precisa de internet). Seus lançamentos não são apagados.'),
      h('div', { class: 'acoes' }, h('button', { type: 'button', onclick: (e) => atualizarApp(e.currentTarget) }, 'Atualizar agora')),
      h('p', { class: 'nota' }, 'Versão instalada: ' + VERSAO_APP),
    ]);
  }

  // ---------- início ----------
  (async function iniciar() {
    const r = await DB.init();
    estado.persistente = r.persistente;
    await recarregar();
    if (!estado.cfg.saldoDefinido) abrirAjustes();
  })();
})();
