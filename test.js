/* \u786e\u5b9a\u6027\u573a\u666f\u6d4b\u8bd5 \u2014\u2014 \u671f\u671b\u503c\u6309\u771f\u5b9e\u5fb7\u5dde\u6251\u5143\u89c4\u5219\u63a8\u5bfc */
const path=require('path');
const PE=require(path.join(__dirname,'engine.js'));
const S=PE.createState();
const at=seat=>S.players[((seat%S.players.length)+S.players.length)%S.players.length];
const newGame=cfg=>PE.newGame(S,Object.assign({sb:5,bb:10,buyin:1000,straddleSeat:-1},cfg));
const nextHand=()=>PE.nextHand(S);
const doCommit=(p,v)=>PE.doCommit(S,p.id,v);
const doFold=p=>PE.doFold(S,p.id);
const confirmWin=(w)=>PE.confirmWin(S,w||S.pots.map(p=>p.winners));
const undo=()=>PE.undo(S);

let fails=0;
const sec=t=>console.log('\n=== '+t+' ===');
function eq(a,e,m){
  const x=JSON.stringify(a),y=JSON.stringify(e);
  if(x!==y){ console.log('  FAIL '+m+'\n     \u5b9e\u9645 '+x+'\n     \u671f\u671b '+y); fails++; }
  else console.log('  ok   '+m+'  = '+x);
}
const chips =()=>S.players.map(p=>p.chips);
const inPot =()=>S.pot+S.players.reduce((s,p)=>s+p.street,0);
const total =()=>chips().reduce((a,b)=>a+b,0)+inPot();
const who   =()=>S.current===null?null:S.players[S.current].name;
const turn  =()=>S.players[S.current];
const N_=nm=>S.players.find(p=>p.name===nm);
const idOf=nm=>S.players.find(p=>p.name===nm).id;
const G=(o={})=>{const n=o.count||3;const names=o.names||['A','B','C'].slice(0,n);const st=o.stacks;newGame(Object.assign({sb:5,bb:10,buyin:1000,straddleSeat:-1},o,{seats:names.map((nm,i)=>({pid:i,name:nm,chips:st&&st[i]!=null?st[i]:(o.buyin||1000)}))}));};
const ck=()=>{ if(S.streetBet>turn().street) throw new Error('ck() \u9762\u5bf9\u4e0b\u6ce8 '+S.streetBet+'\uff0c\u8be5\u7528 cl()');
              return doCommit(turn(),turn().street); };
const cl=()=>doCommit(turn(),S.streetBet);
const rt=v=>doCommit(turn(),v);
const fd=()=>doFold(turn());
const toRiver=()=>{for(let i=0;i<40 && S.phase==='playing';i++) ck(); return S.phase;};
const settle=(names)=>{const ns=Array.isArray(names)?names:[names];
  S.pots.forEach(p=>{p.winners=p.eligible.filter(id=>ns.indexOf(S.players[id].name)>=0);});confirmWin();};
const potStr=()=>S.pots.map(p=>p.amount+':'+p.eligible.map(i=>S.players[i].name).join('/')).join(' | ');

sec('1. \u4e09\u4eba\u684c\u9996\u624b\uff1a\u6309\u94ae=1\u53f7\u4f4d\uff0c\u5c0f\u76f2/\u5927\u76f2/UTG');
G();
eq([at(S.buttonSeat).name,at(S.buttonSeat+1).name,at(S.buttonSeat+2).name].join(' '),'A B C','BTN/SB/BB');
eq(S.players.map(p=>p.street),[0,5,10],'B \u5c0f\u76f25\u3001C \u5927\u76f210');
eq(inPot(),15,'\u5e95\u6c60 15');
eq(who(),'A','UTG = A');
eq(total(),3000,'\u5b88\u6052 3000');

