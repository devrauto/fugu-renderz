# Informe de validación aleatoria — 2026-08-02

Comando reproducible:

```bash
RANDOM_SEED=20260802 RANDOM_PLAYER_COUNT=15 npm run test:random
```

## Resultado

```text
30/30 builds
1016 valores contrastados
0 diferencias
```

La muestra contiene una carta real por cada posición principal y dos builds por
carta: una combinación aleatoria de rango/entrenamiento sin skills y otra en
rango 5 con entrenamiento y skills válidos elegidos aleatoriamente.

| Posición | Carta contrastada |
|---|---|
| GK | Gianluigi Buffon |
| LB | Emmanuel Petit |
| LWB | Andrew Robertson |
| CB | Marcel Desailly |
| RB | Daniel Carvajal Ramos |
| RWB | Matty Cash |
| CDM | Joshua Kimmich |
| CM | Toni Kroos |
| LM | Raphael Dias Belloli (Raphinha) |
| RM | Michael Olise |
| CAM | Alessandro Del Piero |
| LW | Kylian Mbappé |
| RW | Joe Cole |
| CF | Memphis Depay |
| ST | Carlos Tévez |

Por build se exige igualdad exacta del OVR, las seis estadísticas resumidas y
cada atributo detallado mostrado por RenderZ: 28 en jugadores de campo y 11 en
porteros. Entre los casos aleatorios hubo entrenamiento 27 en RWB, entrenamiento
28 en CAM y entrenamiento 20 con rango 0 en GK.

La regresión determinista complementaria terminó también con `8/8` builds
exactas, incluida la build de Maldini con cinco puntos de skill.
