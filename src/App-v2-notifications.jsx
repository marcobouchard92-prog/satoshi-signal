import { useState, useEffect, useRef, useCallback } from 'react'

const C = {
  bg:'#020608', surface:'#070f14', card:'#0a1520', border:'#0e2030',
  accent:'#00c8ff', green:'#00ff7f', red:'#ff2d55', yellow:'#ffd60a',
  text:'#b0ccd8', muted:'#3a5a6a', white:'#f0f8ff',
}

const TIMEFRAMES = [
  { id:'1H', label:'1H', interval:'1m',  limit:60,  desc:'Scalping'  },
  { id:'7D', label:'7D', interval:'1h',  limit:168, desc:'Swing'     },
  { id:'1M', label:'1M', interval:'4h',  limit:180, desc:'Position'  },
  { id:'3M', label:'3M', interval:'1d',  limit:90,  desc:'Mid-term'  },
  { id:'1Y', label:'1Y', interval:'3d',  limit:122, desc:'Long-term' },
]

function calcRSI(prices, period=14) {
  if (prices.length < period+1) return 50
  let ag=0, al=0
  for (let i=1;i<=period;i++){const d=prices[i]-prices[i-1];d>0?ag+=d:al-=d}
  ag/=period; al/=period
  for (let i=period+1;i<prices.length;i++){
    const d=prices[i]-prices[i-1]
    ag=(ag*(period-1)+Math.max(0,d))/period
    al=(al*(period-1)+Math.max(0,-d))/period
  }
  return al===0?100:100-100/(1+ag/al)
}
function calcEMA(prices, period) {
  if (!prices.length) return 0
  if (prices.length<period) return prices[prices.length-1]
  const k=2/(period+1)
  let ema=prices.slice(0,period).reduce((a,b)=>a+b,0)/period
  for (let i=period;i<prices.length;i++) ema=prices[i]*k+ema*(1-k)
  return ema
}
function calcMACD(prices) {
  const macd=calcEMA(prices,12)-calcEMA(prices,26)
  return {macd, signal:macd*0.85, histogram:macd*0.15}
}
function calcBB(prices, period=20) {
  const p=prices[prices.length-1]||0
  if (prices.length<period) return {upper:p*1.02,middle:p,lower:p*0.98,bw:4}
  const sl=prices.slice(-period), mean=sl.reduce((a,b)=>a+b,0)/period
  const std=Math.sqrt(sl.reduce((a,b)=>a+(b-mean)**2,0)/period)
  return {upper:mean+2*std, middle:mean, lower:mean-2*std, bw:(4*std)/mean*100}
}
function genSignal(ind, price, sens='balanced') {
  const {rsi,macd,bb,e9,e21,e50,e200}=ind
  let buy=0, sell=0; const reasons=[]
  if(rsi<30){buy+=25;reasons.push({s:'buy',t:`RSI oversold (${rsi.toFixed(1)})`})}
  else if(rsi<40) buy+=10
  else if(rsi>70){sell+=25;reasons.push({s:'sell',t:`RSI overbought (${rsi.toFixed(1)})`})}
  else if(rsi>60) sell+=10
  if(macd.macd>macd.signal){buy+=20;reasons.push({s:'buy',t:'MACD bullish crossover'})}
  else{sell+=20;reasons.push({s:'sell',t:'MACD bearish crossover'})}
  if(e9>e21&&e21>e50){buy+=15;reasons.push({s:'buy',t:'EMA uptrend (9>21>50)'})}
  else if(e9<e21&&e21<e50){sell+=15;reasons.push({s:'sell',t:'EMA downtrend (9<21<50)'})}
  if(price<=bb.lower){buy+=20;reasons.push({s:'buy',t:'Price at lower Bollinger Band'})}
  else if(price>=bb.upper){sell+=20;reasons.push({s:'sell',t:'Price at upper Bollinger Band'})}
  if(e50>e200){buy+=10;reasons.push({s:'buy',t:'EMA50 > EMA200 (golden zone)'})}
  else{sell+=10;reasons.push({s:'sell',t:'EMA50 < EMA200 (death zone)'})}
  const thr=sens==='conservative'?65:sens==='aggressive'?45:55
  const tot=buy+sell||1, conf=Math.round(Math.max(buy,sell)/tot*100)
  let signal='HOLD'
  if(buy>sell&&conf>thr) signal='BUY'
  else if(sell>buy&&conf>thr) signal='SELL'
  return {signal,conf,buy,sell,reasons}
}

const fmt=(n,d=0)=>Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})
const fmtK=n=>n>=1e9?(n/1e9).toFixed(1)+'B':n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(Math.round(n))