sec('2. \u8ddf\u5e73\u540e\u95ed\u5408\u4e0b\u6ce8\u8f6e\uff0c\u7ffb\u724c\u540e\u5c0f\u76f2\u4f4d\u5148\u52a8');
G();
cl(); eq(who(),'B','A \u8ddf\u5230 10 \u2192 B');
cl(); eq(who(),'C','B \u8ddf\u5230 10 \u2192 C(\u5927\u76f2\uff0c\u6709\u9009\u62e9\u6743)');
eq(S.phase,'playing','\u5927\u76f2\u8fd8\u6ca1\u884c\u52a8\uff0c\u672c\u8f6e\u672a\u7ed3\u675f');
ck(); eq(chips()[2],990,'C \u8fc7\u724c\uff08\u4e0d\u52a0\u94b1\uff09');
eq(S.street,1,'C \u8fc7\u724c \u2192 \u8fdb\u5165\u7ffb\u724c');
eq(S.pot,30,'\u5e95\u6c60 30');
eq(who(),'B','\u7ffb\u724c\u540e\u5c0f\u76f2\u4f4d\u5148\u52a8');

sec('3. \u52a0\u6ce8 \u2192 \u53cd\u52a0\u6ce8 \u2192 \u52a0\u6ce8\u8005\u91cd\u65b0\u83b7\u5f97\u884c\u52a8\u6743');
G();
rt(30); eq(who(),'B','A \u52a0\u6ce8\u5230 30 \u2192 B');
rt(80); eq(who(),'C','B \u53cd\u52a0\u6ce8\u5230 80 \u2192 C');
cl();     eq(chips()[2],920,'C \u8865\u5230 80');
eq(who(),'A','\u2192 A(\u5927\u76f2\uff0c\u9700\u8865 70)');
cl();     eq(chips()[0],920,'A \u8865\u5230 80');
eq(S.street,1,'\u4e09\u4eba\u5168\u90e8\u8ddf\u5e73 80 \u2192 \u76f4\u63a5\u8fdb\u5165\u7ffb\u724c');
eq(S.pot,240,'\u5e95\u6c60 80x3 = 240');
eq(toRiver(),'showdown','\u8fc7\u724c\u5230\u6cb3\u724c');
settle('B'); eq(chips(),[920,1160,920],'B \u72ec\u8d62 240');
eq(total(),3000,'\u7ed3\u7b97\u540e\u5b88\u6052');

sec('4. \u672a\u88ab\u8ddf\u6ce8\u7684\u8d85\u989d\u4e0b\u6ce8\u81ea\u52a8\u9000\u56de');
G({count:4,names:['A','B','C','D']});
eq(who(),'D','UTG = D');
rt(500);
eq(who(),'A','\u2192 A');
fd(); eq(who(),'B','\u2192 B');
fd(); eq(who(),'C','\u2192 C');
fd(); eq(S.phase,'showdown','C \u4e5f\u5f03 \u2192 \u53ea\u5269 D');
eq(chips()[3],990,'D \u6536\u56de\u672a\u88ab\u8ddf\u6ce8\u7684 490\uff08\u4ed6\u4fdd\u7559 10 \u4e0e\u5927\u76f2\u5bf9偿\uff09');
eq(S.pot,25,'\u5e95\u6c60 = \u5c0f\u76f25 + \u5927\u76f210 + D \u5bf9\u507f\u7684 10');
eq(S.pots.length,1,'\u5355\u4e00\u6c60');
settle('D'); eq(chips(),[1000,995,990,1015],'D \u6536\u4e0b 25');
eq(total(),4000,'\u5b88\u6052 4000');

