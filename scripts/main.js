const MODULE_ID = "pokerole-evolution-fx";
const CHANNEL = `module.${MODULE_ID}`;
const active = new Map();
const palettes = {
  electric:[0xffe14a,0xffffff], fire:[0xff6729,0xffcf50], water:[0x2c9eff,0x9deaff],
  psychic:[0xbc65ff,0xffb7f8], grass:[0x43d875,0xd5ff8e], ice:[0x8eeaff,0xffffff],
  dragon:[0x7652ff,0xff8cf2], dark:[0x7b68c4,0xe49cff], ghost:[0x9671d7,0x8be5df],
  fairy:[0xff8fce,0xffedfa], fighting:[0xef694d,0xffe0a1], poison:[0xb44dcd,0xe5b5fa],
  ground:[0xc99a51,0xffdfa2], rock:[0xb6a580,0xffedc5], steel:[0x8aaec1,0xf2faff],
  flying:[0x8fc7ff,0xffffff], bug:[0x9cce4a,0xf1ff9c], normal:[0xf2dcb0,0xffffff]
};
const aliases = {elettro:'electric',fuoco:'fire',acqua:'water',psico:'psychic',erba:'grass',ghiaccio:'ice',drago:'dragon',buio:'dark',spettro:'ghost',folletto:'fairy',lotta:'fighting',veleno:'poison',terra:'ground',roccia:'rock',acciaio:'steel',volante:'flying',coleottero:'bug',normale:'normal'};
function paletteFor(type) {const key=String(type||'normal').toLowerCase().trim();return palettes[aliases[key]||key]||palettes.normal;}
function playTone(phase, colorType, enabled=true) {
  if (!enabled) return;
  try {
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if (!Ctx) return;
    const ctx=new Ctx();
    const now=ctx.currentTime;
    const notes=phase==='charge'?[330,440,550]:phase==='flash'?[700,1050,1450]:[880,660,990];
    notes.forEach((frequency,i)=>{
      const osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.type=phase==='flash'?'sawtooth':'sine';
      osc.frequency.setValueAtTime(frequency,now+i*0.11);
      osc.frequency.exponentialRampToValueAtTime(frequency*1.12,now+i*0.11+0.18);
      gain.gain.setValueAtTime(0.0001,now+i*0.11);
      gain.gain.exponentialRampToValueAtTime(0.055,now+i*0.11+0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001,now+i*0.11+0.3);
      osc.connect(gain).connect(ctx.destination);osc.start(now+i*0.11);osc.stop(now+i*0.11+0.31);
    });
    setTimeout(()=>ctx.close().catch(()=>{}),2000);
  } catch(e) {console.debug('Evolution FX audio unavailable',e);}
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function graphicCircle(radius, color, alpha = 1, width = 0) {
  const g = new PIXI.Graphics();
  // Foundry VTT 13 uses PIXI.Graphics with drawCircle/beginFill/lineStyle.
  // Also accept newer PIXI APIs for forward compatibility.
  if (typeof g.drawCircle === "function") {
    if (width) {
      g.lineStyle(width, color, alpha);
      g.drawCircle(0, 0, radius);
    } else {
      g.beginFill(color, alpha);
      g.drawCircle(0, 0, radius);
      g.endFill();
    }
  } else if (typeof g.circle === "function") {
    if (width) g.circle(0, 0, radius).stroke({ color, alpha, width });
    else g.circle(0, 0, radius).fill({ color, alpha });
  } else {
    throw new Error("Versione PIXI.Graphics non supportata");
  }
  return g;
}

function animateNumber(duration, update) {
  return new Promise(resolve => {
    const started = performance.now();
    const frame = now => {
      const t = clamp((now - started) / duration, 0, 1);
      update(t, 1 - Math.pow(1 - t, 3));
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

async function localEffect({ sceneId, tokenId, phase, eventId, type="normal", sound=true, zoom=true }) {
  if (!canvas?.ready || canvas.scene?.id !== sceneId) return;
  const token = canvas.tokens.get(tokenId);
  if (!token) return;
  const key = `${sceneId}:${tokenId}`;
  const colors = paletteFor(type);
  if (phase === "cleanup") {
    active.get(key)?.cleanup();
    return;
  }
  if (phase === "flash") {
    const state = active.get(key);
    if (!state) return;
    playTone("flash", type, sound);
    await state.flash();
    return;
  }
  if (phase === "reveal") {
    const state = active.get(key);
    if (!state) return;
    playTone("reveal", type, sound);
    await state.reveal();
    return;
  }
  if (phase !== "charge") return;
  active.get(key)?.cleanup();
  playTone("charge", type, sound);

  const center = token.center;
  const radius = Math.max(token.w, token.h) * 0.55;
  const root = new PIXI.Container();
  root.position.set(center.x, center.y);
  root.sortableChildren = true;
  canvas.stage.addChild(root);
  let running = true;
  let finished = false;
  const aura = graphicCircle(radius * 0.9, colors[0], 0.18);
  aura.zIndex = -10;
  root.addChild(aura);
  const ringA = graphicCircle(radius * 0.95, colors[1], 0.92, 5);
  const ringB = graphicCircle(radius * 1.28, colors[0], 0.78, 3);
  root.addChild(ringA, ringB);
  const particles = Array.from({ length: 54 }, (_, i) => {
    const g = graphicCircle(1.5 + Math.random() * 3.5, i % 4 === 0 ? colors[0] : colors[1], 0.9);
    const p = { g, angle: Math.random() * Math.PI * 2, distance: radius * (1.5 + Math.random() * 2), speed: 0.9 + Math.random() * 1.7 };
    root.addChild(g);
    return p;
  });
  // A third, fast-moving type-colored ring for the cinematic build-up.
  const ringC = graphicCircle(radius * 1.52, colors[0], 0.55, 2);
  root.addChild(ringC);
  const flash = graphicCircle(radius * 1.7, 0xffffff, 1);
  flash.alpha = 0;
  flash.zIndex = 20;
  root.addChild(flash);
  const ticker = PIXI.Ticker.shared;
  const tick = tickerInstance => {
    if (!running) return;
    const dt = Math.min(tickerInstance.deltaTime || 1, 3);
    ringA.rotation += 0.012 * dt;
    ringB.rotation -= 0.018 * dt;
    ringC.rotation += 0.027 * dt;
    ringC.scale.set(1 + Math.sin(performance.now()/270)*0.14);
    aura.scale.set(1 + Math.sin(performance.now() / 180) * 0.12);
    for (const p of particles) {
      p.distance -= p.speed * dt;
      if (p.distance < 5) p.distance = radius * (1.6 + Math.random() * 1.8);
      p.angle += 0.006 * dt;
      p.g.position.set(Math.cos(p.angle) * p.distance, Math.sin(p.angle) * p.distance);
    }
  };
  ticker.add(tick);
  const viewBefore = zoom ? {x:canvas.stage.pivot.x,y:canvas.stage.pivot.y,scale:canvas.stage.scale.x} : null;
  if (zoom) {
    try { canvas.animatePan({x:center.x,y:center.y,scale:Math.min(2,Math.max(1.15,canvas.stage.scale.x*1.25)),duration:850}); }
    catch(e) {console.debug('Evolution zoom unavailable',e);}
  }
  const cleanup = () => {
    if (finished) return;
    finished = true;
    running = false;
    ticker.remove(tick);
    if (viewBefore) {
      try {canvas.animatePan({x:viewBefore.x,y:viewBefore.y,scale:viewBefore.scale,duration:850});}
      catch(e) {console.debug('Evolution camera restore unavailable',e);}
    }
    if (!root.destroyed) root.destroy({ children: true });
    if (active.get(key)?.eventId === eventId) active.delete(key);
  };
  const flashIn = async () => {
    await animateNumber(340, (t) => { flash.alpha = t * 0.98; });
  };
  const reveal = async () => {
    try {
      if (flash.alpha < 0.95) await flashIn();
      await animateNumber(950, t => {
        flash.alpha = 0.98 * (1 - t);
        ringA.scale.set(1 + t * 2.5);
        ringB.scale.set(1 + t * 3.2);
        ringC.scale.set(1 + t * 3.8);
        ringC.alpha = 1 - t;
        ringA.alpha = 1 - t;
        ringB.alpha = 1 - t;
        aura.alpha = 1 - t;
      });
    } finally { cleanup(); }
  };
  active.set(key, { eventId, cleanup, reveal, flash: flashIn });
  // Local graphics keep running until reveal/cleanup. Safety timeout.
  wait(18000).then(() => {
    if (active.get(key)?.eventId === eventId) cleanup();
  });
}

Hooks.once("ready", () => {
  game.socket.on(CHANNEL, data => {
    if (!data || data.module !== MODULE_ID) return;
    localEffect(data).catch(e => console.error(`${MODULE_ID}: FX error`, e));
  });
  const emit = async (token, phase, options = {}) => {
    if (!game.user.isGM) throw new Error("Solo il GM può avviare Evolution FX.");
    if (!token?.document || !canvas.scene) throw new Error("Seleziona un token nella scena.");
    const data = {
      module: MODULE_ID,
      sceneId: canvas.scene.id,
      tokenId: token.id,
      phase,
      type:options.type || "normal",
      sound:options.sound !== false,
      zoom:options.zoom !== false,
      eventId: foundry.utils.randomID()
    };
    // Socket events are delivered to other clients; run locally as well.
    await Promise.all([
      localEffect(data),
      Promise.resolve(game.socket.emit(CHANNEL, data))
    ]);
  };
  game.modules.get(MODULE_ID).api = {
    charge: (token,options) => emit(token, "charge",options),
    flash: (token,options) => emit(token, "flash",options),
    reveal: (token,options) => emit(token, "reveal",options),
    async transform(token, applyChange, options = {}) {
      if (typeof applyChange !== "function") throw new Error("transform richiede una funzione di aggiornamento.");
      await emit(token, "charge", options);
      await wait(options.chargeMs ?? 3300);
      await emit(token, "flash", options);
      try {
        await applyChange();
      } finally {
        await emit(token, "reveal", options);
      }
    },
    cleanup: token => emit(token, "cleanup"),
    async demo(token,options={}) {
      await emit(token, "charge",options);
      await wait(3300);
      await emit(token, "flash",options);
      await wait(450);
      await emit(token, "reveal",options);
    }
  };
  console.info(`${MODULE_ID} ready`);
});

Hooks.on("canvasTearDown", () => {
  for (const state of [...active.values()]) state.cleanup();
});