// ── Send notification via Service Worker ─────────────────────────────────────
function notifySignal(signal, price, conf, tf) {
  if (!navigator.serviceWorker?.controller) return
  navigator.serviceWorker.controller.postMessage({
    type: 'SIGNAL_CHANGE', signal, price, conf, tf
  })
}

// ── Components ───────────────────────────────────────────────────────────────
function Sparkline({prices,width=300,height=80,color=C.accent}) {
  if(!prices||prices.length<2) return null
  const mn=Math.min(...prices),mx=Math.max(...prices),rng=mx-mn||1
  const pts=prices.map((p,i)=>`${(i/(prices.length-1))*width},${height-((p-mn)/rng)*(height-4)-2}`).join(' ')
  return (
    <svg width={width} height={height} style={{display:'block',overflow:'visible'}}>
      <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.2"/>
        <stop offset="100%" stopColor={color} stopOpacity="0"/>
      </linearGradient></defs>
      <path d={`M0,${height} L${pts.split(' ').join(' L')} L${width},${height} Z`} fill="url(#sg)"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  )
}

function RSIArc({value}) {
  const color=value<30?C.green:value>70?C.red:C.yellow
  const cx=55,cy=52,r=42
  const arc=(a1,a2,col,sw=6)=>{
    const ax=cx+r*Math.cos(a1),ay=cy+r*Math.sin(a1),bx=cx+r*Math.cos(a2),by=cy+r*Math.sin(a2)
    return <path d={`M${ax},${ay} A${r},${r} 0 0,1 ${bx},${by}`} fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round"/>
  }
  const nd=Math.PI+(value/100)*Math.PI
  return (
    <svg width={110} height={65} style={{overflow:'visible'}}>
      {arc(Math.PI,Math.PI*1.3,'#0a2a0a')}{arc(Math.PI*1.3,Math.PI*1.7,'#1a1a05')}{arc(Math.PI*1.7,Math.PI*2,'#2a0505')}
      {arc(Math.PI,Math.PI*1.3,C.green,3)}{arc(Math.PI*1.3,Math.PI*1.7,C.yellow,3)}{arc(Math.PI*1.7,Math.PI*2,C.red,3)}
      <line x1={cx} y1={cy} x2={cx+r*Math.cos(nd)} y2={cy+r*Math.sin(nd)} stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx={cx} cy={cy} r="4" fill={color}/>
      <text x={cx} y={cy+18} textAnchor="middle" fill={color} fontSize="15" fontWeight="700" fontFamily="monospace">{value.toFixed(1)}</text>
      <text x="8" y="63" fill={C.green} fontSize="8" fontFamily="monospace">OS</text>
      <text x="100" y="63" textAnchor="end" fill={C.red} fontSize="8" fontFamily="monospace">OB</text>
    </svg>
  )
}

function Badge({signal,conf}) {
  const cfg={BUY:{color:C.green,label:'▲  BUY'},SELL:{color:C.red,label:'▼  SELL'},HOLD:{color:C.yellow,label:'◆  HOLD'}}[signal]||{color:C.muted,label:signal}
  return (
    <div style={{display:'inline-flex',flexDirection:'column',alignItems:'center',gap:5,padding:'14px 28px',border:`1.5px solid ${cfg.color}`,borderRadius:10,background:`${cfg.color}12`,animation:'pulse 2s ease-in-out infinite'}}>
      <span style={{color:cfg.color,fontFamily:'monospace',fontSize:24,fontWeight:800,letterSpacing:4}}>{cfg.label}</span>
      <span style={{color:`${cfg.color}99`,fontSize:11,fontFamily:'monospace'}}>Confidence {conf}%</span>
    </div>
  )
}

function MACDBars({histogram,width=180,height=50}) {
  const bars=Array.from({length:22},(_,i)=>histogram*Math.sin(i*0.5+1)*(0.4+i/22*0.6))
  const max=Math.max(...bars.map(Math.abs),0.01),mid=height/2,bw=width/bars.length-1
  return (
    <svg width={width} height={height}>
      <line x1="0" y1={mid} x2={width} y2={mid} stroke={C.border} strokeWidth="1"/>
      {bars.map((v,i)=>{const h=(Math.abs(v)/max)*(mid-3);return <rect key={i} x={i*(bw+1)} y={v>=0?mid-h:mid} width={bw} height={Math.max(1,h)} fill={v>=0?C.green:C.red} opacity={0.35+(i/bars.length)*0.65} rx="1"/>})}
    </svg>
  )
}

