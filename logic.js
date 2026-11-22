/* Lógica pura do Meu Caixa (sem DOM, sem banco). Valores sempre em CENTAVOS (inteiros). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  const pad = (n) => String(n).padStart(2, '0');

  // receita soma, despesa subtrai
  const sinal = (l) => (l.tipo === 'receita' ? 1 : -1) * l.valor;

  // "YYYY-MM-DD" no fuso local
  function hojeISO(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // mes de 1 a 12
  const chaveMes = (ano, mes) => ano + '-' + pad(mes);
  const ultimoDia = (ano, mes) => chaveMes(ano, mes) + '-' + pad(new Date(ano, mes, 0).getDate());

  // data passada ou de hoje entra como "pago"; futura entra como "pendente"
  const statusPadrao = (data, hoje) => (data <= hoje ? 'pago' : 'pendente');

  const soma = (arr) => arr.reduce((s, l) => s + sinal(l), 0);

  // saldo de verdade: inicial + tudo que já foi pago
  function saldoAtual(cfg, lancs) {
    return cfg.saldoInicial + soma(lancs.filter((l) => l.status === 'pago'));
  }

  // saldo previsto no fim do mês: inicial + tudo (pago e pendente) até o último dia do mês
  function saldoPrevistoFimMes(cfg, lancs, ano, mes) {
    const fim = ultimoDia(ano, mes);
    return cfg.saldoInicial + soma(lancs.filter((l) => l.data <= fim));
  }

  function doMes(lancs, ano, mes) {
    const p = chaveMes(ano, mes) + '-';
    return lancs
      .filter((l) => l.data.startsWith(p))
      .sort((a, b) => b.data.localeCompare(a.data) || (b.criadoEm || 0) - (a.criadoEm || 0));
  }

  // totais do mês: "pago" = consolidado, "previsto" = pago + pendente
  function resumoMes(lancs, ano, mes) {
    const m = doMes(lancs, ano, mes);
    const tot = (tipo, soSoPagos) =>
      m.filter((l) => l.tipo === tipo && (!soSoPagos || l.status === 'pago')).reduce((s, l) => s + l.valor, 0);
    return {
      receitaPaga: tot('receita', true),
      receitaPrevista: tot('receita', false),
      despesaPaga: tot('despesa', true),
      despesaPrevista: tot('despesa', false),
    };
  }

  // balanço do mês = receitas - despesas (só deste mês, sem o saldo que vem de meses anteriores)
  const balancoMes = (r) => ({ consolidado: r.receitaPaga - r.despesaPaga, previsto: r.receitaPrevista - r.despesaPrevista });

  // ---------- juros compostos ----------
  // "12,5" ou "12.5" -> 12.5 ; inválido -> null
  function parsePercentual(txt) {
    let s = String(txt == null ? '' : txt).replace(/[^\d.,]/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  // "1 ano e 6 meses", "8 meses", "10 anos"
  function textoPrazo(meses) {
    const a = Math.floor(meses / 12), m = meses % 12;
    const pa = a + (a === 1 ? ' ano' : ' anos'), pm = m + (m === 1 ? ' mês' : ' meses');
    return a && m ? pa + ' e ' + pm : a ? pa : pm;
  }

  // rótulo curto de eixo: 6 -> "6m", 24 -> "2a", 18 -> "1a6m"
  const rotuloMeses = (m) => (m < 12 ? m + 'm' : Math.floor(m / 12) + 'a' + (m % 12 ? (m % 12) + 'm' : ''));

  // inicial e aporte em centavos; taxa em % (12.5 = 12,5%); taxaPor 'ano'|'mes'; prazoEm 'anos'|'meses'.
  // O aporte entra no fim de cada mês. Taxa anual vira a taxa mensal equivalente: (1+a)^(1/12) - 1.
  function simularJuros({ inicial, aporte, taxa, taxaPor, prazo, prazoEm }) {
    const n = prazoEm === 'anos' ? prazo * 12 : prazo;
    const i = taxaPor === 'ano' ? Math.pow(1 + taxa / 100, 1 / 12) - 1 : taxa / 100;
    const passo = n <= 24 ? 1 : 12; // até 2 anos mês a mês; depois um ponto por ano (e o último mês)
    let saldo = inicial, investido = inicial;
    const serie = [{ mes: 0, investido, juros: 0, total: inicial }];
    for (let m = 1; m <= n; m++) {
      saldo = saldo * (1 + i) + aporte;
      investido += aporte;
      if (m % passo === 0 || m === n) {
        serie.push({ mes: m, investido, total: Math.round(saldo), juros: Math.round(saldo) - investido });
      }
    }
    const final = Math.round(saldo);
    return {
      n, serie, final, investido, juros: final - investido,
      taxaMensal: i, taxaAnual: Math.pow(1 + i, 12) - 1,
      pctJuros: final > 0 ? ((final - investido) / final) * 100 : 0,
    };
  }

  // composição do mês para o gráfico redondo: totais pagos/pendentes, quantidade e % de receitas x despesas (sobre o previsto)
  function composicaoMes(itens) {
    const soma = (tipo, status) => itens.filter((l) => l.tipo === tipo && l.status === status).reduce((s, l) => s + l.valor, 0);
    const qtd = (tipo) => itens.filter((l) => l.tipo === tipo).length;
    const recPago = soma('receita', 'pago'), recPend = soma('receita', 'pendente');
    const desPago = soma('despesa', 'pago'), desPend = soma('despesa', 'pendente');
    const totalRec = recPago + recPend, totalDes = desPago + desPend, total = totalRec + totalDes;
    const pctRec = total ? Math.round((totalRec / total) * 100) : 0;
    return {
      recPago, recPend, desPago, desPend, totalRec, totalDes,
      nRec: qtd('receita'), nDes: qtd('despesa'),
      pctRec, pctDes: total ? 100 - pctRec : 0, // soma sempre 100
      balancoPrevisto: totalRec - totalDes, balancoConsolidado: recPago - desPago,
    };
  }

  // filtros da lista: tipo ('receita' | 'despesa' | null) e só pendentes
  const filtrar = (itens, tipo, soPendentes) =>
    itens.filter((l) => (!tipo || l.tipo === tipo) && (!soPendentes || l.status === 'pendente'));

  function formatBRL(centavos) {
    const neg = centavos < 0;
    const abs = Math.abs(centavos);
    const inteiro = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + 'R$ ' + inteiro + ',' + pad(abs % 100);
  }

  // "1.234,56" | "1234,56" | "12.50" | "R$ 10" -> centavos; inválido -> null
  function parseValor(texto) {
    let s = String(texto == null ? '' : texto).replace(/[^\d.,]/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (!/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
    const n = parseFloat(s);
    if (!isFinite(n)) return null;
    return Math.round(n * 100);
  }

  // centavos -> texto editável ("1234,56")
  const valorParaInput = (c) => (c < 0 ? '-' : '') + Math.floor(Math.abs(c) / 100) + ',' + pad(Math.abs(c) % 100);

  const formatData = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

  // ---------- fixos ----------
  // Um fixo é uma regra {id, tipo, valor, descricao, dia, inicio:'YYYY-MM', fim:'YYYY-MM'|null}.
  // As ocorrências mensais são calculadas na hora. Exceções ({id:'fixoId|YYYY-MM', valor?, descricao?, status?, pulado?})
  // guardam só o que mudou naquele mês.
  const chaveParaIdx = (c) => +c.slice(0, 4) * 12 + (+c.slice(5, 7) - 1);
  const idxParaChave = (i) => Math.floor(i / 12) + '-' + pad((i % 12) + 1);
  const chaveAnterior = (c) => idxParaChave(chaveParaIdx(c) - 1);
  const chaveProxima = (c) => idxParaChave(chaveParaIdx(c) + 1);

  // dia 31 em mês curto cai no último dia do mês
  function dataDoFixo(fixo, chave) {
    const ult = new Date(+chave.slice(0, 4), +chave.slice(5, 7), 0).getDate();
    return chave + '-' + pad(Math.min(fixo.dia, ult));
  }

  function expandirFixos(fixos, excecoes, ateChave) {
    const exc = {};
    (excecoes || []).forEach((e) => { exc[e.id] = e; });
    const ate = chaveParaIdx(ateChave);
    const out = [];
    fixos.forEach((f) => {
      const fim = f.fim ? Math.min(chaveParaIdx(f.fim), ate) : ate;
      for (let i = chaveParaIdx(f.inicio); i <= fim; i++) {
        const ch = idxParaChave(i);
        const e = exc[f.id + '|' + ch] || {};
        if (e.pulado) continue;
        out.push({
          id: 'fx|' + f.id + '|' + ch, fixo: true, fixoId: f.id, mes: ch, tipo: f.tipo,
          valor: e.valor != null ? e.valor : f.valor,
          descricao: e.descricao || f.descricao,
          data: dataDoFixo(f, ch),
          status: e.status || 'pendente',
          categoria: f.categoria || null,
          criadoEm: 0,
        });
      }
    });
    return out;
  }

  // ---------- parcelados ----------
  // modo 'parcela': valor é de cada parcela. modo 'total': divide o total e os centavos que sobram vão para as primeiras parcelas.
  function gerarParcelas({ valor, data, n, modo }) {
    const base = modo === 'total' ? Math.floor(valor / n) : valor;
    const resto = modo === 'total' ? valor - base * n : 0;
    const chave0 = chaveParaIdx(data.slice(0, 7));
    const dia = +data.slice(8, 10);
    const out = [];
    for (let i = 0; i < n; i++) {
      const ch = idxParaChave(chave0 + i);
      out.push({ parcela: i + 1, valor: base + (i < resto ? 1 : 0), data: dataDoFixo({ dia }, ch) });
    }
    return out;
  }

  // ---------- categorias (só despesas) ----------
  const CATEGORIAS = [
    { id: 'moradia', nome: 'Moradia', cor: '#7aa2f7' },
    { id: 'mercado', nome: 'Mercado', cor: '#e0af68' },
    { id: 'alimentacao', nome: 'Alimentação fora', cor: '#ff9e64' },
    { id: 'combustivel', nome: 'Combustível', cor: '#f7768e' },
    { id: 'carro', nome: 'Carro e transporte', cor: '#bb9af7' },
    { id: 'online', nome: 'Compras online', cor: '#73daca' },
    { id: 'saude', nome: 'Saúde', cor: '#9ece6a' },
    { id: 'educacao', nome: 'Educação', cor: '#7dcfff' },
    { id: 'lazer', nome: 'Lazer', cor: '#c792ea' },
    { id: 'outros', nome: 'Outros', cor: '#8b8b93' },
  ];
  const SEM_CATEGORIA = { id: '', nome: 'Sem categoria', cor: '#5a5a62' };
  const categoriaDe = (id) => CATEGORIAS.find((c) => c.id === id) || SEM_CATEGORIA;

  // agrupa por categoria; maior total primeiro, "Sem categoria" por último
  function agruparPorCategoria(itens) {
    const mapa = {};
    itens.forEach((l) => {
      const c = categoriaDe(l.categoria);
      const g = mapa[c.id] || (mapa[c.id] = { id: c.id, nome: c.nome, cor: c.cor, itens: [], total: 0, pendentes: 0 });
      g.itens.push(l); g.total += l.valor; if (l.status === 'pendente') g.pendentes++;
    });
    return Object.values(mapa).sort((a, b) => (a.id === '') - (b.id === '') || b.total - a.total);
  }

  // Itens pendentes cuja data já chegou: viram "pago" sozinhos. Só vale para datas depois de `desde`
  // (o dia em que o recurso foi ligado), para não mexer no que já estava pendente antes.
  // Respeita o que a pessoa desmarcou de propósito (manualPendente / status explícito na exceção).
  function vencidosPendentes(lancs, fixos, excecoes, hoje, desde) {
    const exc = {};
    (excecoes || []).forEach((e) => { exc[e.id] = e; });
    const outL = lancs.filter((l) => l.status === 'pendente' && !l.manualPendente && l.data > desde && l.data <= hoje);
    const outF = [];
    const ate = chaveParaIdx(hoje.slice(0, 7));
    fixos.forEach((f) => {
      const fim = f.fim ? Math.min(chaveParaIdx(f.fim), ate) : ate;
      for (let i = Math.max(chaveParaIdx(f.inicio), chaveParaIdx(desde.slice(0, 7))); i <= fim; i++) {
        const ch = idxParaChave(i);
        const e = exc[f.id + '|' + ch] || {};
        if (e.pulado || e.status) continue;
        const d = dataDoFixo(f, ch);
        if (d > desde && d <= hoje) outF.push({ fixoId: f.id, mes: ch });
      }
    });
    return { lancs: outL, fixos: outF };
  }

  const rotulo = (l) => (l.parcelaTotal ? l.descricao + ' (' + l.parcela + '/' + l.parcelaTotal + ')' : l.descricao);

  // ---------- previsão ----------
  // n meses a partir de chaveInicio: entradas/saídas previstas do mês, balanço e saldo previsto no fim do mês
  function previsao(cfg, lancs, fixos, excecoes, chaveInicio, n) {
    const ini = chaveParaIdx(chaveInicio);
    const todos = lancs.concat(expandirFixos(fixos, excecoes, idxParaChave(ini + n - 1)));
    const out = [];
    for (let i = 0; i < n; i++) {
      const chave = idxParaChave(ini + i);
      const ano = +chave.slice(0, 4), mes = +chave.slice(5, 7);
      const r = resumoMes(todos, ano, mes);
      out.push({
        chave, ano, mes,
        receitas: r.receitaPrevista, despesas: r.despesaPrevista,
        balanco: r.receitaPrevista - r.despesaPrevista,
        saldo: saldoPrevistoFimMes(cfg, todos, ano, mes),
      });
    }
    return out;
  }

  // menor saldo da série e primeiro mês em que o saldo fica negativo
  function resumoPrevisao(serie) {
    const menor = serie.reduce((m, x) => (x.saldo < m.saldo ? x : m), serie[0]);
    return { menor, primeiroNegativo: serie.find((x) => x.saldo < 0) || null, final: serie[serie.length - 1] };
  }

  // rótulo curto para gráfico: 3200 -> "3,2k"
  function compacto(centavos) {
    const v = centavos / 100, a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + 'M';
    if (a >= 1e4) return (v < 0 ? '-' : '') + Math.round(a / 1e3) + 'k'; // simétrico: -12,5k e +12,5k arredondam igual
    if (a >= 1e3) return (v / 1e3).toFixed(1).replace('.', ',') + 'k';
    return String(Math.round(v));
  }

  const todosLancamentos = (lancs, fixos, excecoes, ateChave) => lancs.concat(expandirFixos(fixos, excecoes, ateChave));

  return { CATEGORIAS, categoriaDe, agruparPorCategoria, vencidosPendentes, parsePercentual, textoPrazo, rotuloMeses, simularJuros, composicaoMes, previsao, resumoPrevisao, compacto, balancoMes, filtrar, gerarParcelas, rotulo, chaveParaIdx, idxParaChave, chaveAnterior, chaveProxima, dataDoFixo, expandirFixos, todosLancamentos, MESES, sinal, hojeISO, chaveMes, ultimoDia, statusPadrao, saldoAtual, saldoPrevistoFimMes, doMes, resumoMes, formatBRL, parseValor, valorParaInput, formatData };
});
