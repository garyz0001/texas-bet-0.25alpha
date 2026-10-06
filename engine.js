/* =========================================================
   德州扑克 · 虚拟下注器 —— 核心引擎（纯逻辑，无 DOM）
   同一份代码跑在 Node 服务端；下注金额一律是「本轮下注总额 (raise-to)」
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PokerEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STREET_NAME = ['翻牌前', '翻牌', '转牌', '河牌', '摊牌'];

  function createState() {
    return {
      players: [],       // {id,pid,name,chips,folded,allIn,street,inHand,acted,lastAct}
      bench: [],         // 中途加入、下一手才上桌
      sb: 5, bb: 10,
      buttonSeat: 0,
      straddleSeat: -1,
      handNo: 0,
      pot: 0,
      street: 0,         // 0翻前 1翻牌 2转牌 3河牌 4摊牌
      streetBet: 0,
      current: null,
      lastActorSeat: -1,
      log: [],
      history: [],
      phase: 'idle',     // idle | playing | showdown | over
      pots: [],
    };
  }

  /* ---------- 工具 ---------- */
  const N = S => S.players.length;
  const at = (S, seat) => S.players[((seat % N(S)) + N(S)) % N(S)];
  const seatOf = (S, p) => S.players.indexOf(p);
  const boardPot = S => S.pot + S.players.reduce((s, p) => s + p.street, 0);

  function logMsg(S, msg, cls) {
    S.log.push({ msg: msg, cls: cls || '' });
    if (S.log.length > 400) S.log.shift();
  }

  /* ---------- 撤销 ---------- */
  function snap(S) {
    return JSON.stringify({
      players: S.players, bench: S.bench, buttonSeat: S.buttonSeat, handNo: S.handNo,
      pot: S.pot, street: S.street, streetBet: S.streetBet, current: S.current,
      lastActorSeat: S.lastActorSeat, phase: S.phase,
    });
  }
  function pushSnap(S) {
    S.history.push(snap(S));
    if (S.history.length > 150) S.history.shift();
  }
  function undo(S) {
    const s = S.history.pop();
    if (!s) return false;
    Object.assign(S, JSON.parse(s));
    logMsg(S, '↩︎ 已撤销', 'sys');
    return true;
  }

  /* ---------- 开桌 ---------- */
  /** cfg: {seats:[{pid,name,chips}], sb, bb, straddleSeat} */
  function newGame(S, cfg) {
    S.sb = cfg.sb; S.bb = cfg.bb;
    S.straddleSeat = (cfg.straddleSeat == null ? -1 : cfg.straddleSeat);
    S.players = (cfg.seats || []).map((s, i) => ({
      id: i,
      pid: s.pid == null ? i : s.pid,
      name: (s.name || '').trim() || ('玩家 ' + (i + 1)),
      chips: Math.max(0, Math.round(s.chips)),
      folded: false, allIn: false,
      street: 0, inHand: 0, acted: false, lastAct: '',
    }));
    S.bench = [];
    S.buttonSeat = 0; S.handNo = 0; S.pot = 0; S.street = 0;
    S.log = []; S.history = []; S.pots = [];
    logMsg(S, '━━ 新牌桌：' + S.players.length + ' 人 · 买入 ' + fmt(cfg.buyin) +
      ' · 盲注 ' + S.sb + '/' + S.bb +
      (S.straddleSeat >= 0 ? ' · 抓头位：' + S.players[S.straddleSeat].name : ''), 'sys');
    S.phase = 'playing';
    nextHand(S);
  }

  function fmt(v) { return Math.round(v).toLocaleString('zh-CN'); }

  /* ---------- 位置 ---------- */
  const straddleOn = S =>
    S.straddleSeat >= 0 && !!S.players[S.straddleSeat] &&
    S.players[S.straddleSeat].chips > 0 && N(S) >= 3 &&
    S.straddleSeat !== (S.buttonSeat + 1) % N(S);

  /** 给客户端用：每个座位的徽章（BTN / SB / BB* / BB / 数字） */
  function badges(S) {
    const out = {};
    if (!S.players.length || S.phase === 'over') return out;
    const n = N(S), sbSeat = (S.buttonSeat + 1) % n, bbSeat = (S.buttonSeat + 2) % n;
    const strOn = straddleOn(S);
    S.players.forEach((p, i) => {
      if (i === S.buttonSeat) out[p.id] = 'BTN';
      else if (i === sbSeat) out[p.id] = 'SB';
      else if (strOn && i === S.straddleSeat) out[p.id] = 'BB*';
      else if (i === bbSeat) out[p.id] = 'BB';
      else out[p.id] = String(i + 1);
    });
    return out;
  }

  /* ---------- 新一手 ---------- */
  function nextHand(S) {
    // 安全网：上一手若未结算，先把桌上的牌退回，避免凭空消失
    const loose = S.pot + S.players.reduce((t, p) => t + p.street, 0);
    if (loose > 0) {
      S.pot = 0;
      S.players.forEach(p => { p.chips += p.street; p.street = 0; });
      logMsg(S, '! 上一手未结算，' + fmt(loose) + ' 筹码已退回桌上', 'sys');
    }

    // 中途加入的人从候补席上桌
    if (S.bench && S.bench.length) {
      S.bench.forEach(b => {
        if (b.chips > 0) S.players.push({
          id: S.players.length, pid: b.pid, name: b.name, chips: Math.round(b.chips),
          folded: false, allIn: false, street: 0, inHand: 0, acted: false, lastAct: '',
        });
      });
      logMsg(S, '＋ ' + S.bench.map(b => b.name).join('、') + ' 加入牌桌', 'sys');
      S.bench = [];
    }

    S.players = S.players.filter(p => p.chips > 0);
    S.players.forEach((p, i) => { p.id = i; });          // 重编号，防旧 id 失效
    if (S.players.length < 2) {
      S.phase = 'over';
      logMsg(S, '剩不到 2 人，游戏结束。', 'sys');
      return;
    }
    S.handNo++;
    S.pot = 0; S.street = 0; S.streetBet = 0; S.pots = [];
    S.players.forEach(p => {
      p.folded = false; p.allIn = false; p.street = 0; p.inHand = 0;
      p.acted = false; p.lastAct = '';
    });
    logMsg(S, '━━ 第 ' + S.handNo + ' 手 ━━', 'sys');

    S.phase = 'playing';   // 从摊牌/结算态回到进行中，stepTurn 才会推进
    const n = N(S);
    S.buttonSeat = S.handNo === 1 ? 0 : (S.buttonSeat + 1) % n;
    while (S.players[S.buttonSeat].chips <= 0) S.buttonSeat = (S.buttonSeat + 1) % n;

    // 盲注：小盲始终是按钮位左手第一位；大盲在其右侧
    const sbSeat = (S.buttonSeat + 1) % n;
    let utg;
    if (n === 2) {
      postBlind(S, S.buttonSeat, S.sb, '小盲');            // 两人桌：按钮位 = 小盲
      postBlind(S, (S.buttonSeat + 1) % n, S.bb, '大盲');
      S.streetBet = Math.max(at(S, (S.buttonSeat + 1) % n).street, at(S, S.buttonSeat).street);
      utg = S.buttonSeat;
    } else {
      postBlind(S, sbSeat, S.sb, '小盲');
      if (straddleOn(S)) {
        // 抓头（live straddle）= 额外的 2BB 盲注，真正的大盲顺延到下一位
        postBlind(S, S.straddleSeat, S.bb * 2, '抓头 2BB');
        postBlind(S, (S.straddleSeat + 1) % n, S.bb, '大盲');
        S.streetBet = S.bb * 2;
        utg = (S.straddleSeat + 2) % n;
      } else {
        postBlind(S, (S.buttonSeat + 2) % n, S.bb, '大盲');
        S.streetBet = S.bb;
        utg = (S.buttonSeat + 3) % n;
      }
    }

    // 翻前 UTG = 大盲左手第一位；两人桌时按钮位（小盲）先动
    S.lastActorSeat = utg - 1;
    S.current = null;
    stepTurn(S);
  }

  function postBlind(S, seat, amount, label) {
    const p = at(S, seat);
    const pay = Math.min(amount, p.chips);
    p.chips -= pay; p.street += pay; p.inHand += pay;
    if (pay < amount) p.allIn = true;
    logMsg(S, p.name + ' ' + label + ' ' + fmt(pay) + (pay < amount ? '（不足，全下）' : ''));
  }

  function collectPot(S) {
    S.players.forEach(p => { S.pot += p.street; p.street = 0; });
    S.streetBet = 0;
  }

  /* ---------- 行动流转 ---------- */
  const actionable = p => !p.folded && !p.allIn && p.chips > 0;

  function stepTurn(S) {
    if (S.phase !== 'playing') return;
    const alive = S.players.filter(p => !p.folded);
    if (alive.length <= 1) return toShowdown(S);
    if (!S.players.some(actionable)) return toShowdown(S);

    for (let i = 1; i <= N(S); i++) {
      const p = at(S, S.lastActorSeat + i);
      if (actionable(p) && (!p.acted || p.street < S.streetBet)) { S.current = p.id; return; }
    }
    if (S.players.filter(actionable).length <= 1) return toShowdown(S);
    advanceStreet(S);
  }

  function advanceStreet(S) {
    collectPot(S);
    S.lastActorSeat = -1;
    if (S.players.filter(actionable).length <= 1) return toShowdown(S);
    S.street++;
    if (S.street > 3) return toShowdown(S);
    logMsg(S, '━━ ' + STREET_NAME[S.street] + ' ━━', 'sys');
    S.players.forEach(p => { p.street = 0; p.acted = false; });

    // 翻牌后由按钮位左手第一位先动（正常即小盲；抓头时为抓头位）；两人桌为按钮位
    let first = (S.buttonSeat + 1) % N(S);
    let guard = 0;
    while (!actionable(at(S, first)) && guard++ < N(S)) first = (first + 1) % N(S);
    S.lastActorSeat = first - 1;
    stepTurn(S);
  }

  /* ---------- 下注额度计算 ---------- */
  /** 向下取整到大盲的整数倍，舍掉零头 */
  function roundBB(S, v) {
    const step = S.bb > 0 ? S.bb : 1;
    return Math.floor(v / step) * step;
  }

  /** 当前行动者的可下注区间与快捷额度（客户端与服务端共用同一份计算） */
  function betOptions(S, seat) {
    const p = S.players[seat];
    if (!p) return null;
    const toCall = Math.max(0, S.streetBet - p.street);
    const minTo = Math.min(Math.max(p.street, S.streetBet), p.street + p.chips);
    const maxTo = p.street + p.chips;
    const potNow = boardPot(S);
    const opts = [{ key: 'call', label: toCall > 0 ? '跟注' : '过牌', value: minTo }];
    // 0.11alpha：快捷额度直接按「底池 × 比例」算，不再把需跟注的那部分加进去。
    //   底池 100 -> 1/3池 30、1/2池 50、3/4池 70、满池 100（0.1alpha 会算成 130/150/175/200 那种含跟注的数）。
    // 算完向下舍到大盲整数倍；舍完低于跟注额 = 这个尺度根本打不出来 -> 不生成（跟注按钮已覆盖）；
    // 超过后手则封顶到全下额；舍零头后金额相同 -> 只留比例最大的那个，避免一排同数按钮。
    if (maxTo > minTo) {
      const byValue = new Map();
      [[1 / 3, '1/3池'], [1 / 2, '1/2池'], [3 / 4, '3/4池'], [1, '满池']].forEach(pair => {
        let v = roundBB(S, potNow * pair[0]);
        if (v <= 0 || v < minTo) return;   // 舍完比跟注额还小 -> 这个尺度打不出来

        v = Math.min(v, maxTo);            // 不超过后手
        byValue.set(v, { key: pair[1], label: pair[1], value: v });
      });
      // ALL IN 最后写入：金额撞车时一律显示 ALL IN，避免「满池 300」「ALL IN 300」并排
      byValue.set(maxTo, { key: 'allin', label: 'ALL IN', value: maxTo });
      Array.from(byValue.values()).sort((a, b) => a.value - b.value).forEach(x => opts.push(x));
    }
    return { toCall: toCall, minTo: minTo, maxTo: maxTo, pot: potNow, options: opts };
  }

  /* ---------- 动作 ---------- */
  function doFold(S, seat) {
    const p = S.players[seat];
    if (!p || S.phase !== 'playing' || S.current !== seat) return false;
    if (p.folded) return false;
    pushSnap(S);
    p.folded = true; p.acted = true; p.lastAct = '弃牌';
    logMsg(S, p.name + ' 弃牌');
    S.lastActorSeat = seatOf(S, p); S.current = null;
    stepTurn(S);
    return true;
  }

  /** amount = 本轮下注总额 (raise-to)，自动夹在 [已下注, 已下注+后手] */
  function doCommit(S, seat, amount) {
    const p = S.players[seat];
    if (!p || S.phase !== 'playing' || S.current !== seat) return false;
    if (p.folded || p.allIn) return false;
    const maxTo = p.street + p.chips;
    const minTo = Math.min(Math.max(p.street, S.streetBet), maxTo);
    let to = Math.round(Number(amount));
    if (!isFinite(to)) to = minTo;
    to = Math.max(minTo, Math.min(to, maxTo));
    const commit = to - p.street;

    if (commit <= 0) {                       // 已跟平 → 过牌
      pushSnap(S);
      p.acted = true;
      p.lastAct = '过牌';
      logMsg(S, p.name + ' 过牌');
      S.lastActorSeat = seatOf(S, p); S.current = null;
      stepTurn(S);
      return true;
    }

    pushSnap(S);
    const prevBet = S.streetBet;
    p.chips -= commit; p.street = to; p.inHand += commit;
    p.acted = true;
    const allIn = p.chips === 0;
    if (allIn) p.allIn = true;
    const isRaise = to > prevBet;
    p.lastAct = allIn ? (isRaise ? '全下加注' : '全下跟注') : (isRaise ? '加注' : '跟注');
    if (isRaise) S.streetBet = to;
    const diff = prevBet === 0 ? to : to - prevBet;
    logMsg(S, p.name + ' ' + p.lastAct + ' ' + fmt(commit) +
      (isRaise ? '　→ 下注到 ' + fmt(to) + ' (+' + fmt(diff) + ')' : ''));
    S.lastActorSeat = seatOf(S, p); S.current = null;
    stepTurn(S);
    return true;
  }

  /**
   * 未被跟注的下注：投入最多的那个人，超出「第二高」的部分。
   * 已弃牌的人仍计入（他的筹码真的在桌上）。
   */
  function uncalledRefund(S) {
    const list = S.players.filter(p => p.inHand > 0).sort((a, b) => b.inHand - a.inHand);
    if (list.length < 2) return { id: -1, amt: 0 };
    const amt = list[0].inHand - list[1].inHand;
    return amt > 0 ? { id: list[0].id, amt: amt } : { id: -1, amt: 0 };
  }

  /* ---------- 主池 / 边池 ---------- */
  function buildPots(S) {
    // 1) 退回未被跟注的下注
    const back = uncalledRefund(S);
    if (back.amt > 0) {
      const p = S.players[back.id];
      p.inHand -= back.amt; p.chips += back.amt; S.pot -= back.amt;
      p.lastAct = '收回 ' + fmt(back.amt);
      logMsg(S, p.name + ' 收回未被跟注的 ' + fmt(back.amt));
    }

    // 2) 按投入层级切分主池 / 边池
    const levels = S.players.map(p => p.inHand).filter(v => v > 0)
      .filter((v, i, a) => a.indexOf(v) === i).sort((x, y) => x - y);
    const pots = [];
    let prev = 0, carry = 0;
    for (const L of levels) {
      const cnt = S.players.filter(p => p.inHand >= L).length;
      if (cnt === 0) break;
      let amount = (L - prev) * cnt;
      const eligible = S.players.filter(p => p.inHand >= L && !p.folded).map(p => p.id);
      prev = L;
      if (eligible.length === 0) {           // 这一层无人可赢 → 并入下一个池
        if (pots.length) pots[pots.length - 1].amount += amount;
        else carry += amount;
        continue;
      }
      if (carry > 0) { amount += carry; carry = 0; }
      const last = pots[pots.length - 1];
      const sameSet = last && last.eligible.length === eligible.length &&
        last.eligible.every(id => eligible.indexOf(id) >= 0);
      if (sameSet) last.amount += amount;    // 可赢人一样 → 合并成一个池
      else pots.push({ amount: amount, eligible: eligible, winners: [] });
    }
    if (carry > 0) {
      const alive = S.players.filter(p => !p.folded);
      if (alive.length) pots.push({ amount: carry, eligible: alive.map(p => p.id), winners: [] });
      else S.pot -= carry;
    }
    return pots;
  }

  function toShowdown(S) {
    collectPot(S);
    S.street = 4;
    S.phase = 'showdown';
    S.current = null;
    S.pots = buildPots(S);
    logMsg(S, '◆ 摊牌 — 底池 ' + fmt(S.pot) +
      (S.pots.length > 1 ? '（' + S.pots.length + ' 个池）' : '') + '，等待房主确认', 'sys');
  }

  /** winnersByPot: [[seatId, ...], ...] 每个池一个数组，>1 人即平分 */
  function confirmWin(S, winnersByPot) {
    if (S.phase !== 'showdown') return { ok: false, msg: '当前不是摊牌阶段' };
    if (!S.pots.length) return { ok: false, msg: '底池为 0，直接开新一手' };
    const list = winnersByPot || [];
    for (let i = 0; i < S.pots.length; i++) {
      const w = (list[i] || []).filter(id => S.pots[i].eligible.indexOf(id) >= 0);
      if (!w.length) return { ok: false, msg: '请先为' + (i === 0 ? '主池' : '边池 ' + i) + '选择赢家' };
      S.pots[i].winners = w;
    }
    S.pots.forEach(pot => {
      const winners = pot.winners.map(id => S.players[id]);
      const share = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - share * winners.length;
      winners.forEach(w => {
        let amt = share;
        if (rem > 0) { amt += rem; rem = 0; }
        w.chips += amt;
        w.lastAct = (winners.length > 1 ? '平分 +' : '赢下 +') + fmt(amt);
        logMsg(S, '★ ' + w.name + (winners.length > 1 ? ' 平分 ' : ' 赢下 ') + fmt(amt) +
          ' → 筹码 ' + fmt(w.chips), 'sys');
      });
    });
    S.pot = 0; S.pots = [];
    return { ok: true };
  }

  return {
    STREET_NAME, createState, newGame, nextHand, doFold, doCommit, confirmWin, undo,
    betOptions, badges, boardPot, logMsg, roundBB,
  };
});
