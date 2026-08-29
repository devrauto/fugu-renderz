const BASE = process.env.FUGU_API_URL || "http://127.0.0.1:8787";

const cases = [
  { id: "30919738", label: "CM Kroos" },
  { id: "30919728", label: "ST Tévez" },
  { id: "30919726", label: "CAM Del Piero" },
  { id: "30919718", label: "LB Petit" },
  { id: "30919714", label: "RW Cole" },
  { id: "24048405", label: "CB Sánchez" },
  { id: "30919722", label: "GK Buffon" },
  { id: "30919106", label: "CB Maldini + 5 skills", skills: "30021.2-39011.1-39013.1-39014.1" }
];

async function get(path) {
  const response = await fetch(`${BASE}${path}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `${response.status} ${path}`);
  return body;
}

let failures = 0;
for (const testCase of cases) {
  const suffix = testCase.skills ? `?skills=${testCase.skills}` : "";
  const local = await get(`/api/max/${testCase.id}${suffix}`);
  const oracleQuery = new URLSearchParams({ rank: "5", training: "30" });
  if (testCase.skills) oracleQuery.set("skills", testCase.skills);
  const oracle = await get(`/api/build/${testCase.id}?${oracleQuery}`);
  const matched = JSON.stringify(local.faceStats) === JSON.stringify(oracle.faceStats);
  console.log(`${matched ? "PASS" : "FAIL"} ${testCase.label}`, local.faceStats);
  if (!matched) {
    failures++;
    console.error("  RenderZ:", oracle.faceStats);
  }
}

if (failures) {
  console.error(`\n${failures} validaciones fallaron.`);
  process.exitCode = 1;
} else {
  console.log(`\n${cases.length}/${cases.length} builds coinciden exactamente con RenderZ.`);
}