sec('4b. \u52a0\u6ce8\u88ab\u90e8\u5206\u8ddf\u6ce8\u65f6\uff0c\u53ea\u9000\u56de\u591a\u4f59\u90a3\u90e8\u5206');
G({count:4,names:['A','B','C','D']});
rt(100); eq(who(),'A','D \u52a0\u6ce8\u5230 100 \u2192 A');
cl();     eq(who(),'B','A \u8ddf\u5230 100 \u2192 B');
rt(300); eq(who(),'C','B \u52a0\u6ce8\u5230 300 \u2192 C');
cl();     eq(who(),'D','C \u8ddf\u5230 300 \u2192 D');
fd();     eq(who(),'A','D \u5f03\u724c \u2192 A\uff08A \u9762\u5bf9 300 \u9700\u518d\u884c\u52a8\uff09');
fd();     eq(who(),'B','A \u5f03\u724c \u2192 B');
fd();     eq(S.phase,'showdown','B \u4e5f\u5f03 \u2192 \u53ea\u5269 C\uff0c\u76f4\u63a5\u6536\u6c60');
eq(chips()[2],700,'C \u8ddf\u5230 300 \u540e剩 700');
eq(S.pot,800,'\u5e95\u6c60 D100+A100+B300+C300 = 800');
eq(potStr(),'800:C','\u5355\u4e00\u6c60\uff08C \u901a\u5403\uff09');
settle('C'); eq(chips(),[900,700,1500,900],'C \u8d62 800');
eq(total(),4000,'\u5b88\u6052 4000');
eq(total(),4000,'\u5b88\u6052 4000');

sec('5. \u4e09\u65b9\u5168\u4e0b');
G({buyin:200});
rt(200); eq(N_('A').allIn,true,'A \u5168\u4e0b');
cl();     eq(N_('B').allIn,true,'B \u5168\u4e0b');
cl();     eq(S.phase,'showdown','C \u8ddf\u5168\u4e0b \u2192 \u644a\u724c');
eq(S.pot,600,'\u5e95\u6c60 600');
settle('A'); eq(chips(),[600,0,0],'A \u8d62 600');

sec('6. \u5168\u4e0b\u540e\u4ecd\u7ee7\u7eed\u8d70\u5b8c\u516c\u5171\u724c\uff08\u77ed\u7801\u5728 UTG\uff09');
G({count:4,names:['A','B','C','D'],stacks:[1000,1000,1000,300]});
eq(who(),'D','UTG = D\uff08300 \u77ed\u7801\uff09');
rt(300); eq(N_('D').allIn,true,'D \u5168\u4e0b 300');
cl(); eq(who(),'B','A \u8ddf\u5230 300 \u2192 B');
cl(); eq(who(),'C','B \u8ddf\u5230 300 \u2192 C');
cl(); eq(S.street,1,'C \u8ddf\u5230 300 \u2192 \u7ee7\u7eed\u7ffb\u724c\uff08\u6b63\u786e\uff09');
eq(toRiver(),'showdown','\u8fc7\u724c\u5230\u6cb3\u724c');
eq(S.pot,1200,'\u5e95\u6c60 300x4 = 1200');
eq(S.pots.length,1,'\u5355\u4e00\u4e3b\u6c60');
settle('D'); eq(chips(),[700,700,700,1200],'D \u8d62 1200');
eq(total(),3300,'\u5b88\u6052 3300\uff08D \u53ea\u4e70\u4e86 300\uff09');

sec('7. \u5206\u5c42\u8fb9\u6c60');
G({count:4,names:['A','B','C','D'],stacks:[1000,1000,1000,100]});
eq(who(),'D','UTG = D\uff08\u53ea\u6709 100\uff09');
rt(100); eq(N_('D').allIn,true,'D \u5168\u4e0b 100');
eq(who(),'A','\u2192 A');
rt(300); eq(who(),'B','A \u52a0\u6ce8\u5230 300');
cl();     eq(who(),'C','B \u8ddf\u5230 300');
cl();     eq(S.street,1,'C \u8ddf\u5230 300 \u2192 \u8fdb\u5165\u7ffb\u724c\uff08D \u5df2\u5168\u4e0b\uff09');
eq(toRiver(),'showdown','\u2192 \u644a\u724c');
eq(potStr(),'400:A/B/C/D | 600:A/B/C','\u4e3b\u6c60 4x100=400\uff0c\u8fb9\u6c60 3x200=600');
S.pots[0].winners=[idOf('D')]; S.pots[1].winners=[idOf('A')]; confirmWin();
eq(chips(),[1300,700,700,400],'D \u8d62\u4e3b\u6c60 400\uff0cA \u8d62\u8fb9\u6c60 600');
eq(total(),3100,'\u5b88\u6052 3100');

