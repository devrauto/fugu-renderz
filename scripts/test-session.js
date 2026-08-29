import { health, loadSession, pageStatus, searchNeymar, waitUntilReady } from "./bltr.js";

try {
  await health();
  const { profileId } = await loadSession();
  const status = await pageStatus(profileId);
  if (!status.ok || !status.url?.includes("renderz.app")) throw new Error("El perfil no está abierto en RenderZ.");
  await waitUntilReady(profileId, 30_000);
  await searchNeymar(profileId);
  console.log(`✓ Sesión BLTR válida (${profileId}); búsqueda de Neymar correcta.`);
} catch (error) {
  console.error(`✗ ${error.code === "ENOENT" ? "No existe sesión; ejecuta browser:authorize." : error.message}`);
  process.exitCode = 1;
}
