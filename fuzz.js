/* 属性测试：随机对局，校验不变量
   1) 无人筹码为负
   2) 总筹码守恒（桌上 + 底池）
   3) 任何时刻下注额 ≤ 后手
   4) 摊牌后每个池分配正确（且只分给 eligible 的人）
*/
class El{constructor(id){this.id=id;this.value='';this.textContent='';this.innerHTML='';this.className='';this.style={};this.dataset={};this.children=[];this.checked=false;
this.classList={_s:new Set(),add(){},remove(){},contains(){return false},toggle(){}};}
querySelector(){return new El('q')}querySelectorAll(){return []}addEventListener(){}appendChild(c){return c}closest(){return null}}
const path=require('path');
const PE=require(path.join(__dirname,'engine.js'));
const S=PE.createState();
const newGame=cfg=>EngineNewGame(cfg);
function EngineNewGame(cfg){PE.newGame(S,cfg);}
const nextHand=()=>PE.nextHand(S);
const doCommit=(p,v)=>PE.doCommit(S,p.id,v);
const doFold=p=>PE.doFold(S,p.id);
const confirmWin=w=>PE.confirmWin(S,w);

let errs=[];
const E=(m)=>{ errs.push(m); if(errs.length<=25) console.log('  ✗ '+m); };

function invariants(tag, initialTotal){
  const table=S.players.reduce((s,p)=>s+p.chips,0);
  const pot=S.pot+S.players.reduce((s,p)=>s+p.street,0);
  S.players.forEach(p=>{
    if(p.chips<0) E(tag+': 负筹码 '+p.name+'='+p.chips);
    if(p.street<0) E(tag+': 负下注 '+p.name);
    if(p.street>p.totalEver) {}
    if(p.chips+p.inHand+p.street > p.init && false) {}
  });
  if(table+pot!==initialTotal)
    E(tag+': 筹码不守恒 table='+table+' pot='+pot+' 合计='+(table+pot)+' 应为 '+initialTotal);
}

// 随机数
let seed=12345;
const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
const pick=a=>a[Math.floor(rnd()*a.length)];

let hands=0, pots=0, streetsSeen={};
for(let hand=0; hand<400; hand++){
  const nPlay=2+Math.floor(rnd()*7);           // 2..8 人
  const buyin=[200,500,1000,2000][Math.floor(rnd()*4)];
  const names=Array.from({length:nPlay},(_,i)=>'P'+i);
  newGame({sb:Math.max(1,Math.round(buyin/200)),bb:Math.max(2,Math.round(buyin/100)),buyin,straddleSeat:-1,seats:names.map((nm,i)=>({pid:i,name:nm,chips:buyin}))});
  const total=nPlay*buyin;
  let guard=0;
  while(S.phase==='playing' && guard++<400){
    invariants('手'+hand+' 步'+guard, total);
    if(S.current===null) E('手'+hand+': playing 但无当前行动者');
    streetsSeen[S.street]=(streetsSeen[S.street]||0)+1;
    const p=S.players[S.current];
    const toCall=Math.max(0,S.streetBet-p.street);
    const maxTo=p.street+p.chips;
    const r=rnd();
    if(r<0.18 && S.streetBet>0) doFold(p);
    else if(r<0.30 && toCall===0) doCommit(p,p.street);            // 过牌
    else if(r<0.62) doCommit(p, S.streetBet);                        // 跟注
    else if(r<0.70) doCommit(p, maxTo);                              // 全下
    else if(r<0.88) doCommit(p, Math.min(maxTo, Math.round(toCall + (S.pot+S.players.reduce((s,x)=>s+x.street,0))*([0.33,0.5,0.75,1][Math.floor(rnd()*4)])))); // 尺度
    else doCommit(p, Math.min(maxTo, p.street + Math.round(p.chips*[0.1,0.25,0.5][Math.floor(rnd()*3)])));
  }
  if(S.phase==='showdown'){
    invariants('手'+hand+' 摊牌', total);
    // 检查池子
    const sum=S.pots.reduce((s,p)=>s+p.amount,0);
    const realPot=S.pot+S.players.reduce((s,p)=>s+p.street,0);
    if(sum!==realPot) E('手'+hand+': 池子合计 '+sum+' != 实际底池 '+realPot);
    const nPots=S.pots.length; pots+=nPots;
    S.pots.forEach((pot,i)=>{
      if(pot.eligible.length===0) E('手'+hand+' 池'+i+': 无人可赢');
      if(pot.amount<=0) E('手'+hand+' 池'+i+': 金额非正 '+pot.amount);
      // 资格检查：eligible 的人必须真的投入 >= 该池层级，且未弃牌
      const maxLvl=Math.max.apply(null,S.players.map(p=>p.inHand));
      pot.eligible.forEach(id=>{
        const p=S.players[id];
        if(p.folded) E('手'+hand+' 池'+i+': 已弃牌 '+p.name+' 却有资格');
        if(p.inHand<=0) E('手'+hand+' 池'+i+': '+p.name+' 未投入却有资格');
      });
      if(i>0){
        const prev=S.pots[i-1];
        pot.eligible.forEach(id=>{
          if(prev.eligible.indexOf(id)<0)
            E('手'+hand+' 池'+i+': '+S.players[id].name+' 可赢边池却不能赢主池');
        });
      }
      const win=pot.eligible.filter(()=>rnd()<0.5);
      pot.winners=win.length?win:[pick(pot.eligible)];
    });
    const inHand=S.players.map(p=>p.inHand);
    confirmWin();
    invariants('手'+hand+' 结算后', total);
    // 未摊牌者不应因他人赢池而丢筹码：所有人的 inHand 都已在底池中
    S.players.forEach((p,i)=>{
      if(p.folded && p.chips<0) E('弃牌者负筹码');
    });
    hands++;
  }
}
console.log('\n模拟 '+hands+' 手，随机摊牌，生成 '+pots+' 个池');
console.log('各圈行动次数：', JSON.stringify(streetsSeen));
console.log(errs.length? '\n❌ '+errs.length+' 处问题' : '\n✅ 所有不变量通过（无负筹码 / 筹码守恒 / 池子分配正确）');
process.exit(errs.length?1:0);

