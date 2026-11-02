const { normalize } = require('./matching.cjs');
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const inRect = (point, rect) => point && point.x >= rect.x && point.x <= rect.x+rect.width && point.y >= rect.y && point.y <= rect.y+rect.height;
const union = boxes => ({ x:Math.min(...boxes.map(b=>b.x)), y:Math.min(...boxes.map(b=>b.y)),
  width:Math.max(...boxes.map(b=>b.x+b.width))-Math.min(...boxes.map(b=>b.x)),
  height:Math.max(...boxes.map(b=>b.y+b.height))-Math.min(...boxes.map(b=>b.y)) });

function splitLine(line) {
  if (!Array.isArray(line.words) || line.words.length < 2) return [line];
  // Windows OCR may combine the three card titles into one line. Split only at
  // large spatial gaps, never from dictionary substrings inside descriptions.
  const words = line.words.slice().sort((a,b)=>a.x-b.x); const groups=[]; let current=[];
  for (const word of words) {
    const previous=current[current.length-1];
    if (previous && word.x-previous.x-previous.width > Math.max(.027,previous.height*1.1)) { groups.push(current); current=[]; }
    current.push(word);
  }
  if (current.length) groups.push(current);
  return groups.map(group=>({ text:group.map(w=>w.text).join(''), ...union(group) }));
}

function locateOffer(result, augments) {
  const observedAt=result?.capturedAt || new Date().toISOString();
  const none=reason=>({ cards:[], confidence:0, reason, observedAt });
  const dictionary=new Map((augments||[]).map(a=>[normalize(a.name),a]));
  const names=[];
  for(const line of (result?.lines||[]).flatMap(splitLine)) {
    const key=normalize(line.text),a=dictionary.get(key);
    if(!a || ![line.x,line.y,line.width,line.height].every(Number.isFinite))continue;
    const center=line.x+line.width/2;
    if(center<.1 || center>.9 || line.y<.2 || line.y>.67 || line.height<.009 || line.height>.07 || line.width>.25 || line.width<.018)continue;
    if(names.some(n=>n.id===a.id&&Math.abs(n.titleRect.x-line.x)<.02&&Math.abs(n.titleRect.y-line.y)<.02))continue;
    names.push({ id:a.id,name:a.name,confidence:100,titleRect:{x:line.x,y:line.y,width:line.width,height:line.height} });
  }
  if(names.length<3)return none('未找到三个完整卡片标题');
  if(names.length>12)return none('标题候选过多，等待清晰画面');
  const triples=[];
  for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++)for(let k=j+1;k<names.length;k++) {
    const cards=[names[i],names[j],names[k]].sort((a,b)=>(a.titleRect.x+a.titleRect.width/2)-(b.titleRect.x+b.titleRect.width/2));
    if(new Set(cards.map(a=>a.id)).size!==3)continue;
    const xs=cards.map(a=>a.titleRect.x+a.titleRect.width/2),ys=cards.map(a=>a.titleRect.y+a.titleRect.height/2);
    const gap1=xs[1]-xs[0],gap2=xs[2]-xs[1],heights=cards.map(a=>a.titleRect.height);
    if(gap1<.14||gap2<.14||gap1>.36||gap2>.36||gap1/gap2<.65||gap1/gap2>1.55)continue;
    if(Math.max(...ys)-Math.min(...ys)>.035||Math.max(...heights)/Math.min(...heights)>1.9)continue;
    if(xs[0]>.4||xs[1]<.35||xs[1]>.65||xs[2]<.6)continue;
    triples.push({cards,spacing:(gap1+gap2)/2,score:heights.reduce((a,b)=>a+b,0)});
  }
  if(!triples.length)return none('文字位置不符合三选一卡片布局');
  // Two equally plausible rows are ambiguous: don't draw badges over them.
  triples.sort((a,b)=>b.score-a.score);
  if(triples.length>1&&triples[1].score>=triples[0].score*.8)return none('卡片布局存在歧义');
  const {cards,spacing}=triples[0];
  return { observedAt, confidence:100, reason:'三个完整名称与横向布局均匹配', cards:cards.map(card=>{
    const title=card.titleRect, width=clamp(spacing*.86,.14,.28),center=title.x+title.width/2;
    const y=clamp(title.y-.14,.12,.53),bottom=Math.min(.76,y+.44);
    const rect={x:clamp(center-width/2,.03,.97-width),y,width,height:bottom-y};
    // The lower edge can contain per-card reroll controls. Only infer picks
    // from the interior of the title/art/description region, never that edge.
    const selectionRect={x:rect.x+rect.width*.06,y:rect.y+rect.height*.06,width:rect.width*.88,height:rect.height*.72};
    return {...card,rect,selectionRect,estimated:true,geometrySource:'ocr-title-grid'};
  }) };
}