sec('8. \u644a\u724c\u5e73\u5206\uff08\u5947\u6570\u4f59\u6570\u7ed9\u9996\u4f4d\uff09');
G();
cl(); cl(); ck();
eq(toRiver(),'showdown','\u2192 \u644a\u724c');
eq(S.pot,30,'\u5e95\u6c60 30');
settle(['A','C']); eq(chips(),[1005,990,1005],'A/C \u5404 15');

sec('9. \u5f03\u724c\u81f4\u8d62\uff08\u65e0\u9700\u644a\u724c\uff09');
G();
fd(); eq(who(),'B','A \u5f03 \u2192 B');
fd(); eq(S.phase,'showdown','C \u4e5f\u5f03 \u2192 \u53ea\u5269 C');
eq(S.pots.length,1,'\u5355\u4e00\u6c60');
settle('C'); eq(chips(),[1000,995,1005],'C \u6536\u4e0b\u6c60\u4e2d 15');
eq(total(),3000,'\u5b88\u6052 3000');

sec('10. \u6293\u5934\u4f4d\uff08live straddle = \u989d\u5916 2BB\uff0c\u5927\u76f2\u987a\u5ef6\uff09');
G({count:4,names:['A','B','C','D'],straddleSeat:2});
eq(S.players.map(p=>p.street),[0,5,20,10],'B \u5c0f\u76f25 / C \u6293\u593420 / D \u5927\u76f210');
eq(S.streetBet,20,'\u672c\u8f6e\u6700\u9ad8 = \u6293\u5934 20');
eq(inPot(),35,'\u5e95\u6c60 35');
eq(who(),'A','UTG = A');
rt(60); eq(who(),'B','A \u52a0\u6ce8\u5230 60 \u2192 B');
cl();     eq(who(),'C','B \u8ddf\u5230 60');
cl();     eq(who(),'D','C \u8ddf\u5230 60');
cl();     eq(S.street,1,'D \u8ddf\u5230 60 \u2192 \u95ed\u5408\u8f6e\uff0c\u8fdb\u5165\u7ffb\u724c');
eq(who(),'B','\u7ffb\u540e\u5c0f\u76f2\u4f4d\u5148\u52a8');
eq(toRiver(),'showdown','\u8fc7\u724c\u5230\u6cb3\u724c');

sec('11. \u4e24\u4eba\u684c\uff08\u6309\u94ae=\u5c0f\u76f2\uff0c\u7ffb\u540e\u5927\u76f2\u5148\u52a8\uff09');
G({count:2,names:['A','B']});
eq(at(S.buttonSeat).name,'A','BTN = A');
eq(S.players.map(p=>p.street),[5,10],'A \u5c0f\u76f25 / B \u5927\u76f210');
eq(who(),'A','\u4e24\u4eba\u684c\u6309\u94ae\u4f4d(\u5c0f\u76f2)\u5148\u52a8');
cl(); eq(who(),'B','A \u8ddf\u5230 10 \u2192 B');
ck(); eq(S.street,1,'B \u8fc7\u724c \u2192 \u8fdb\u5165\u7ffb\u724c');
eq(who(),'B','\u7ffb\u724c\u540e\u5927\u76f2\u5148\u52a8');
eq(toRiver(),'showdown','\u8fc7\u724c\u5230\u6cb3\u724c');
eq(S.pot,20,'\u5e95\u6c60 10x2 = 20\uff08\u7ffb\u540e\u5168\u8fc7\u724c\uff09');
settle('B'); eq(chips(),[990,1010],'B \u8d62 20');
eq(total(),2000,'\u5b88\u6052 2000');

