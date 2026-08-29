import { ensureDedicatedProfile, health, saveSession, searchNeymar, startProfile, waitUntilReady } from "./bltr.js";

try {
  await health();
  const profileId = await ensureDedicatedProfile();
  await startProfile(profileId);
  await waitUntilReady(profileId);
  await searchNeymar(profileId);
  await saveSession(profileId);
  console.log(`✓ BLTR autorizado: perfil dedicado ${profileId}; RenderZ y búsqueda de Neymar verificados.`);
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
}
