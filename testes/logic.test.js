const assert = require('assert');
const L = require('../logic.js');

const mk = (tipo, valor, data, status) => ({ tipo, valor, data, status, criadoEm: 1 });
const cfg = { saldoInicial: 100000 }; // R$ 1.000,00

// parse de valores
assert.strictEqual(L.parseValor('1.234,56'), 123456);
assert.strictEqual(L.parseValor('1234,5'), 123450);
assert.strictEqual(L.parseValor('12.50'), 1250);
assert.strictEqual(L.parseValor('1.234'), 123400);
assert.strictEqual(L.parseValor('R$ 10'), 1000);
assert.strictEqual(L.parseValor('0,01'), 1);
assert.strictEqual(L.parseValor(''), null);
assert.strictEqual(L.parseValor('abc'), null);

// formatação
assert.strictEqual(L.formatBRL(123456), 'R$ 1.234,56');
assert.strictEqual(L.formatBRL(-30919), '-R$ 309,19');
assert.strictEqual(L.formatBRL(5), 'R$ 0,05');
assert.strictEqual(L.formatBRL(0), 'R$ 0,00');
assert.strictEqual(L.formatBRL(100000000), 'R$ 1.000.000,00');
assert.strictEqual(L.valorParaInput(-5005), '-50,05');
assert.strictEqual(L.valorParaInput(123456), '1234,56');

// status padrão
assert.strictEqual(L.statusPadrao('2026-11-21', '2026-11-21'), 'pago');
assert.strictEqual(L.statusPadrao('2026-11-20', '2026-11-21'), 'pago');
assert.strictEqual(L.statusPadrao('2026-11-22', '2026-11-21'), 'pendente');

// datas
assert.strictEqual(L.ultimoDia(2026, 2), '2026-02-28');
assert.strictEqual(L.ultimoDia(2028, 2), '2028-02-29');
assert.strictEqual(L.ultimoDia(2026, 12), '2026-12-31');
assert.strictEqual(L.hojeISO(new Date(2026, 0, 5)), '2026-01-05');

// saldo: só pagos contam no atual; tudo até fim do mês conta no previsto
const lancs = [
  mk('receita', 300000, '2026-11-05', 'pago'),      // +3000 pago
  mk('despesa', 50000, '2026-11-10', 'pago'),       // -500 pago
  mk('despesa', 80000, '2026-11-25', 'pendente'),   // -800 pendente (nov)
  mk('receita', 200000, '2026-11-30', 'pendente'),  // +2000 pendente (nov)
  mk('despesa', 10000, '2026-12-03', 'pendente'),   // -100 (dez)
];
assert.strictEqual(L.saldoAtual(cfg, lancs), 100000 + 300000 - 50000);
assert.strictEqual(L.saldoPrevistoFimMes(cfg, lancs, 2026, 11), 100000 + 300000 - 50000 - 80000 + 200000);
assert.strictEqual(L.saldoPrevistoFimMes(cfg, lancs, 2026, 12), 100000 + 300000 - 50000 - 80000 + 200000 - 10000);
assert.strictEqual(L.saldoPrevistoFimMes(cfg, lancs, 2026, 10), 100000); // mês anterior aos lançamentos

// resumo do mês
const r = L.resumoMes(lancs, 2026, 11);
assert.deepStrictEqual(r, { receitaPaga: 300000, receitaPrevista: 500000, despesaPaga: 50000, despesaPrevista: 130000 });

// listagem do mês: só nov, mais recente primeiro
const m = L.doMes(lancs, 2026, 11);
assert.strictEqual(m.length, 4);
assert.strictEqual(m[0].data, '2026-11-30');

// sem lançamentos
assert.strictEqual(L.saldoAtual(cfg, []), 100000);

// saldo negativo
assert.strictEqual(L.saldoAtual({ saldoInicial: 0 }, [mk('despesa', 100, '2026-01-01', 'pago')]), -100);

console.log('OK: todos os testes passaram');