class OfferTracker {
  constructor({ stableReads=2, absentReads=2, clickMaxAgeMs=6500, observationTtlMs=6000, now=()=>Date.now() }={}) {
    this.stableReads=stableReads;this.absentReads=absentReads;this.clickMaxAgeMs=clickMaxAgeMs;this.observationTtlMs=observationTtlMs;this.now=now;this.reset();
  }
  reset() {
    this.cards=[];this.candidate=[];this.candidateKey='';this.readCount=0;this.missingCount=0;this.lastSample=null;
    this.pendingSelection=null;this.selected=[];this.lastDown=false;this.lastPressId=null;this.generation=0;
    this.lastSuccessfulAt=null;
    return this.snapshot(false);
  }
  invalidate() {
    const changed=Boolean(this.cards.length||this.pendingSelection||this.readCount);
    this.cards=[];this.candidate=[];this.candidateKey='';this.readCount=0;this.missingCount=0;
    this.pendingSelection=null;this.lastSuccessfulAt=null;
    // Preserve consumed sample identity and selected history. A pointer event
    // carrying the previous OCR object cannot turn invalid geometry fresh.
    return this.snapshot(changed);
  }
  expire(at=this.now()) {
    if(this.lastSuccessfulAt!==null&&at-this.lastSuccessfulAt>this.observationTtlMs)return this.invalidate();
    return this.snapshot(false);
  }
  snapshot(changed=false) { return {cards:this.cards.slice(),stable:this.cards.length===3,pendingSelection:this.pendingSelection,selected:this.selected.slice(),changed,generation:this.generation}; }
  observe(offer,pointer={}) {
    const now=this.now();let changed=this.expire(now).changed;
    const next=offer?.cards?.length===3?offer.cards:[];
    const key=next.map(c=>c.id).join(',');
    // OCR samples and 60ms pointer observations have different clocks.
    const sample=offer?.observedAt ?? offer?.capturedAt ?? offer;
    const fresh=sample!==this.lastSample;
    if(pointer.active===false) { this.pendingSelection=null;this.lastDown=false; return this.snapshot(changed); }
    if(fresh) {
      this.lastSample=sample;
      if(next.length) {
        // Use local processing time, never a caller-supplied timestamp clock.
        this.lastSuccessfulAt=now;
        if(this.missingCount>0)this.pendingSelection=null;
        this.missingCount=0;
        if(this.cards.length&&key!==this.cards.map(c=>c.id).join(',')) {
          // A changed set is a reroll/replacement, not proof that a card was picked.
          this.pendingSelection=null;this.cards=[];changed=true;
        }
        if(key===this.candidateKey)this.readCount++;else{this.candidateKey=key;this.readCount=1;this.candidate=next;}
        if(this.readCount>=this.stableReads) {
          if(!this.cards.length){this.generation++;changed=true;}
          this.cards=next;
        }
      } else {
        this.readCount=0;this.candidateKey='';this.candidate=[];this.missingCount++;
        if(this.missingCount>=this.absentReads) {
          const pending=this.pendingSelection;
          if(pending && now-pending.at<=this.clickMaxAgeMs && now-pending.at>=250 && !this.selected.some(s=>s.generation===pending.generation)) {
            this.selected.push({id:pending.id,name:pending.name,confidence:'inferred',evidence:'稳定三选一卡片内点击后，连续两次识别确认卡片消失',at:now,generation:pending.generation});
          }
          if(this.cards.length)changed=true;
          this.cards=[];this.pendingSelection=null;
        }
      }
    }
    if(this.pendingSelection&&now-this.pendingSelection.at>this.clickMaxAgeMs)this.pendingSelection=null;
    const newPress=pointer.pressId!=null&&pointer.pressId!==this.lastPressId;
    const pressed=pointer.leftPressed===true&&(pointer.pressId==null||newPress)||pointer.leftDown===true&&!this.lastDown;
    if(pressed && this.cards.length===3) {
      const card=this.cards.find(c=>inRect(pointer,c.selectionRect||c.rect));
      if(card)this.pendingSelection={id:card.id,name:card.name,at:now,generation:this.generation,confidence:'pending',evidence:'检测到卡片范围内的鼠标点击'};
      else this.pendingSelection=null;
    }
    this.lastDown=pointer.leftDown===true;if(pointer.pressId!=null)this.lastPressId=pointer.pressId;
    return this.snapshot(changed);
  }
}
module.exports={locateOffer,OfferTracker,splitLine,inRect};
