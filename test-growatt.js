"use strict";

const Growatt = require("growatt");

const user = "karaaliisssa";
const pass = "Karali2458";

async function main() {
  const api = new Growatt({ server: "https://server.growatt.com" });

  const login = await api.login(user, pass);
  console.log("login:", login); // usually { result: 1, msg: 'OK' }

  // Get everything (plants + latest history)
  const data = await api.getAllPlantData({
    // keep it minimal at first
    plantData: true,
    deviceData: true,
    historyLast: true,
    statusData: true,
    weather: false,
    totalData: false,
    historyAll: false,
  });

  console.log(JSON.stringify(data, null, 2));

  await api.logout();
}

main().catch((e) => console.error("ERR:", e));
