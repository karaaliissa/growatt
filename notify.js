"use strict";
const fs = require("fs");
const Growatt = require("growatt");

const STATE_FILE = "./state.json";

const user = process.env.GROWATT_USER;
const pass = process.env.GROWATT_PASS;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

// thresholds: first = LOW, second = CRITICAL (you can change in GitHub secrets)
const THRESHOLDS = (process.env.THRESHOLDS || "30,15")
  .split(",")
  .map((x) => Number(x.trim()))
  .filter(Number.isFinite)
  .sort((a, b) => b - a);

const [LOW_T = 30, CRIT_T = 15] = THRESHOLDS;

if (!user || !pass || !TG_TOKEN || !TG_CHAT_ID) {
  console.error(
    "Missing env vars. Need GROWATT_USER, GROWATT_PASS, TG_TOKEN, TG_CHAT_ID"
  );
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
    return {
      lastGridOn: null,
      lowSent: false,
      critSent: false,
    };
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
  const gridOn = vIn > 10 && fIn > 40;

  const loadW = Number(dev.statusData?.loadPower ?? 0);
  const pvW = Number(dev.statusData?.panelPower ?? 0);
  const batV = Number(dev.statusData?.vBat ?? 0);

  return { plantId, deviceSn, soc, gridOn, vIn, fIn, loadW, pvW, batV };
}

function fmtSummary(s) {
  return (
    `🔋 Battery: ${s.soc}% (${s.batV}V)\n` +
    `🔌 Grid: ${s.gridOn ? "ON ✅" : "OFF ❌"} (vIn=${s.vIn}V fIn=${s.fIn}Hz)\n` +
    `⚡ Load: ${s.loadW}W | ☀️ PV: ${s.pvW}W\n` +
    `🆔 ${s.deviceSn}`
  );
}

async function main() {
  const st = loadState();
  const s = await readStatus();

  // --- 1) Grid OFF/ON alerts ---
  if (st.lastGridOn === null) {
    st.lastGridOn = s.gridOn;
    await tgSend(`📡 First check\n${fmtSummary(s)}`);
  } else if (st.lastGridOn !== s.gridOn) {
    st.lastGridOn = s.gridOn;
    await tgSend(
      `${s.gridOn ? "⚡ Grid is BACK ON ✅" : "🚫 Grid is OFF ❌"}\n${fmtSummary(s)}`
    );
  }

  // --- 2) Battery LOW + CRITICAL alerts (no spam) ---
  // CRITICAL first
  if (!st.critSent && s.soc >= 0 && s.soc <= CRIT_T) {
    st.critSent = true;
    await tgSend(`🚨 Battery CRITICAL (<= ${CRIT_T}%)\n${fmtSummary(s)}`);
  }

  // LOW (only if not critical)
  if (!st.lowSent && s.soc >= 0 && s.soc <= LOW_T && s.soc > CRIT_T) {
    st.lowSent = true;
    await tgSend(`⚠️ Battery LOW (<= ${LOW_T}%)\n${fmtSummary(s)}`);
  }

  // Reset flags when battery recovers (so alerts can fire again next time)
  if (st.critSent && s.soc > CRIT_T + 3) st.critSent = false;
  if (st.lowSent && s.soc > LOW_T + 3) st.lowSent = false;

  saveState(st);
  console.log({ ok: true, ...s, at: new Date().toISOString(), LOW_T, CRIT_T });
}

main().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});
