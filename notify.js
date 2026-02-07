"use strict";
const fs = require("fs");
const Growatt = require("growatt");

const STATE_FILE = "./state.json";

const user = process.env.GROWATT_USER;
const pass = process.env.GROWATT_PASS;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

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
        return { lastGridOn: null };
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
    const batV = Number(dev.statusData?.vBat ?? 0);

    const vIn = Number(dev.statusData?.vAcInput ?? 0);
    const fIn = Number(dev.statusData?.fAcInput ?? 0);
    const gridOn = vIn > 10 && fIn > 40;

    return { soc, batV, gridOn };
}

function fmtMini(s) {
    // Battery health: percentage + voltage only
    const bat = `🔋 البطارية: ${s.soc}% (${s.batV}V)`;
    const grid = `🔌 الكهرباء: ${s.gridOn ? "واصلة ✅" : "مقطوعة ❌"}`;
    return `${grid}\n${bat}`;
}

async function main() {
    const st = loadState();
    const s = await readStatus();

    // First run: send one message to set baseline
    if (st.lastGridOn === null) {
        st.lastGridOn = s.gridOn;
        await tgSend(`📡 First check\n${fmtMini(s)}`);
        saveState(st);
        console.log({ ok: true, ...s, at: new Date().toISOString() });
        return;
    }

    // Only send when Grid changes ON/OFF
    if (st.lastGridOn !== s.gridOn) {
        st.lastGridOn = s.gridOn;
        await tgSend(`${s.gridOn ? "⚡ Grid is BACK ON ✅" : "🚫 Grid is OFF ❌"}\n${fmtMini(s)}`);
    }

    saveState(st);
    console.log({ ok: true, ...s, at: new Date().toISOString() });
}

main().catch((e) => {
    console.error("ERR:", e);
    process.exit(1);
});
