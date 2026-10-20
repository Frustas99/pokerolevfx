const MODULE_ID = "pokerole-evolution-fx";
const CHANNEL = `module.${MODULE_ID}`;
const active = new Map();
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

async function localEffect({ sceneId, tokenId, phase, eventId }) {
  if (!canvas?.ready || canvas.scene?.id !== sceneId) return;
  const token = canvas.tokens.get(tokenId);
  if (!token) return;
  const key = `${sceneId}:${tokenId}`;
  if (phase === "cleanup") {
    active.get(key)?.cleanup();
    return;
  }
  if (phase === "flash") {
    const state = active.get(key);
    if (!state) return;
    await state.flash();
    return;
  }
  if (phase === "reveal") {
    const state = active.get(key);
    if (!state) return;
    await state.reveal();
    return;
  }
  if (phase !== "charge") return;
  active.get(key)?.cleanup();

  const center = token.center;
  const radius = Math.max(token.w, token.h) * 0.55;
  const root = new PIXI.Container();
  root.position.set(center.x, center.y);
  root.sortableChildren = true;
  canvas.stage.addChild(root);
  let running = true;
  let finished = false;
  const aura = graphicCircle(radius * 0.9, 0xffd36a, 0.12);
  aura.zIndex = -10;
  root.addChild(aura);
  const ringA = graphicCircle(radius * 0.95, 0xffedab, 0.92, 5);
  const ringB = graphicCircle(radius * 1.28, 0x75dfff, 0.78, 3);
  root.addChild(ringA, ringB);
  const particles = Array.from({ length: 54 }, (_, i) => {
    const g = graphicCircle(1.5 + Math.random() * 3.5, i % 4 === 0 ? 0x7be7ff : 0xffffff, 0.9);
    const p = { g, angle: Math.random() * Math.PI * 2, distance: radius * (1.5 + Math.random() * 2), speed: 0.9 + Math.random() * 1.7 };
    root.addChild(g);
    return p;
  });
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
    aura.scale.set(1 + Math.sin(performance.now() / 180) * 0.12);
    for (const p of particles) {
      p.distance -= p.speed * dt;
      if (p.distance < 5) p.distance = radius * (1.6 + Math.random() * 1.8);
      p.angle += 0.006 * dt;
      p.g.position.set(Math.cos(p.angle) * p.distance, Math.sin(p.angle) * p.distance);
    }
  };
  ticker.add(tick);
  const cleanup = () => {
    if (finished) return;
    finished = true;
    running = false;
    ticker.remove(tick);
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
  const emit = async (token, phase) => {
    if (!game.user.isGM) throw new Error("Solo il GM può avviare Evolution FX.");
    if (!token?.document || !canvas.scene) throw new Error("Seleziona un token nella scena.");
    const data = {
      module: MODULE_ID,
      sceneId: canvas.scene.id,
      tokenId: token.id,
      phase,
      eventId: foundry.utils.randomID()
    };
    // Socket events are delivered to other clients; run locally as well.
    await Promise.all([
      localEffect(data),
      Promise.resolve(game.socket.emit(CHANNEL, data))
    ]);
  };
  game.modules.get(MODULE_ID).api = {
    charge: token => emit(token, "charge"),
    flash: token => emit(token, "flash"),
    reveal: token => emit(token, "reveal"),
    async transform(token, applyChange, options = {}) {
      if (typeof applyChange !== "function") throw new Error("transform richiede una funzione di aggiornamento.");
      await emit(token, "charge");
      await wait(options.chargeMs ?? 3300);
      await emit(token, "flash");
      try {
        await applyChange();
      } finally {
        await emit(token, "reveal");
      }
    },
    cleanup: token => emit(token, "cleanup"),
    async demo(token) {
      await emit(token, "charge");
      await wait(3300);
      await emit(token, "flash");
      await wait(450);
      await emit(token, "reveal");
    }
  };
  console.info(`${MODULE_ID} ready`);
});

Hooks.on("canvasTearDown", () => {
  for (const state of [...active.values()]) state.cleanup();
});