sec('12. \u5927\u76f2\u77ed\u7801\uff08\u76f2\u6ce8\u5373\u5168\u4e0b\uff09+ \u5206\u5c42\u6c60');
G({count:3,names:['A','B','C'],stacks:[1000,1000,5]});
eq(N_('C').allIn,true,'C \u5927\u76f2\u53ea\u80fd\u4e0b 5\uff08\u5373\u5168\u4e0b\uff09');
eq(S.players.map(p=>p.street),[0,5,5],'A \u672a\u4e0b\u76f2\u6ce8\uff0cB \u5c0f\u76f25\uff0cC \u5927\u76f2 5');
eq(S.streetBet,10,'\u672c\u8f6e\u6700\u9ad8 = \u5927\u76f210');
eq(who(),'A','UTG = A');
rt(300); eq(who(),'B','A \u52a0\u6ce8\u5230 300 \u2192 B');
cl();     eq(S.street,1,'B \u8ddf\u5230 300 \u2192 \u8fdb\u5165\u7ffb\u724c\uff08C \u5df2\u5168\u4e0b\uff09');
eq(toRiver(),'showdown','\u8fc7\u724c\u5230\u6cb3\u724c');
eq(potStr(),'15:A/B/C | 590:A/B','\u4e3b\u6c60 3x5=15\uff0c\u8fb9\u6c60 2x295=590');
S.pots[0].winners=[idOf('A')]; S.pots[1].winners=[idOf('A')]; confirmWin();
eq(chips(),[1305,700,0],'A \u901a\u5403 605');
eq(total(),2005,'\u5b88\u6052 2005\uff08A \u53ea\u4e70\u4e86 1000\uff09');

sec('13. \u94b1\u82b1\u62b5\u5e95\u81ea\u52a8\u9000\u684c');
G({buyin:1000});
rt(1000); cl(); cl();
settle(['A','B']); eq(chips(),[1500,1500,0],'A/B \u5e73\u5206 3000\uff0cC \u5f52\u96f6');
nextHand();
eq(S.players.length,2,'C \u88ab\u79fb\u51fa');
eq(S.players.map(p=>p.name),['A','B'],'\u5269\u4f59 A\u3001B');
eq(S.handNo,2,'\u624b\u6570\u7ee7\u7eed\u7d2f\u52a0');
eq(total(),3000,'\u5b88\u6052 3000');

sec('14. \u64a4\u9500');
G();
const c0=chips(), p0=inPot();
eq(S.streetBet,10,'\u521d\u59cb\u672c\u8f6e\u6700\u9ad8 = \u5927\u76f210');
rt(40); eq(S.streetBet,40,'A \u52a0\u6ce8\u5230 40');
undo();
eq(S.streetBet,10,'\u64a4\u9500 \u2192 \u56de\u5230 10');
eq(chips(),c0,'\u94ce\u724c\u8fd8\u539f');
eq(inPot(),p0,'\u5e95\u6c60\u8fd8\u539f');
eq(who(),'A','\u4ecd\u8f6e\u5230 A');
cl(); undo();
eq(chips(),c0,'\u518d\u6b21\u64a4\u9500\u4e5f\u8fd8\u539f');
eq(who(),'A','\u8ddf\u6ce8\u4e5f\u88ab\u64a4\u9500');

sec('15. \u5c11\u4e8e 2 \u4eba\u65f6\u6e38\u620f\u7ed3\u675f');
G({count:2,names:['A','B']});
N_('B').chips=0; N_('B').street=0; nextHand();   // 先把本轮已投的也清掉，模拟真的碰碎
eq(S.phase,'over','\u53ea\u5269 1 \u4eba \u2192 \u6e38\u620f\u7ed3\u675f');
eq(S.players.map(p=>p.name),['A'],'\u53ea\u5269 A');

