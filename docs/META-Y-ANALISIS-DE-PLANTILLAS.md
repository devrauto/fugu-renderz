# Meta y análisis de plantillas FC Mobile

Estado del modelo: `squad-meta-2026.08.02-v3`, actualizado el 2 de agosto de 2026.

## Qué resuelve

El servicio importa una plantilla RenderZ, distingue la posición natural de la
carta de su puesto real en la formación y simula cada build con rango,
entrenamiento y skill points. Después puntúa el encaje por separado para H2H,
VSA y Manager. No existe una única puntuación meta válida para los tres modos.

Para un candidato sin una build indicada, prueba todas las combinaciones válidas
del árbol de skills, respeta dependencias y el límite de puntos del rango, y
conserva la build que maximiza el rol y modo solicitado.

`auto_recommend_changes` no necesita IDs de candidatos. Busca en el catálogo
actual de RenderZ las cartas naturales de los puestos más débiles, puede exigir
que sean comprables y aplicar un precio máximo en el rango elegido. Devuelve el
precio observado, el jugador que sale, la mejora estimada y la build exacta.

`search_players` expone el mismo catálogo como API paginada. `nextCursor` se
envía como `cursor` en la llamada siguiente, por lo que una IA puede recorrer
todo el catálogo sin depender de una lista fija de jugadores.

## Capas de evidencia

- `exact`: OVR mostrado, rango, nivel 0–30, modificadores de entrenamiento,
  skill nodes y atributos resultantes reproducidos por el motor local.
- `observed`: ficha, posición, work rates, físico, PlayStyles, plantilla y
  formación leídos de RenderZ.
- `estimated`: pesos tácticos, bonus contextual de PlayStyles y delta de encaje.

La tercera capa es una heurística explicable y versionada. No se presenta como
la fórmula privada de matchmaking, IA o gameplay de EA.

## Criterios por modo

- H2H da más peso a aceleración efectiva, físico, defensa manual, perfiles de
  regate y PlayStyles que activan acciones útiles en campo abierto.
- VSA prioriza finalización, pierna mala, control, reacciones y creación de
  ocasiones; el OVR del equipo debe tratarse además como restricción propia del
  modo.
- Manager aumenta el peso de work rates, disciplina posicional, resistencia y
  consistencia de la estructura.

Los perfiles son específicos de GK, CB, laterales/carrileros, CDM, CM, CAM,
bandas, CF y ST. Un PlayStyle sólo suma si su acción es relevante para ese rol;
por ejemplo Anticipate pesa para centrales y mediocentros defensivos, mientras
Finesse se valora en atacantes y creadores.

El catálogo vivo se recorrió por cursor para comprobar los 18 PlayStyles
lanzados por EA y sus niveles Silver/Gold. RenderZ usa algunos nombres internos:
`INTIMIDATOR` equivale a Bruiser y `AERIAL_DEFENSE` a Precision Header. Esos
alias, junto con los de Finesse, Rapid, Anticipate, Guardian, Relentless y Rush
Out, están expuestos en `/api/scoring/model` para que puedan auditarse.

## Fuentes de mecánicas y contraste comunitario

- EA, gameplay de FC Mobile 26:
  https://www.ea.com/games/ea-sports-fc/fc-mobile/news/fc-mobile-26-update-gameplay
- EA, explicación oficial de PlayStyles:
  https://www.ea.com/games/ea-sports-fc/fc-mobile/news/playstyles-deep-dive
- EA, actualización Worlds:
  https://www.ea.com/games/ea-sports-fc/fc-mobile/news/fc-mobile-worlds-game-update
- RenderZ, flujo de torneos/vinculación:
  https://renderz.app/tournaments/get-started
- Debate comunitario de PlayStyles:
  https://www.reddit.com/r/FUTMobile/comments/1trmbq7/playstyle_tier_list/
- Debate comunitario de formaciones:
  https://www.reddit.com/r/FUTMobile/comments/1uivvt8/whats_the_meta_formation_now/
- Guía comunitaria de Manager:
  https://www.reddit.com/r/FUTMobile/comments/1owzvdi/manager_mode_a_guide/

Las observaciones comunitarias sirven para calibrar hipótesis, no para afirmar
coeficientes exactos de EA. El modelo deja su versión y componentes en cada
respuesta para poder volver a probarlos cuando cambie el gameplay.

## UID y privacidad

No hay un endpoint público oficial que convierta anónimamente un UID de FC
Mobile en una plantilla. RenderZ prueba la propiedad pidiendo que el usuario
cambie temporalmente el nombre de su plantilla activa a un código generado en
su cuenta. No necesita la contraseña de EA.

Por eso `GET /api/squads/uid/:uid` devuelve `needs_verification` mientras no
exista snapshot autorizado. También se admite un enlace público de Squadbuilder,
una captura o una plantilla manual como alternativas.

## Captura de pantalla por MCP

El flujo visual no usa OCR ciego como autoridad. La IA inspecciona la imagen que
devuelve `inspect_squad_screenshot` y transcribe los campos visibles. El backend
de `analyze_squad_screenshot` exige que nombre, OVR base más rango, posición y
diseño de carta encajen con el catálogo actual de RenderZ.

El diseño/evento es importante: pueden existir TOTS y UTOTS del mismo jugador,
con igual OVR pero diferentes PlayStyles. Si falta ese distintivo y las variantes
no son equivalentes, se devuelve `needs_clarification` con candidatos e imágenes.
Una sola captura tampoco revela normalmente los nodos de skill seleccionados;
el análisis usa entonces la mejor build válida y lo declara expresamente.

## Prueba reproducible

Con la API levantada:

```bash
npm run test:squad
```

La prueba usa un snapshot real marcado por RenderZ como `isGameAccountSquad`,
verifica 18 cartas/11 titulares, el mapeo 4-3-3 Holding, analiza los tres modos y
comprueba recomendaciones con skill points optimizados. El UID de prueba
`1054521024707137536` sólo verifica el contrato seguro: no se inventa su equipo.
