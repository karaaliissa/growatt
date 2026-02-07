"use strict";
const fs = require("fs");
const Growatt = require("growatt");

const STATE_FILE = "./state.json";

const user = process.env.GROWATT_USER;
const pass = process.env.GROWATT_PASS;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

const POLL_SECONDS = Number(process.env.POLL_SECONDS || 300); // 5 min default
const THRESHOLDS = (process.env.THRESHOLDS || "30,20,10")
  .split(",")
  .map((x) => Number(x.trim()))
  .filter((x) => Number.isFinite(x))
  .sort((a, b) => b - a);

if (!user || !pass || !TG_TOKEN || !TG_CHAT_ID) {
  console.error("Missing env vars. Need GROWATT_USER, GROWATT_PASS, TG_TOKEN, TG_CHAT_ID");
  process.exit(1);
}

async function tgSend(text) {
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT_ID, text }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) console.log("Telegram error:", j);
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { lastGridOn: null, lastSoc: null, sent: {} };
  }
}
function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

async function readStatus() {
  const api = new Growatt({ server: "https://server.growatt.com" });
  await api.login(user, pass);

  const all = await api.getAllPlantData({
    plantData: false,
    deviceData: true,
    historyLast: false,
    statusData: true,
    weather: false,
    totalData: false,
    historyAll: false,
  });

  await api.logout();

  const plantId = Object.keys(all)[0];
  const plant = all[plantId];
  const deviceSn = Object.keys(plant.devices)[0];
  const dev = plant.devices[deviceSn];

  const soc = Number(dev.statusData?.capacity ?? -1);
  const vIn = Number(dev.statusData?.vAcInput ?? 0);
  const fIn = Number(dev.statusData?.fAcInput ?? 0);

  // ✅ Grid ON/OFF
  const gridOn = vIn > 10 && fIn > 40;

  const loadW = Number(dev.statusData?.loadPower ?? 0);
  const pvW = Number(dev.statusData?.panelPower ?? 0);
  const batV = Number(dev.statusData?.vBat ?? 0);

  return { plantId, deviceSn, soc, gridOn, vIn, fIn, loadW, pvW, batV };
}

async function tick() {
  const st = loadState();
  const s = await readStatus();

  // 1) Grid change notify
  if (st.lastGridOn === null) {
    st.lastGridOn = s.gridOn;
    await tgSend(`🔌 Grid status: ${s.gridOn ? "ON ✅" : "OFF ❌"} (first check)\n🔋 Battery ${s.soc}%`);
  } else if (st.lastGridOn !== s.gridOn) {
    st.lastGridOn = s.gridOn;
    await tgSend(
      `🔌 Grid changed: ${s.gridOn ? "ON ✅" : "OFF ❌"} | vIn=${s.vIn}V fIn=${s.fIn}Hz\n` +
      `🔋 Battery ${s.soc}% | ⚡ Load ${s.loadW}W | ☀️ PV ${s.pvW}W | 🔋 ${s.batV}V`
    );
  }

  // 2) Battery thresholds notify
  for (const t of THRESHOLDS) {
    const key = String(t);
    const alreadySent = !!st.sent[key];

    if (!alreadySent && s.soc >= 0 && s.soc <= t) {
      st.sent[key] = true;
      await tgSend(
        `⚠️ Battery low: ${s.soc}% (<= ${t}%)\n` +
        `🔌 Grid: ${s.gridOn ? "ON ✅" : "OFF ❌"} | ⚡ Load ${s.loadW}W | ☀️ PV ${s.pvW}W | 🔋 ${s.batV}V`
      );
    }

    // reset when back above threshold + buffer
    if (alreadySent && s.soc > t + 3) st.sent[key] = false;
  }

  saveState(st);
  console.log({ ok: true, ...s, at: new Date().toISOString() });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async function main() {
  while (true) {
    try {
      await tick();
    } catch (e) {
      console.error("TICK_ERR:", e?.message || e);
    }
    await sleep(POLL_SECONDS * 1000);
  }
})();