sec('16. \u4ea4\u6613\u7ed3\u7b97\u540e\u80fd\u6b63\u5e38\u5f00\u65b0\u4e00\u624b\uff08UI \u8def\u5f84\uff09');
G();
rt(20); cl(); cl(); toRiver();   // A \u52a0\u6ce8\u5230 20\uff0c\u5168\u4f53\u8ddf\u6ceb\u8d70\u5b8c\u5230\u644a\u724c\uff08\u65e0\u5168\u4e0b\uff09
eq(S.phase,'showdown','\u4e09\u65b9\u8ddf\u6ceb\u540e\u8fdb\u5165\u644a\u724c');
settle(['A']);                   // \u6a21\u62df confirmWin()\uff1aA \u72ec\u8d62\u5e95\u6c60
eq(S.phase,'showdown','\u7ed3\u7b97\u540e phase \u4ecd\u4e3a showdown\uff08\u7b49\u5f85\u70b9\u4e0b\u4e00\u624b\uff09');
nextHand();                     // \u6a21\u62df\u70b9\u300c\u4e0b\u4e00\u624b\u300d
eq(S.phase,'playing','\u4e0b\u4e00\u624b\u540e\u56de\u5230 playing\uff08\u4fee\u590d\u524d\u4f1a\u5361\u6b7b\uff09');
eq(S.handNo,2,'\u624b\u6570\u5230 2');
while (S.phase==='playing' && S.current!==null && S.street===0) cl();   // \u65b0\u4e00\u624b\u771f\u7684\u80fd\u7ee7\u7eed\u884c\u52a8\u5230\u4e0b\u4e00\u5708
eq(S.street,1,'\u65b0\u4e00\u624b\u5b8c\u6210\u540e\u771f\u7684\u8fdb\u5165\u4e0b\u4e00\u5708');
eq(total(),3000,'\u5b88\u6052 3000');
sec('17. 快捷额度直接按底池比例计算（0.11alpha 需求）');
// 0.1alpha 公式 = toCall + 底池×比例；0.11alpha 公式 = 底池×比例
G();
S.players[0].street=50; S.players[0].chips=950;
S.players[1].street=0;  S.players[1].chips=1000;
S.players[2].street=0;  S.players[2].chips=1000;
S.pot=50; S.streetBet=50; S.current=1; S.street=0; S.phase='playing';
S.players.forEach(p=>{p.folded=false;p.allIn=false;p.acted=false;});
let o = PE.betOptions(S, S.current); let P = S.players[S.current];
const byKey = k => { const f=o.options.find(x=>x.key===k); return f?f.value:undefined; };
eq(PE.boardPot(S), 100, '底池 100');
eq(P.name, 'B', '轮到 B');
eq(o.toCall, 50, 'B 需跟 50');
eq(byKey('1/2池'), 50, '1/2 池 = 100/2 = 50（0.1alpha 会算成 50+50=100）');
eq(byKey('1/3池'), undefined, '1/3 池 = 33 舍零头 30 < 跟注 50 -> 打不出来，不生成');
eq(byKey('3/4池'), 70, '3/4 池 = 75 舍零头 70（0.1alpha 会算成 120）');
eq(byKey('满池'), 100, '满池 = 100（0.1alpha 会算成 150）');
eq(byKey('allin'), 1000, 'ALL IN = 后手 1000');
eq(o.options.every(x=>x.value % S.bb===0), true, '所有快捷额度都是大盲(' + S.bb + ')整数倍');
eq(o.options.every(x=>x.value >= o.minTo && x.value <= o.maxTo), true, '全部落在 [跟注, 后手] 内');

// 底池 110：1/2 池 = 55 -> 舍零头 50
S.pot=60;   // boardPot = 60 + 50 = 110
o = PE.betOptions(S, S.current);
eq(PE.boardPot(S), 110, '底池 110');
eq(byKey('1/3池'), undefined, '1/3 池 = 36.7 舍零头 30 < 跟注 50 -> 不生成');
eq(byKey('1/2池'), 50, '1/2 池 = 55 舍零头 50');
eq(byKey('3/4池'), 80, '3/4 池 = 82.5 舍零头 80');
eq(byKey('满池'), 110, '满池 = 110');