export default function App() {
  const [tf, setTf] = useState(TIMEFRAMES[1])
  const [sens, setSens] = useState('balanced')
  const [rsiP, setRsiP] = useState(14)
  const [tab, setTab] = useState('dashboard')
  const [prices, setPrices] = useState([])
  const [ticker, setTicker] = useState(null)
  const [status, setStatus] = useState('Connecting...')
  const [sigHistory, setSigHistory] = useState([])
  const [alertLog, setAlertLog] = useState([])
  const [aiText, setAiText] = useState('')
  const [aiLoad, setAiLoad] = useState(false)
  const [notifStatus, setNotifStatus] = useState('default')
  const [swReady, setSwReady] = useState(false)
  const lastSig = useRef(null)

  // Register Service Worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => {
          setSwReady(true)
          console.log('SW registered:', reg.scope)
        })
        .catch(err => console.log('SW error:', err))
    }
    if ('Notification' in window) {
      setNotifStatus(Notification.permission)
    } else {
      setNotifStatus('unsupported')
    }
  }, [])

  const requestNotif = useCallback(async () => {
    if (!('Notification' in window)) { setNotifStatus('unsupported'); return }
    const perm = await Notification.requestPermission()
    setNotifStatus(perm)
    if (perm === 'granted' && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SIGNAL_CHANGE',
        signal: 'BUY',
        price: 84000,
        conf: 72,
        tf: 'TEST'
      })
    }
  }, [])

  const fetchData = useCallback(async () => {
    try {
      const [kRes, tRes] = await Promise.all([
        fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${tf.interval}&limit=${tf.limit}`),
        fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT')
      ])
      const kData = await kRes.json()
      const tData = await tRes.json()
      setPrices(kData.map(k => parseFloat(k[4])))
      setTicker({
        price: parseFloat(tData.lastPrice),
        open:  parseFloat(tData.openPrice),
        high:  parseFloat(tData.highPrice),
        low:   parseFloat(tData.lowPrice),
        volume:parseFloat(tData.quoteVolume),
        change:parseFloat(tData.priceChange),
        changePct:parseFloat(tData.priceChangePercent),
      })
      setStatus('LIVE · ' + new Date().toLocaleTimeString())
    } catch { setStatus('Retrying...') }
  }, [tf])

  useEffect(() => { fetchData() }, [tf])
  useEffect(() => {
    const t = setInterval(fetchData, tf.id==='1H' ? 15000 : 60000)
    return () => clearInterval(t)
  }, [tf, fetchData])

  const cur = ticker?.price || prices[prices.length-1] || 0
  const chgPct = ticker?.changePct || 0
  const chgColor = chgPct>=0 ? C.green : C.red

  const ind = prices.length > 30 ? {
    rsi: calcRSI(prices, rsiP), macd: calcMACD(prices), bb: calcBB(prices),
    e9:calcEMA(prices,9), e21:calcEMA(prices,21),
    e50:calcEMA(prices,50), e200:calcEMA(prices,Math.min(200,prices.length-1)),
  } : null

  const sig = ind ? genSignal(ind, cur, sens) : {signal:'HOLD',conf:50,buy:0,sell:0,reasons:[]}

  useEffect(() => {
    if (!ind || !cur) return
    const {signal, conf} = sig
    if (signal !== lastSig.current) {
      const prev = lastSig.current
      lastSig.current = signal
      if (signal !== 'HOLD') {
        setSigHistory(h=>[{signal,conf,price:cur,time:new Date().toLocaleTimeString(),tf:tf.label},...h].slice(0,30))
        // Send via Service Worker (works in background)
        if (notifStatus === 'granted') {
          notifySignal(signal, cur, conf, tf.label)
        }
      }
      if (prev !== null) {
        setAlertLog(l=>[{
          msg: prev ? `${prev} → ${signal}` : `Nouveau signal: ${signal}`,
          signal, price: cur,
          time: new Date().toLocaleTimeString()
        },...l].slice(0,20))
      }
    }
  }, [sig.signal, cur, notifStatus])

  const runAI = useCallback(async () => {
    if (!ind) return
    setAiLoad(true); setAiText('')
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          model:'claude-sonnet-4-20250514', max_tokens:1000,
          messages:[{role:'user',content:`Expert Bitcoin analyst. Real Binance data, ${tf.label} (${tf.desc}). 4-5 sentences.
BTC: $${fmt(cur)} | 24h: ${chgPct.toFixed(2)}% | H:$${fmt(ticker?.high||0)} L:$${fmt(ticker?.low||0)} Vol:$${fmtK(ticker?.volume||0)}
RSI(${rsiP}):${ind.rsi.toFixed(1)} | MACD:${ind.macd.macd.toFixed(0)}/${ind.macd.signal.toFixed(0)}
EMA9/21/50/200:$${fmt(ind.e9)}/$${fmt(ind.e21)}/$${fmt(ind.e50)}/$${fmt(ind.e200)}
BB:U$${fmt(ind.bb.upper)} M$${fmt(ind.bb.middle)} L$${fmt(ind.bb.lower)} BW:${ind.bb.bw.toFixed(1)}%
Signal:${sig.signal}@${sig.conf}% Mode:${sens}
Analysis:`}],
        }),
      })
      const d=await res.json()
      setAiText(d.content?.map(b=>b.text||'').join('')||'No response.')
    } catch { setAiText('Connection failed.') }
    finally { setAiLoad(false) }
  }, [ind,cur,chgPct,ticker,sig,sens,tf,rsiP])

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&family=Orbitron:wght@700;900&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#020608;color:#b0ccd8;font-family:'JetBrains Mono','Courier New',monospace}
    ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#0e2030;border-radius:2px}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.8}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.1}}
    @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
    .tab{background:none;border:none;cursor:pointer;padding:10px 16px;border-bottom:2px solid transparent;font-family:inherit;font-size:11px;letter-spacing:2px;text-transform:uppercase;transition:all .2s;color:#3a5a6a}
    .tab:hover{color:#00c8ff}.tab.on{color:#00c8ff;border-bottom-color:#00c8ff}
    .tf{background:none;border:1px solid #0e2030;border-radius:6px;padding:5px 10px;font-family:inherit;font-size:10px;cursor:pointer;transition:all .2s;color:#3a5a6a;text-align:center}
    .tf:hover{border-color:#00c8ff44;color:#00c8ff88}.tf.on{border-color:#00c8ff;color:#00c8ff;background:#00c8ff11}
    .card{background:#0a1520;border:1px solid #0e2030;border-radius:12px;padding:16px}
    .sens{background:none;border:1px solid #0e2030;border-radius:8px;padding:10px 14px;font-family:inherit;font-size:11px;cursor:pointer;transition:all .2s;color:#3a5a6a;text-align:left;width:100%;margin-bottom:10px}
    .sens.on{border-color:#00c8ff;color:#00c8ff;background:#00c8ff0a}
    .ir{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #0e203044}
    .ir:last-child{border:none}
    .cbtn{width:32px;height:32px;background:#0e2030;border:none;border-radius:6px;color:#b0ccd8;font-size:18px;cursor:pointer}
  `

  const notifColor = notifStatus==='granted' ? C.green : notifStatus==='denied' ? C.red : C.yellow

  return (
    <div style={{minHeight:'100vh',background:C.bg}}>
      <style>{css}</style>

      {/* Header */}
      <div style={{borderBottom:`1px solid ${C.border}`,background:`${C.surface}ee`,backdropFilter:'blur(12px)',position:'sticky',top:0,zIndex:100}}>
        <div style={{maxWidth:1100,margin:'0 auto',padding:'0 18px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 0'}}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:34,height:34,borderRadius:'50%',background:`${C.accent}18`,border:`1px solid ${C.accent}33`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>₿</div>
              <div>
                <div style={{fontFamily:"'Orbitron',monospace",fontSize:13,fontWeight:900,color:C.accent,letterSpacing:3}}>SATOSHI</div>
                <div style={{fontSize:8,color:C.muted,letterSpacing:2}}>BINANCE REAL-TIME · BTC/USDT</div>
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:14}}>
              <button onClick={requestNotif} style={{background:'none',border:`1px solid ${notifColor}44`,borderRadius:8,padding:'6px 10px',cursor:'pointer',fontSize:11,color:notifColor,fontFamily:'monospace',display:'flex',alignItems:'center',gap:6}}>
                <span>{notifStatus==='granted'?'🔔':'🔕'}</span>
                <span style={{fontSize:9}}>{notifStatus==='granted'?'ON':'Activer'}</span>
              </button>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:22,fontWeight:900,color:C.white,fontFamily:"'Orbitron',monospace"}}>
                  {cur ? `$${fmt(cur)}` : <span style={{fontSize:14,color:C.muted}}>Loading...</span>}
                </div>
                {cur>0 && <div style={{fontSize:11,color:chgColor}}>{chgPct>=0?'▲':'▼'} {Math.abs(chgPct).toFixed(2)}% (24h)</div>}
              </div>
              <div style={{textAlign:'center'}}>
                <div style={{width:8,height:8,borderRadius:'50%',background:status.includes('LIVE')?C.green:C.yellow,boxShadow:`0 0 8px ${status.includes('LIVE')?C.green:C.yellow}`,margin:'0 auto 3px',animation:'blink 2s ease-in-out infinite'}}/>
                <div style={{fontSize:7,color:C.muted}}>{status.includes('LIVE')?'LIVE':'...'}</div>
              </div>
            </div>
          </div>
          <div style={{display:'flex',gap:8,paddingBottom:10,alignItems:'center'}}>
            <span style={{fontSize:9,color:C.muted,letterSpacing:2,marginRight:4,flexShrink:0}}>TIMEFRAME</span>
            {TIMEFRAMES.map(t=>(
              <button key={t.id} className={`tf ${tf.id===t.id?'on':''}`} onClick={()=>{setTf(t);setPrices([]);setTicker(null)}}>
                <div style={{fontWeight:700}}>{t.label}</div>
                <div style={{fontSize:8,opacity:.6}}>{t.desc}</div>
              </button>
            ))}
          </div>
          <div style={{display:'flex'}}>
            {[['dashboard','⬡ Dashboard'],['signals','⚡ Signals'],['alerts','🔔 Alerts'],['settings','⚙ Settings']].map(([id,lbl])=>(
              <button key={id} className={`tab ${tab===id?'on':''}`} onClick={()=>setTab(id)}>{lbl}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{maxWidth:1100,margin:'0 auto',padding:'18px 18px 80px'}}>

        {tab==='dashboard' && (
          <div style={{display:'grid',gridTemplateColumns:'300px 1fr',gap:14,animation:'fadeIn .3s ease'}}>
            <div className="card" style={{borderColor:`${C.accent}22`,background:'linear-gradient(135deg,#0a1520,#0d1f30)',display:'flex',flexDirection:'column',gap:14}}>
              <div style={{fontSize:9,color:C.muted,letterSpacing:3}}>SIGNAL — {tf.label} / {tf.desc.toUpperCase()}</div>
              <div style={{display:'flex',justifyContent:'center'}}><Badge signal={sig.signal} conf={sig.conf}/></div>
              <div style={{display:'flex',gap:8}}>
                {[['BUY',sig.buy,C.green],['SELL',sig.sell,C.red]].map(([l,v,c])=>(
                  <div key={l} style={{flex:1,background:`${c}11`,border:`1px solid ${c}33`,borderRadius:8,padding:10,textAlign:'center'}}>
                    <div style={{fontSize:9,color:C.muted,marginBottom:3}}>{l}</div>
                    <div style={{fontSize:20,color:c,fontWeight:800}}>{v}</div>
                  </div>
                ))}
              </div>
              <div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:10,marginBottom:5}}>
                  <span style={{color:C.muted}}>Strength</span><span style={{color:C.accent}}>{sig.conf}%</span>
                </div>
                <div style={{height:5,background:C.border,borderRadius:3,overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${sig.conf}%`,background:sig.signal==='BUY'?C.green:sig.signal==='SELL'?C.red:C.yellow,borderRadius:3,transition:'width .6s'}}/>
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:5}}>
                {sig.reasons.slice(0,5).map((r,i)=>(
                  <div key={i} style={{display:'flex',gap:8,alignItems:'center',fontSize:10,color:C.text}}>
                    <div style={{width:5,height:5,borderRadius:'50%',background:r.s==='buy'?C.green:C.red,flexShrink:0}}/>{r.t}
                  </div>
                ))}
              </div>
              {/* Notif status in card */}
              <div style={{background:`${notifColor}0a`,border:`1px solid ${notifColor}33`,borderRadius:8,padding:'10px 12px',fontSize:10}}>
                <span style={{color:notifColor}}>
                  {notifStatus==='granted' ? '🔔 Notifications actives — alertes BUY/SELL activées' :
                   notifStatus==='denied'  ? '🔕 Notifications bloquées — vérifie les paramètres Chrome' :
                   notifStatus==='unsupported' ? '⚠️ Non supporté sur ce navigateur' :
                   '🔔 Clique sur "Activer" en haut pour les notifications'}
                </span>
              </div>
              <div style={{fontSize:9,color:C.muted,textAlign:'center'}}>{status}</div>
            </div>

            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div className="card">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
                  <div>
                    <div style={{fontSize:9,color:C.muted,letterSpacing:2,marginBottom:3}}>BTC/USDT · Binance · {tf.label}</div>
                    <div style={{fontSize:24,fontWeight:900,color:C.white,fontFamily:"'Orbitron',monospace"}}>{cur?`$${fmt(cur)}`:'Loading...'}</div>
                    {ticker&&<div style={{fontSize:12,color:chgColor,marginTop:2}}>{chgPct>=0?'▲':'▼'} ${fmt(Math.abs(ticker.change))} ({Math.abs(chgPct).toFixed(2)}%)</div>}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'5px 14px',textAlign:'right'}}>
                    {[['HIGH',ticker?.high,C.green],['LOW',ticker?.low,C.red],['VOL',ticker?.volume,C.text],['OPEN',ticker?.open,C.accent]].map(([l,v,c])=>(
                      <div key={l}><div style={{fontSize:8,color:C.muted}}>{l}</div>
                        <div style={{fontSize:11,color:c,fontWeight:700}}>{v?(l==='VOL'?'$'+fmtK(v):'$'+fmt(v)):'—'}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {prices.length>2 ? <Sparkline prices={prices} width={680} height={100} color={chgColor}/>
                  : <div style={{height:100,display:'flex',alignItems:'center',justifyContent:'center',color:C.muted,fontSize:12}}>⏳ Loading...</div>}
                {ind&&(
                  <div style={{display:'flex',gap:14,marginTop:10,flexWrap:'wrap'}}>
                    {[['EMA9',ind.e9,'#ff6b35'],['EMA21',ind.e21,'#bf5af2'],['EMA50',ind.e50,C.accent],['EMA200',ind.e200,C.yellow]].map(([l,v,c])=>(
                      <div key={l} style={{display:'flex',alignItems:'center',gap:5,fontSize:10}}>
                        <div style={{width:14,height:2,background:c,borderRadius:1}}/>
                        <span style={{color:C.muted}}>{l}</span><span style={{color:c}}>${fmt(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
                <div className="card">
                  <div style={{fontSize:9,color:C.muted,letterSpacing:2,marginBottom:10}}>RSI ({rsiP})</div>
                  {ind?(<>
                    <div style={{display:'flex',justifyContent:'center'}}><RSIArc value={ind.rsi}/></div>
                    <div style={{height:4,background:`linear-gradient(90deg,${C.green},${C.yellow},${C.red})`,borderRadius:2,marginTop:8,position:'relative'}}>
                      <div style={{position:'absolute',left:`${Math.max(2,Math.min(97,ind.rsi))}%`,top:-4,transform:'translateX(-50%)',width:12,height:12,borderRadius:'50%',background:C.white,border:`2px solid ${C.accent}`,transition:'left .5s'}}/>
                    </div>
                    <div style={{textAlign:'center',marginTop:8,fontSize:10,color:ind.rsi<30?C.green:ind.rsi>70?C.red:C.yellow}}>
                      {ind.rsi<30?'OVERSOLD':ind.rsi>70?'OVERBOUGHT':'NEUTRAL'}
                    </div>
                  </>):<div style={{color:C.muted,fontSize:11,textAlign:'center',padding:'20px 0'}}>⏳</div>}
                </div>
                <div className="card">
                  <div style={{fontSize:9,color:C.muted,letterSpacing:2,marginBottom:10}}>MACD</div>
                  {ind?(<>
                    <MACDBars histogram={ind.macd.histogram} width={200} height={55}/>
                    {[['MACD',ind.macd.macd,C.accent],['Signal',ind.macd.signal,C.yellow],['Histo',ind.macd.histogram,ind.macd.histogram>=0?C.green:C.red]].map(([l,v,c])=>(
                      <div key={l} className="ir"><span style={{fontSize:10,color:C.muted}}>{l}</span><span style={{fontSize:11,color:c,fontWeight:700}}>{v.toFixed(0)}</span></div>
                    ))}
                  </>):<div style={{color:C.muted,fontSize:11,textAlign:'center',padding:'20px 0'}}>⏳</div>}
                </div>
              </div>
              {ind&&(
                <div className="card">
                  <div style={{fontSize:9,color:C.muted,letterSpacing:2,marginBottom:12}}>BOLLINGER BANDS</div>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:12}}>
                    {[['Upper',ind.bb.upper,C.red],['Price',cur,C.accent],['Middle',ind.bb.middle,C.muted],['Lower',ind.bb.lower,C.green]].map(([l,v,c])=>(
                      <div key={l} style={{textAlign:'center'}}>
                        <div style={{fontSize:9,color:C.muted,marginBottom:4}}>{l}</div>
                        <div style={{fontSize:12,color:c,fontWeight:700}}>${fmt(v)}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{height:6,background:C.border,borderRadius:3,position:'relative'}}>
                    <div style={{position:'absolute',left:`${Math.max(1,Math.min(98,(cur-ind.bb.lower)/(ind.bb.upper-ind.bb.lower)*100))}%`,top:-3,transform:'translateX(-50%)',width:12,height:12,borderRadius:'50%',background:C.accent,border:`2px solid ${C.bg}`,transition:'left .5s'}}/>
                  </div>
                  <div style={{fontSize:10,color:C.muted,marginTop:8}}>BW: <span style={{color:C.accent}}>{ind.bb.bw.toFixed(1)}%</span></div>
                </div>
              )}
            </div>

            <div className="card" style={{gridColumn:'1 / 3',borderColor:`${C.accent}22`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <div>
                  <div style={{fontSize:10,color:C.accent,letterSpacing:3,fontWeight:700}}>⬡ AI ANALYSIS — CLAUDE</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:2}}>{tf.label} — {tf.desc}</div>
                </div>
                <button onClick={runAI} disabled={aiLoad||!ind} style={{background:`${C.accent}18`,border:`1px solid ${C.accent}`,color:C.accent,padding:'10px 18px',borderRadius:8,fontFamily:'inherit',fontSize:11,cursor:'pointer',opacity:(!ind||aiLoad)?.5:1}}>
                  {aiLoad?'Analyzing...':'Run AI Analysis'}
                </button>
              </div>
              {aiText
                ?<div style={{background:C.surface,borderRadius:8,padding:16,fontSize:13,lineHeight:1.8,color:C.text,whiteSpace:'pre-wrap',borderLeft:`3px solid ${C.accent}`}}>{aiText}</div>
                :<div style={{color:C.muted,fontSize:12,textAlign:'center',padding:'14px 0'}}>Click "Run AI Analysis" for Claude's read.</div>}
            </div>
          </div>
        )}

        {tab==='signals' && (
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,animation:'fadeIn .3s ease'}}>
            <div className="card" style={{gridColumn:'1 / 3'}}>
              <div style={{fontSize:9,color:C.muted,letterSpacing:3,marginBottom:14}}>SELECT TIMEFRAME</div>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                {TIMEFRAMES.map(t=>(
                  <div key={t.id} onClick={()=>{setTf(t);setPrices([]);setTicker(null)}} style={{flex:1,minWidth:110,background:tf.id===t.id?`${C.accent}11`:C.surface,border:`1px solid ${tf.id===t.id?C.accent:C.border}`,borderRadius:10,padding:14,cursor:'pointer',textAlign:'center',transition:'all .2s'}}>
                    <div style={{fontSize:18,fontWeight:800,color:tf.id===t.id?C.accent:C.text,fontFamily:"'Orbitron',monospace"}}>{t.label}</div>
                    <div style={{fontSize:11,color:C.muted,marginTop:4}}>{t.desc}</div>
                    <div style={{fontSize:9,color:C.muted,marginTop:2}}>{t.interval} candles</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <div style={{fontSize:9,color:C.muted,letterSpacing:3,marginBottom:14}}>SIGNAL — {tf.label}</div>
              <div style={{display:'flex',justifyContent:'center',marginBottom:14}}><Badge signal={sig.signal} conf={sig.conf}/></div>
              {sig.reasons.map((r,i)=>(
                <div key={i} style={{display:'flex',gap:10,padding:'8px 0',borderBottom:`1px solid ${C.border}44`}}>
                  <div style={{width:6,height:6,borderRadius:'50%',background:r.s==='buy'?C.green:C.red,marginTop:4,flexShrink:0}}/>
                  <div><div style={{fontSize:9,color:r.s==='buy'?C.green:C.red,fontWeight:700}}>{r.s.toUpperCase()}</div><div style={{fontSize:11,color:C.text}}>{r.t}</div></div>
                </div>
              ))}
            </div>
            <div className="card">
              <div style={{fontSize:9,color:C.muted,letterSpacing:3,marginBottom:14}}>SIGNAL HISTORY</div>
              {!sigHistory.length?<div style={{color:C.muted,fontSize:12}}>Waiting...</div>
                :sigHistory.map((s,i)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:`1px solid ${C.border}33`,fontSize:11}}>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <span style={{color:s.signal==='BUY'?C.green:C.red,fontWeight:800}}>{s.signal}</span>
                      <span style={{color:C.muted,fontSize:9}}>{s.time}</span>
                      <span style={{color:C.accent,fontSize:9,background:`${C.accent}11`,padding:'1px 5px',borderRadius:4}}>{s.tf}</span>
                    </div>
                    <div style={{display:'flex',gap:10}}>
                      <span style={{color:C.text}}>${fmt(s.price)}</span>
                      <span style={{color:C.accent}}>{s.conf}%</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {tab==='alerts' && (
          <div style={{display:'flex',flexDirection:'column',gap:14,animation:'fadeIn .3s ease'}}>
            <div className="card" style={{borderColor:`${notifColor}33`}}>
              <div style={{fontSize:10,color:C.accent,letterSpacing:3,fontWeight:700,marginBottom:16}}>🔔 NOTIFICATIONS PUSH</div>
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                <div style={{background:`${notifColor}0a`,border:`1px solid ${notifColor}33`,borderRadius:10,padding:16}}>
                  <div style={{fontSize:13,color:notifColor,fontWeight:700,marginBottom:6}}>
                    {notifStatus==='granted' ? '✅ Notifications activées' :
                     notifStatus==='denied'  ? '❌ Notifications bloquées' :
                     notifStatus==='unsupported' ? '⚠️ Non supporté' : '⏸ Notifications désactivées'}
                  </div>
                  <div style={{fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.7}}>
                    {notifStatus==='granted'
                      ? `Le Service Worker est ${swReady?'actif ✓':'en cours d\'installation...'} — tu recevras une notification push à chaque changement de signal BUY/SELL, même si Chrome est en arrière-plan.`
                      : notifStatus==='denied'
                      ? 'Chrome bloque les notifications. Va dans Paramètres Chrome → Confidentialité → Notifications → cherche ton URL Vercel → Autorise.'
                      : 'Appuie sur le bouton ci-dessous pour activer les alertes push en temps réel.'}
                  </div>
                  {notifStatus !== 'granted' && notifStatus !== 'unsupported' && (
                    <button onClick={requestNotif} style={{background:`${C.accent}22`,border:`1px solid ${C.accent}`,color:C.accent,padding:'12px 20px',borderRadius:8,fontFamily:'monospace',fontSize:12,cursor:'pointer',width:'100%'}}>
                      🔔 Activer les notifications push
                    </button>
                  )}
                  {notifStatus==='granted' && (
                    <button onClick={()=>notifySignal('BUY', cur||84000, 75, tf.label)} style={{background:`${C.green}11`,border:`1px solid ${C.green}33`,color:C.green,padding:'10px 20px',borderRadius:8,fontFamily:'monospace',fontSize:11,cursor:'pointer',width:'100%'}}>
                      🧪 Tester une notification
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="card">
              <div style={{fontSize:9,color:C.muted,letterSpacing:3,marginBottom:14}}>JOURNAL DES ALERTES ({alertLog.length})</div>
              {!alertLog.length
                ? <div style={{color:C.muted,fontSize:12,textAlign:'center',padding:'24px 0'}}>Aucune alerte — les changements de signal apparaîtront ici</div>
                : alertLog.map((a,i)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:`1px solid ${C.border}33`}}>
                    <div style={{display:'flex',gap:10,alignItems:'center'}}>
                      <span style={{fontSize:18}}>{a.signal==='BUY'?'🟢':a.signal==='SELL'?'🔴':'🟡'}</span>
                      <div>
                        <div style={{fontSize:11,color:a.signal==='BUY'?C.green:a.signal==='SELL'?C.red:C.yellow,fontWeight:700}}>{a.msg}</div>
                        <div style={{fontSize:10,color:C.muted}}>{a.time}</div>
                      </div>
                    </div>
                    <div style={{fontSize:12,color:C.text,fontFamily:'monospace'}}>${fmt(a.price)}</div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {tab==='settings' && (
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,animation:'fadeIn .3s ease'}}>
            <div className="card">
              <div style={{fontSize:9,color:C.muted,letterSpacing:3,marginBottom:16}}>SENSITIVITY MODE</div>
              {[['conservative','Conservative','65% threshold'],['balanced','Balanced','55% threshold'],['aggressive','Aggressive','45% threshold']].map(([v,l,d])=>(
                <button key={v} className={`sens ${sens===v?'on':''}`} onClick={()=>setSens(v)}>
                  <div style={{fontWeight:700,marginBottom:3}}>{l}</div>
                  <div style={{fontSize:10,color:C.muted}}>{d}</div>
                </button>
              ))}
            </div>
            <div className="card">
              <div style={{fontSize:9,color:C.muted,letterSpacing:3,marginBottom:16}}>RSI PERIOD</div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
                <div><div style={{fontSize:13,color:C.text,marginBottom:3}}>Period</div><div style={{fontSize:10,color:C.muted}}>Default: 14</div></div>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <button className="cbtn" onClick={()=>setRsiP(p=>Math.max(5,p-1))}>−</button>
                  <span style={{color:C.accent,fontSize:20,fontWeight:800,minWidth:30,textAlign:'center'}}>{rsiP}</span>
                  <button className="cbtn" onClick={()=>setRsiP(p=>Math.min(50,p+1))}>+</button>
                </div>
              </div>
              <div style={{background:`${C.accent}08`,border:`1px solid ${C.accent}22`,borderRadius:8,padding:14,fontSize:11,color:C.muted,lineHeight:1.7}}>
                ⚠️ <strong style={{color:C.accent}}>Advisory Only</strong><br/>
                Real Binance data. Not financial advice.
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{position:'fixed',bottom:0,left:0,right:0,borderTop:`1px solid ${C.border}`,background:`${C.surface}f0`,backdropFilter:'blur(10px)',padding:'7px 18px',display:'flex',justifyContent:'space-between',fontSize:9,color:C.muted}}>
        <span>SATOSHI — Binance BTC/USDT — Advisory only</span>
        <div style={{display:'flex',gap:14}}>
          <span>{notifStatus==='granted'?'🔔 ON':'🔕'}</span>
          <span>TF: <span style={{color:C.accent}}>{tf.label}</span></span>
          <span>SIGNAL: <span style={{color:sig.signal==='BUY'?C.green:sig.signal==='SELL'?C.red:C.yellow}}>{sig.signal}</span></span>
        </div>
      </div>
    </div>
  )
}
