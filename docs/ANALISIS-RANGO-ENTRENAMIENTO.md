# Modelo exacto de rango, entrenamiento y skills

## Resultado

El simulador ya no necesita abrir RenderZ para calcular cada build. RenderZ se usa como fuente de dos entradas:

1. La ficha base del jugador: posición primaria, OVR, 33 atributos y árbol de skills con sus modificadores.
2. La tabla binaria de entrenamiento: modificadores acumulados para cada combinación de posición primaria y nivel 1–30.

El cálculo posterior es local, determinista y está implementado en `scripts/renderz-model.js`.

## Regla completa

Para cada atributo individual `a`:

```text
atributoFinal[a] = atributoBase[a]
                 + entrenamiento[posiciónPrimaria][nivel][a]
                 + suma(modificadorDeCadaSkillSeleccionada[a])
```

Un atributo que no aparezca en un modificador recibe incremento cero. La tabla de entrenamiento es acumulada: el registro del nivel 30 ya contiene todo el incremento desde el nivel 0.

El rango se calcula de forma separada:

```text
OVR mostrado = OVR base + rango
puntos de skill disponibles = rango
```

El rango no aumenta los atributos individuales. Desde FC Mobile 26, entrenamiento y rango son independientes: una carta de rango 0 puede entrenarse a nivel 30. Los rangos válidos son 0–5 y los niveles de entrenamiento 0–30.

## Por qué depende de la posición

El incremento no es un porcentaje del atributo base. Todas las cartas con la misma posición primaria reciben el mismo vector de entrenamiento para un nivel dado, pero el vector cambia entre posiciones. Un CB prioriza marcaje, entradas, conciencia, fuerza, cabeza y salto; un extremo prioriza aceleración, sprint, regate y control; un GK tiene aumentos propios de estirada, colocación, manejo, reflejos y patada.

RenderZ publica 17 tablas: `CAM`, `CB`, `CDM`, `CF`, `CM`, `GK`, `LB`, `LF`, `LM`, `LW`, `LWB`, `RB`, `RF`, `RM`, `RW`, `RWB` y `ST`. `/api/model/positions/:position` devuelve los 30 niveles, tanto acumulados como incremento exacto respecto al nivel anterior.

La posición alternativa no cambia los atributos. Sólo puede cambiar el OVR efectivo al colocar la carta fuera de su posición primaria; los skills desbloquean o mejoran ese nivel alternativo. Por tanto, el motor de estadísticas usa siempre la posición primaria de la ficha.

## Cálculo de las seis estadísticas

Después de obtener los 33 atributos finales, cada estadística visible es una media ponderada con truncado hacia abajo:

```text
faceStat = floor(suma(atributo × peso) / 100)
```

### Jugadores de campo

- PAC: `ACC 50% + SPD 50%`
- SHO: `FIN 35% + LSA 20% + SHO 20% + POS 15% + VOL 5% + PEN 5%`
- PAS: `SPA 30% + LPA 20% + VIS 25% + CRO 15% + CUR 5% + FRK 5%`
- DRI: `DRI 25% + BAC 25% + AGI 25% + REA 15% + BAL 10%`
- DEF: `MRK 25% + STT 20% + SLT 20% + AWR 20% + HEA 15%`
- PHY: `STR 45% + AGG 30% + JMP 25%`

### Porteros

- DIV: `GKD 100%`
- POS: `GKP 100%`
- HAN: `HAN 100%`
- REF: `REF 100%`
- KIC: `GKK 100%`
- PHY: `REA 65% + AGI 15% + SPD 10% + STR 10%`

El truncado ocurre después de sumar todos los términos, no atributo por atributo.

## Skills

Cada ficha de RenderZ contiene su propio `skillsData`. El motor no supone incrementos genéricos: busca el nodo e incorpora su `abilityModifiers` exacto. También comprueba:

- que el nodo y nivel existan en esa carta;
- que se cumplan los requisitos del nodo avanzado;
- que no se repita una rama;
- que la suma de niveles no exceda los puntos concedidos por el rango.

Esto es importante porque el diseño de skills vigente puede diferir de guías antiguas. La fuente efectiva siempre es el árbol incluido en la ficha actual.

## Caso Maldini reproducido

La reseña 1389 de FCMobileForum usa:

- RenderZ ID `30919106`, OVR base `120`, rango `5`, entrenamiento `30`.
- Skills `30021.2-39011.1-39013.1-39014.1`.
- Reparto editorial: `2x Defender`, `1x Passing`, `1x Defending`, `1x Physical`.

El motor local obtiene exactamente:

```text
185 PAC / 121 SHO / 164 PAS / 157 DRI / 224 DEF / 210 PHY
```

Coincide tanto con RenderZ como con FCMobileForum.

## Validación

La prueba `scripts/validate-model.js` contrasta el motor local con la build calculada por RenderZ. Resultado actual:

```text
8/8 builds coinciden exactamente con RenderZ
```

La muestra cubre `CM`, `ST`, `CAM`, `LB`, `RW`, `CB`, `GK` y una build con cinco puntos de skill. También se verificaron en Maldini los topes históricos 5/10/15/20/25/30 y todos coincidieron; adicionalmente, nivel 30 con rango 0 coincide y confirma la independencia introducida en FC Mobile 26.

Además, `scripts/validate-random.js` hace una comprobación de caja negra contra
la interfaz real de RenderZ. Con semilla `20260802` se probaron dos builds para
cada una de las 15 posiciones principales (`GK`, `LB`, `LWB`, `CB`, `RB`,
`RWB`, `CDM`, `CM`, `LM`, `RM`, `CAM`, `LW`, `RW`, `CF` y `ST`):

```text
30/30 builds; 1016 valores contrastados
Sin diferencias entre el motor local y RenderZ
```

Se comparan el OVR mostrado, las seis estadísticas de cara y los 28 atributos
detallados de jugadores de campo (11 para porteros). Cada carta se prueba con
un rango y entrenamiento aleatorios, y de nuevo en rango 5 con una combinación
aleatoria válida de skills. La lista reciente se obtiene con el perfil BLTR
dedicado; las posiciones poco frecuentes se completan con cartas reales de
RenderZ para evitar una muestra sesgada.

## Procedencia y actualización

La tabla se descarga mediante el perfil BLTR dedicado desde el endpoint que consume el worker de RenderZ y se guarda en `.cache/position-modifiers.json`. Puede resincronizarse con `/api/model?refresh=1`. Las fichas base se leen de los datos hidratados de la página del jugador y se mantienen en memoria durante la ejecución.

La documentación oficial de EA confirma la separación conceptual entre rango, entrenamiento y skills, y las notas de FC Mobile 26 confirman que entrenamiento ya no exige rango oro. Los pesos, el truncado y la tabla por posición se obtuvieron del código y datos que ejecuta RenderZ y se comprobaron por comparación de salidas.