// 翻后无跟注：纯底池比例
G({count:4, names:['A','B','C','D']});
S.street=1; S.pot=100; S.streetBet=0; S.current=1;
S.players.forEach(p=>{p.street=0;p.folded=false;p.allIn=false;p.acted=false;});
o = PE.betOptions(S, S.current);
eq(o.toCall, 0, '翻后无需跟注');
eq(byKey('1/3池'), 30, '1/3 池 = 30');
eq(byKey('1/2池'), 50, '1/2 池 = 50');
eq(byKey('3/4池'), 70, '3/4 池 = 75 舍零头 70');
eq(byKey('满池'), 100, '满池 = 100');

// 舍零头（0.1alpha 需求 1）仍然生效
eq(PE.roundBB(S, 95), 90, 'roundBB(95) = 90');
eq(PE.roundBB(S, 100), 100, 'roundBB(100) = 100');
eq(PE.roundBB(S, 10), 10, 'roundBB(10) = 10');

// 真实对局：翻牌底池 90
G();
rt(30); cl(); cl();
eq(S.street, 1, '进入翻牌');
eq(PE.boardPot(S), 90, '底池 90');
o = PE.betOptions(S, S.current);
eq(byKey('1/3池'), 30, '1/3 池 = 30');
eq(byKey('1/2池'), 40, '1/2 池 = 45 不是 BB 整数倍 -> 舍零头 40');
eq(byKey('3/4池'), 60, '3/4 池 = 67.5 舍零头 60');
eq(byKey('满池'), 90, '满池 = 90');
eq(o.maxTo, 970, '滑条 100% = 后手 970（已投 30）');

sec('18. 快捷额度不超过后手；后手不够时只剩跟注/全下（需求 1）');
G({stacks:[300,1000,1000]});
o = PE.betOptions(S, S.current);
eq(o.maxTo, 300, 'A 只有 300 后手 -> 滑条上限 300');
eq(byKey('满池'), 10, '底池 15 -> 满池 15 舍零头 10');
eq(byKey('allin'), 300, 'ALL IN = 300 = A 的后手');
eq(o.options.every(x=>x.value >= o.minTo && x.value <= o.maxTo), true, '快捷额度落在 [跟注, 后手] 区间内');

cl();                            // A 跟到 10 -> B
rt(100000);                      // B 想押超大额 -> 被夹到自己的后手
eq(S.players[1].chips, 0, 'B 不能超过后手 -> 全下');
eq(S.players[1].inHand, 1000, 'B 全下 1000（含大盲/跟注部分）');
o = PE.betOptions(S, S.current); P = S.players[S.current];
eq(P.name,'C','轮到 C');
eq(o.toCall, 990, 'C 需跟 990');
eq(o.minTo, 1000, 'C 跟到底就是 1000（超过他 990 的后手 -> 全部投入）');
eq(o.maxTo, 1000, 'C 后手 990 + 已投 10 = 上限 1000');
eq(o.options.map(x=>x.key).join(','), 'call', 'C 只剩跟注（全下）一个合法选择');
eq(o.options[0].value, 1000, 'C 的跟注额就是 1000');

// 翻后大底池 + 短码：快捷额度必须封顶到后手
S.street=1; S.pot=100; S.streetBet=0; S.current=0;
S.players.forEach(p=>{p.street=0;p.folded=false;p.allIn=false;p.acted=false;});
S.players[0].chips=60;
o = PE.betOptions(S, S.current);
eq(o.maxTo, 60, 'A 后手只剩 60 -> 滑条上限 60');
eq(byKey('1/3池'), 30, '1/3 池 = 30（没超后手，原样）');
eq(byKey('3/4池'), undefined, '3/4 池 70 > 后手 60 -> 封顶到 60，与 ALL IN 同额后由 ALL IN 承接');
eq(byKey('满池'), undefined, '满池 100 > 后手 60 -> 不再显示满池，由 ALL IN 承接');
eq(byKey('allin'), 60, 'ALL IN = 60 = 后手');
eq(o.options.every(x=>x.value <= o.maxTo), true, '任何快捷额度都不超过后手');
console.log('\n'+(fails?'X '+fails+' \u9879\u5931\u8d25':'\u5168\u90e8\u901a\u8fc7'));
process.exit(fails?1:0);