// ---------- fixos ----------
{
  const fx = (o) => Object.assign({ id: 'a', tipo: 'receita', valor: 100000, descricao: 'Salário', dia: 31, inicio: '2026-01', fim: null }, o);
  // dia 31 vira último dia do mês
  let o = L.expandirFixos([fx()], [], '2026-03');
  assert.deepStrictEqual(o.map((x) => x.data), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.ok(o.every((x) => x.status === 'pendente' && x.fixo));
  // ano bissexto
  assert.strictEqual(L.expandirFixos([fx({ inicio: '2028-02' })], [], '2028-02')[0].data, '2028-02-29');
  // virada de ano
  assert.strictEqual(L.expandirFixos([fx({ inicio: '2026-11' })], [], '2027-02').length, 4);
  // projeção de 12 meses
  assert.strictEqual(L.expandirFixos([fx()], [], '2026-12').length, 12);
  // fim respeitado (inclusivo)
  assert.strictEqual(L.expandirFixos([fx({ fim: '2026-02' })], [], '2026-12').length, 2);
  // não existe antes do início
  assert.strictEqual(L.expandirFixos([fx({ inicio: '2026-06' })], [], '2026-05').length, 0);
  // exceções: valor só neste mês, pago, pulado
  const exc = [
    { id: 'a|2026-02', valor: 120000, descricao: 'Salário + extra' },
    { id: 'a|2026-03', pulado: true },
    { id: 'a|2026-01', status: 'pago' },
  ];
  o = L.expandirFixos([fx()], exc, '2026-04');
  assert.strictEqual(o.length, 3); // março pulado
  assert.strictEqual(o[0].status, 'pago');
  assert.strictEqual(o[1].valor, 120000);
  assert.strictEqual(o[1].descricao, 'Salário + extra');
  assert.strictEqual(o[2].mes, '2026-04');
  // saldo: fixos entram no previsto; só os pagos no atual
  const todos = L.todosLancamentos([], [fx()], [{ id: 'a|2026-01', status: 'pago' }], '2026-03');
  assert.strictEqual(L.saldoAtual({ saldoInicial: 0 }, todos), 100000);
  assert.strictEqual(L.saldoPrevistoFimMes({ saldoInicial: 0 }, todos, 2026, 3), 300000);
  assert.strictEqual(L.saldoPrevistoFimMes({ saldoInicial: 0 }, todos, 2026, 1), 100000);
  // despesa fixa subtrai
  const d = L.todosLancamentos([], [fx({ tipo: 'despesa', valor: 50000 })], [], '2026-02');
  assert.strictEqual(L.saldoPrevistoFimMes({ saldoInicial: 0 }, d, 2026, 2), -100000);
  // helpers de chave
  assert.strictEqual(L.chaveAnterior('2026-01'), '2025-12');
  assert.strictEqual(L.chaveProxima('2026-12'), '2027-01');
  console.log('OK: testes dos fixos passaram');
}

// ---------- parcelados ----------
{
  // total dividido: soma exata, centavos que sobram nas primeiras
  let p = L.gerarParcelas({ valor: 100000, data: '2026-01-10', n: 3, modo: 'total' });
  assert.deepStrictEqual(p.map((x) => x.valor), [33334, 33333, 33333]);
  assert.strictEqual(p.reduce((s, x) => s + x.valor, 0), 100000);
  assert.deepStrictEqual(p.map((x) => x.data), ['2026-01-10', '2026-02-10', '2026-03-10']);
  assert.deepStrictEqual(p.map((x) => x.parcela), [1, 2, 3]);
  // divisão exata
  p = L.gerarParcelas({ valor: 150000, data: '2026-01-10', n: 10, modo: 'total' });
  assert.ok(p.every((x) => x.valor === 15000));
  // valor por parcela: não divide
  p = L.gerarParcelas({ valor: 15000, data: '2026-05-01', n: 4, modo: 'parcela' });
  assert.ok(p.every((x) => x.valor === 15000) && p.length === 4);
  // dia 31 e fevereiro; virada de ano
  p = L.gerarParcelas({ valor: 300, data: '2026-11-31'.replace('31', '30'), n: 4, modo: 'parcela' });
  assert.deepStrictEqual(p.map((x) => x.data), ['2026-11-30', '2026-12-30', '2027-01-30', '2027-02-28']);
  p = L.gerarParcelas({ valor: 300, data: '2026-01-31', n: 3, modo: 'parcela' });
  assert.deepStrictEqual(p.map((x) => x.data), ['2026-01-31', '2026-02-28', '2026-03-31']);
  // rótulo
  assert.strictEqual(L.rotulo({ descricao: 'Notebook', parcela: 3, parcelaTotal: 10 }), 'Notebook (3/10)');
  assert.strictEqual(L.rotulo({ descricao: 'Mercado' }), 'Mercado');
  console.log('OK: testes dos parcelados passaram');
}

// ---------- balanço e filtros ----------
{
  const mk2 = (tipo, valor, data, status) => ({ tipo, valor, data, status, criadoEm: 1 });
  const ls = [
    mk2('receita', 300000, '2026-11-05', 'pago'),
    mk2('despesa', 50000, '2026-11-10', 'pago'),
    mk2('despesa', 80000, '2026-11-25', 'pendente'),
    mk2('receita', 200000, '2026-11-30', 'pendente'),
  ];
  const b = L.balancoMes(L.resumoMes(ls, 2026, 11));
  assert.deepStrictEqual(b, { consolidado: 250000, previsto: 370000 });
  // negativo
  const b2 = L.balancoMes(L.resumoMes([mk2('despesa', 1000, '2026-11-01', 'pago')], 2026, 11));
  assert.deepStrictEqual(b2, { consolidado: -1000, previsto: -1000 });
  // mês vazio
  assert.deepStrictEqual(L.balancoMes(L.resumoMes([], 2026, 11)), { consolidado: 0, previsto: 0 });
  // filtros
  assert.strictEqual(L.filtrar(ls, 'receita', false).length, 2);
  assert.strictEqual(L.filtrar(ls, 'despesa', false).length, 2);
  assert.strictEqual(L.filtrar(ls, null, true).length, 2);
  assert.strictEqual(L.filtrar(ls, 'despesa', true).length, 1);
  assert.strictEqual(L.filtrar(ls, null, false).length, 4);
  console.log('OK: testes de balanço e filtros passaram');
}

// ---------- previsão ----------
{
  const cfg2 = { saldoInicial: 100000 }; // R$ 1.000
  const fixos2 = [
    { id: 'r', tipo: 'receita', valor: 200000, descricao: 'Salário', dia: 5, inicio: '2026-01', fim: null },
    { id: 'd', tipo: 'despesa', valor: 250000, descricao: 'Aluguel', dia: 10, inicio: '2026-01', fim: null },
  ];
  const s = L.previsao(cfg2, [], fixos2, [], '2026-11', 12);
  assert.strictEqual(s.length, 12);
  assert.strictEqual(s[0].chave, '2026-11');
  assert.strictEqual(s[11].chave, '2027-10');
  // cada mês: +2000 -2500 = -500; saldo parte de 1000 + acumulado desde jan/26 (fixos começam em 2026-01)
  // até nov/26 são 11 meses de -500 => 1000 - 5500 = -4500
  assert.strictEqual(s[0].saldo, 100000 - 11 * 50000);
  assert.strictEqual(s[0].receitas, 200000);
  assert.strictEqual(s[0].despesas, 250000);
  assert.strictEqual(s[0].balanco, -50000);
  assert.strictEqual(s[11].saldo, 100000 - 22 * 50000);
  // saldo decresce linearmente
  for (let i = 1; i < 12; i++) assert.strictEqual(s[i - 1].saldo - s[i].saldo, 50000);
  const rp = L.resumoPrevisao(s);
  assert.strictEqual(rp.menor.chave, '2027-10');
  assert.strictEqual(rp.primeiroNegativo.chave, '2026-11');
  assert.strictEqual(rp.final.chave, '2027-10');

  // cenário positivo: sem negativo
  const s2 = L.previsao({ saldoInicial: 0 }, [mk('receita', 1000, '2026-11-05', 'pago')], [], [], '2026-11', 3);
  assert.ok(L.resumoPrevisao(s2).primeiroNegativo === null);
  assert.deepStrictEqual(s2.map((x) => x.saldo), [1000, 1000, 1000]);
  // lançamento avulso futuro cai só no mês dele
  const s3 = L.previsao({ saldoInicial: 0 }, [mk('despesa', 500, '2027-01-10', 'pendente')], [], [], '2026-12', 3);
  assert.deepStrictEqual(s3.map((x) => x.saldo), [0, -500, -500]);
  assert.deepStrictEqual(s3.map((x) => x.despesas), [0, 500, 0]);

  // compacto
  assert.strictEqual(L.compacto(320000), '3,2k');
  assert.strictEqual(L.compacto(95000), '950');
  assert.strictEqual(L.compacto(-1250000), '-13k');
  assert.strictEqual(L.compacto(250000000), '2,5M');
  assert.strictEqual(L.compacto(0), '0');
  console.log('OK: testes da previsão passaram');
}

// ---------- composição do mês (gráfico redondo) ----------
{
  const m2 = (tipo, valor, status) => ({ tipo, valor, status, data: '2026-11-01' });
  // mesmo valor de receita e despesa => 50/50
  let c = L.composicaoMes([m2('receita', 100000, 'pago'), m2('despesa', 100000, 'pendente')]);
  assert.strictEqual(c.pctRec, 50); assert.strictEqual(c.pctDes, 50);
  assert.strictEqual(c.balancoPrevisto, 0); assert.strictEqual(c.balancoConsolidado, 100000);
  assert.strictEqual(c.nRec, 1); assert.strictEqual(c.nDes, 1);
  // contagem e totais
  c = L.composicaoMes([
    m2('receita', 300000, 'pago'), m2('receita', 200000, 'pendente'),
    m2('despesa', 50000, 'pago'), m2('despesa', 80000, 'pendente'), m2('despesa', 10000, 'pendente'),
  ]);
  assert.strictEqual(c.nRec, 2); assert.strictEqual(c.nDes, 3);
  assert.strictEqual(c.totalRec, 500000); assert.strictEqual(c.totalDes, 140000);
  assert.strictEqual(c.pctRec + c.pctDes, 100);
  assert.strictEqual(c.pctRec, 78);
  assert.strictEqual(c.balancoPrevisto, 360000);
  assert.strictEqual(c.recPend, 200000); assert.strictEqual(c.desPago, 50000);
  // percentuais sempre somam 100 (1/3 e 2/3)
  c = L.composicaoMes([m2('receita', 100, 'pago'), m2('despesa', 200, 'pago')]);
  assert.strictEqual(c.pctRec + c.pctDes, 100); assert.strictEqual(c.pctRec, 33);
  // só receitas / mês vazio
  c = L.composicaoMes([m2('receita', 500, 'pago')]);
  assert.strictEqual(c.pctRec, 100); assert.strictEqual(c.pctDes, 0);
  c = L.composicaoMes([]);
  assert.strictEqual(c.pctRec, 0); assert.strictEqual(c.pctDes, 0); assert.strictEqual(c.balancoPrevisto, 0);
  console.log('OK: testes da composição do mês passaram');
}

// ---------- juros compostos ----------
{
  const base = { inicial: 100000, aporte: 0, taxa: 12, taxaPor: 'ano', prazo: 1, prazoEm: 'anos' };
  // 12% ao ano por 1 ano sobre R$ 1.000 = R$ 1.120,00
  let r = L.simularJuros(base);
  assert.strictEqual(r.final, 112000);
  assert.strictEqual(r.investido, 100000);
  assert.strictEqual(r.juros, 12000);
  assert.ok(Math.abs(r.taxaAnual - 0.12) < 1e-12);
  // 1% ao mês por 12 meses: 1000 * 1,01^12 = 1126,83
  r = L.simularJuros({ ...base, taxa: 1, taxaPor: 'mes', prazo: 12, prazoEm: 'meses' });
  assert.strictEqual(r.final, 112683);
  assert.ok(Math.abs(r.taxaAnual - 0.126825) < 1e-6); // 1% ao mês = 12,6825% ao ano
  assert.ok(Math.abs(r.taxaMensal - 0.01) < 1e-15);
  // só aportes: 100/mês, 1% ao mês, 12 meses => 100 * ((1,01^12 - 1)/0,01) = 1268,25
  r = L.simularJuros({ inicial: 0, aporte: 10000, taxa: 1, taxaPor: 'mes', prazo: 12, prazoEm: 'meses' });
  assert.strictEqual(r.final, 126825);
  assert.strictEqual(r.investido, 120000);
  // taxa zero: só soma
  r = L.simularJuros({ inicial: 100000, aporte: 10000, taxa: 0, taxaPor: 'ano', prazo: 12, prazoEm: 'meses' });
  assert.strictEqual(r.final, 220000); assert.strictEqual(r.juros, 0); assert.strictEqual(r.pctJuros, 0);
  // 2 anos = 24 meses
  const a = L.simularJuros({ ...base, aporte: 5000, prazo: 2 });
  const b = L.simularJuros({ ...base, aporte: 5000, prazo: 24, prazoEm: 'meses' });
  assert.strictEqual(a.final, b.final); assert.strictEqual(a.n, 24);
  // confere com a fórmula fechada em vários cenários (tolerância de 1 centavo por arredondamento)
  const fechada = ({ inicial, aporte, taxa, taxaPor, prazo, prazoEm }) => {
    const n = prazoEm === 'anos' ? prazo * 12 : prazo;
    const i = taxaPor === 'ano' ? Math.pow(1 + taxa / 100, 1 / 12) - 1 : taxa / 100;
    return i === 0 ? inicial + aporte * n : inicial * Math.pow(1 + i, n) + aporte * ((Math.pow(1 + i, n) - 1) / i);
  };
  [
    { inicial: 500000, aporte: 30000, taxa: 10.5, taxaPor: 'ano', prazo: 10, prazoEm: 'anos' },
    { inicial: 0, aporte: 50000, taxa: 0.8, taxaPor: 'mes', prazo: 30, prazoEm: 'anos' },
    { inicial: 1234567, aporte: 0, taxa: 6, taxaPor: 'ano', prazo: 40, prazoEm: 'anos' },
    { inicial: 100, aporte: 100, taxa: 100, taxaPor: 'ano', prazo: 7, prazoEm: 'meses' },
    { inicial: 250000, aporte: 99999, taxa: 13.75, taxaPor: 'ano', prazo: 18, prazoEm: 'meses' },
  ].forEach((c) => assert.ok(Math.abs(L.simularJuros(c).final - fechada(c)) <= 1, 'fórmula fechada: ' + JSON.stringify(c)));
  // juros = final - investido
  r = L.simularJuros({ inicial: 500000, aporte: 30000, taxa: 10.5, taxaPor: 'ano', prazo: 10, prazoEm: 'anos' });
  assert.strictEqual(r.juros, r.final - r.investido);
  assert.strictEqual(r.investido, 500000 + 30000 * 120);
  // série: um ponto por ano depois de 24 meses; sempre termina em n
  assert.deepStrictEqual(r.serie.map((x) => x.mes), [0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120]);
  assert.strictEqual(r.serie[r.serie.length - 1].total, r.final);
  r = L.simularJuros({ ...base, prazo: 18, prazoEm: 'meses' });
  assert.strictEqual(r.serie.length, 19); // mês a mês até 24
  r = L.simularJuros({ ...base, prazo: 30, prazoEm: 'meses' });
  assert.deepStrictEqual(r.serie.map((x) => x.mes), [0, 12, 24, 30]);
  // crescimento nunca decresce com taxa positiva
  r = L.simularJuros({ inicial: 100000, aporte: 1000, taxa: 8, taxaPor: 'ano', prazo: 20, prazoEm: 'anos' });
  for (let i = 1; i < r.serie.length; i++) assert.ok(r.serie[i].total > r.serie[i - 1].total);
  // parse de percentual e textos
  assert.strictEqual(L.parsePercentual('12,5'), 12.5);
  assert.strictEqual(L.parsePercentual('12.5'), 12.5);
  assert.strictEqual(L.parsePercentual('0,8 %'), 0.8);
  assert.strictEqual(L.parsePercentual(''), null);
  assert.strictEqual(L.parsePercentual('abc'), null);
  assert.strictEqual(L.textoPrazo(120), '10 anos');
  assert.strictEqual(L.textoPrazo(18), '1 ano e 6 meses');
  assert.strictEqual(L.textoPrazo(1), '1 mês');
  assert.strictEqual(L.textoPrazo(13), '1 ano e 1 mês');
  assert.strictEqual(L.rotuloMeses(6), '6m'); assert.strictEqual(L.rotuloMeses(24), '2a'); assert.strictEqual(L.rotuloMeses(18), '1a6m');
  console.log('OK: testes dos juros compostos passaram');
}
