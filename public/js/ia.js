/**
 * ============================================================
 *  ia.js — Kitchen Arena · Inteligencia Artificial Avanzada
 * ============================================================
 *  Estados de la IA:
 *    PERSEGUIR  → tiene ventaja elemental: caza al jugador
 *    HUIR       → tiene desventaja: escapa, busca power-ups
 *    NEUTRAL    → empate: decide según vidas y distancia
 *    RODEAR     → intenta encerrar al jugador con su rastro
 *    WANDER     → explorar sin objetivo claro
 *
 *  Pathfinding:
 *    Grid simple de celda 1×1 unidad con A* ligero.
 *    Recalcula la ruta cada vez que el estado cambia o
 *    la ruta queda bloqueada.
 * ============================================================
 */

import * as THREE from "three";
import { resolverCombate, TABLA_COMBATE } from "./elementos.js";

/* ── Configuración ───────────────────────────────────────── */

export const IA_CFG = {
    velocidadBase:       0.062,
    velocidadHuida:      0.085,
    velocidadPersecucion:0.075,
    velocidadWander:     0.040,

    radioDeteccion:      20,    // detecta al jugador
    radioMuyPeligroso:    5,    // distancia crítica para huir
    radioAtaque:          2.5,  // distancia para "tocar" al jugador

    invulnerabilidadIAMs: 1000, // gracia de la IA tras recibir daño

    replanificarCadaMs:   400,  // recalcular ruta cada N ms
    gridTamanoCelda:       1,   // resolución del grid
    gridRadio:            32,   // mitad del mapa
    margenObstaculo:       1.8, // radio de bloqueo de obstáculos en el grid

    /* Umbrales de decisión */
    vidasBajas:            1,   // IA se vuelve agresiva/cobarde
    agresividadAlta:       0.6  // probabilidad extra de atacar si jugador tiene pocas vidas
};

/* ── Estados ─────────────────────────────────────────────── */

export const ESTADO_IA = {
    WANDER:    "wander",
    PERSEGUIR: "perseguir",
    HUIR:      "huir",
    NEUTRAL:   "neutral",
    RODEAR:    "rodear",
    MUERTA:    "muerta"
};

/* ── A* Grid simple ─────────────────────────────────────── */

class Grid {
    constructor(radio, tamCelda) {
        this.radio    = radio;
        this.tam      = tamCelda;
        this.celdas   = Math.ceil((radio * 2) / tamCelda);
        this.bloqueado = new Uint8Array(this.celdas * this.celdas);
    }

    mundoACelda(x, z) {
        const ci = Math.floor((x + this.radio) / this.tam);
        const cj = Math.floor((z + this.radio) / this.tam);
        return {
            i: Math.max(0, Math.min(this.celdas - 1, ci)),
            j: Math.max(0, Math.min(this.celdas - 1, cj))
        };
    }

    celdaAMundo(i, j) {
        return {
            x: i * this.tam - this.radio + this.tam * 0.5,
            z: j * this.tam - this.radio + this.tam * 0.5
        };
    }

    idx(i, j) { return j * this.celdas + i; }

    bloquear(x, z, radio) {
        const rC = Math.ceil(radio / this.tam);
        const { i: ci, j: cj } = this.mundoACelda(x, z);
        for (let di = -rC; di <= rC; di++) {
            for (let dj = -rC; dj <= rC; dj++) {
                const ni = ci + di, nj = cj + dj;
                if (ni >= 0 && ni < this.celdas && nj >= 0 && nj < this.celdas) {
                    this.bloqueado[this.idx(ni, nj)] = 1;
                }
            }
        }
    }

    desbloquearTodo() {
        this.bloqueado.fill(0);
    }

    /** A* desde (sx,sz) hasta (gx,gz). Retorna array de {x,z} mundo o null */
    astar(sx, sz, gx, gz) {
        const { i: si, j: sj } = this.mundoACelda(sx, sz);
        const { i: gi, j: gj } = this.mundoACelda(gx, gz);

        if (si === gi && sj === gj) return null;

        const N = this.celdas;
        const f = new Float32Array(N * N).fill(Infinity);
        const g = new Float32Array(N * N).fill(Infinity);
        const parent = new Int32Array(N * N).fill(-1);

        const startIdx = this.idx(si, sj);
        g[startIdx] = 0;
        f[startIdx] = this._heuristica(si, sj, gi, gj);

        // Min-heap sencillo (open set)
        const open = [startIdx];

        const DIRS = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
        const COSTO = [1, 1, 1, 1, 1.41, 1.41, 1.41, 1.41];

        let iteraciones = 0;
        const MAX_ITER = 800;

        while (open.length > 0 && iteraciones++ < MAX_ITER) {
            // Sacar nodo con menor f
            let mejorIdx = 0;
            for (let k = 1; k < open.length; k++) {
                if (f[open[k]] < f[open[mejorIdx]]) mejorIdx = k;
            }
            const actual = open.splice(mejorIdx, 1)[0];

            const ai = actual % N;
            const aj = Math.floor(actual / N);

            if (ai === gi && aj === gj) {
                // Reconstruir camino
                return this._reconstruir(parent, actual, N);
            }

            for (let d = 0; d < DIRS.length; d++) {
                const ni = ai + DIRS[d][0];
                const nj = aj + DIRS[d][1];
                if (ni < 0 || ni >= N || nj < 0 || nj >= N) continue;

                const nIdx = this.idx(ni, nj);
                if (this.bloqueado[nIdx]) continue;

                const gNuevo = g[actual] + COSTO[d];
                if (gNuevo < g[nIdx]) {
                    g[nIdx]      = gNuevo;
                    f[nIdx]      = gNuevo + this._heuristica(ni, nj, gi, gj);
                    parent[nIdx] = actual;
                    if (!open.includes(nIdx)) open.push(nIdx);
                }
            }
        }
        return null; // sin camino
    }

    _heuristica(i, j, gi, gj) {
        return Math.hypot(gi - i, gj - j);
    }

    _reconstruir(parent, end, N) {
        const path = [];
        let cur = end;
        while (cur !== -1) {
            const i = cur % N;
            const j = Math.floor(cur / N);
            path.unshift(this.celdaAMundo(i, j));
            cur = parent[cur];
        }
        return path.length > 1 ? path.slice(1) : null;
    }
}

/* ── Clase principal ─────────────────────────────────────── */

export class AgentIA {
    /**
     * @param {THREE.Mesh} mesh       - mesh 3D de la IA
     * @param {object}     obstaculos - lista de obstáculos del escenario
     * @param {object}     gestorRastros - instancia de GestorRastros
     */
    constructor(mesh, obstaculos, gestorRastros) {
        this.mesh          = mesh;
        this.obstaculos    = obstaculos;
        this.gestorRastros = gestorRastros;

        this.estado        = ESTADO_IA.WANDER;
        this.elementoIA    = "fuego";           // elemento inicial de la IA
        this.vidasIA       = 3;

        this.ruta          = [];                // waypoints A*
        this.wanderTarget  = null;
        this.ultimaReplani = 0;

        this._grid = new Grid(IA_CFG.gridRadio, IA_CFG.gridTamanoCelda);
        this._construirGrid();

        this.ultimoDaño    = 0;
        this.muerta        = false;

        /* Callbacks externos */
        this.onDaño    = null;   // (vidasRestantes)
        this.onMuerte  = null;

        /* Para animación */
        this.inclinacion = 0;
        this.fase        = Math.random() * Math.PI * 2;
    }

    /* ── API pública ─────────────────────────────────────── */

    /**
     * Actualizar la IA cada frame.
     * @param {number}           tiempo       - clock.getElapsedTime()
     * @param {THREE.Vector3}    posJugador
     * @param {string}           elementoJugador
     * @param {number}           vidasJugador
     * @param {object[]}         powerUpsMap  - lista de powerUps en escena
     */
    actualizar(tiempo, posJugador, elementoJugador, vidasJugador, powerUpsMap) {
        if (this.muerta) return;

        const ahora      = performance.now();
        const distancia  = this.mesh.position.distanceTo(posJugador);
        const resultado  = resolverCombate(this.elementoIA, elementoJugador);

        /* ── Decidir estado ─────────────────────────────── */
        this._decidirEstado(resultado, distancia, vidasJugador, ahora);

        /* ── Replanificar ruta si toca ──────────────────── */
        if (ahora - this.ultimaReplani > IA_CFG.replanificarCadaMs) {
            this.ultimaReplani = ahora;
            this._actualizarGridRastros();
            this._planificarRuta(posJugador, resultado, powerUpsMap);
        }

        /* ── Moverse ────────────────────────────────────── */
        const velocidad = this._velocidadPorEstado();
        this._mover(velocidad, posJugador, tiempo);

        /* ── Comprobar colisión directa con jugador ─────── */
        if (distancia < IA_CFG.radioAtaque) {
            this._resolverContactoJugador(resultado);
        }
    }

    recibirDaño() {
        const ahora = performance.now();
        if (ahora - this.ultimoDaño < IA_CFG.invulnerabilidadIAMs) return false;
        this.ultimoDaño = ahora;
        this.vidasIA    = Math.max(0, this.vidasIA - 1);
        if (this.onDaño) this.onDaño(this.vidasIA);
        if (this.vidasIA <= 0) {
            this.muerta = true;
            this.estado = ESTADO_IA.MUERTA;
            if (this.onMuerte) this.onMuerte();
        }
        return true;
    }

    /* ── Privados ─────────────────────────────────────────── */

    _decidirEstado(resultado, distancia, vidasJugador, ahora) {
        // IA con pocas vidas: siempre huir
        if (this.vidasIA <= IA_CFG.vidasBajas && distancia < IA_CFG.radioDeteccion) {
            this.estado = ESTADO_IA.HUIR;
            return;
        }

        if (distancia > IA_CFG.radioDeteccion) {
            this.estado = ESTADO_IA.WANDER;
            return;
        }

        switch (resultado) {
            case "gana":
                // Jugador con poca vida → más agresiva
                if (vidasJugador <= 1 || distancia < IA_CFG.radioDeteccion * 0.5) {
                    this.estado = ESTADO_IA.RODEAR;
                } else {
                    this.estado = ESTADO_IA.PERSEGUIR;
                }
                break;

            case "pierde":
                if (distancia < IA_CFG.radioMuyPeligroso) {
                    this.estado = ESTADO_IA.HUIR;
                } else {
                    // Buscar power-up para cambiar elemento
                    this.estado = ESTADO_IA.HUIR;
                }
                break;

            case "empata":
                if (distancia < IA_CFG.radioAtaque * 1.5) {
                    this.estado = Math.random() < 0.5 ? ESTADO_IA.PERSEGUIR : ESTADO_IA.HUIR;
                } else {
                    this.estado = ESTADO_IA.NEUTRAL;
                }
                break;
        }
    }

    _velocidadPorEstado() {
        switch (this.estado) {
            case ESTADO_IA.PERSEGUIR: return IA_CFG.velocidadPersecucion;
            case ESTADO_IA.RODEAR:    return IA_CFG.velocidadPersecucion * 1.1;
            case ESTADO_IA.HUIR:      return IA_CFG.velocidadHuida;
            case ESTADO_IA.NEUTRAL:   return IA_CFG.velocidadBase;
            case ESTADO_IA.WANDER:    return IA_CFG.velocidadWander;
            default:                  return IA_CFG.velocidadBase;
        }
    }

    _planificarRuta(posJugador, resultado, powerUpsMap) {
        const pos = this.mesh.position;

        switch (this.estado) {

            case ESTADO_IA.PERSEGUIR:
            case ESTADO_IA.RODEAR: {
                // Ir hacia el jugador, con offset de flanco para rodearlo
                let tx = posJugador.x, tz = posJugador.z;
                if (this.estado === ESTADO_IA.RODEAR) {
                    // Flanqueo: perpendicular al vector IA→jugador
                    const ang = Math.atan2(posJugador.z - pos.z, posJugador.x - pos.x) + Math.PI / 2;
                    const r   = 4;
                    tx += Math.cos(ang) * r;
                    tz += Math.sin(ang) * r;
                }
                const ruta = this._grid.astar(pos.x, pos.z, tx, tz);
                this.ruta  = ruta || [];
                break;
            }

            case ESTADO_IA.HUIR: {
                // Dirección opuesta al jugador
                const dx = pos.x - posJugador.x;
                const dz = pos.z - posJugador.z;
                const len = Math.hypot(dx, dz) || 1;
                const escapaX = Math.max(-28, Math.min(28, pos.x + (dx / len) * 14));
                const escapaZ = Math.max(-28, Math.min(28, pos.z + (dz / len) * 14));

                // Si hay power-up alcanzable, ir por él
                const mejorPU = this._buscarPowerUpBeneficioso(powerUpsMap, posJugador);
                const destX   = mejorPU ? mejorPU.x : escapaX;
                const destZ   = mejorPU ? mejorPU.z : escapaZ;

                const ruta = this._grid.astar(pos.x, pos.z, destX, destZ);
                this.ruta  = ruta || [];
                break;
            }

            case ESTADO_IA.NEUTRAL: {
                // Mantener distancia media
                const dist = this.mesh.position.distanceTo(posJugador);
                if (dist < 8) {
                    // Alejarse un poco
                    const dx  = pos.x - posJugador.x;
                    const dz  = pos.z - posJugador.z;
                    const len = Math.hypot(dx, dz) || 1;
                    const tx  = Math.max(-28, Math.min(28, pos.x + (dx / len) * 6));
                    const tz  = Math.max(-28, Math.min(28, pos.z + (dz / len) * 6));
                    this.ruta = this._grid.astar(pos.x, pos.z, tx, tz) || [];
                } else if (dist > 14) {
                    this.ruta = this._grid.astar(pos.x, pos.z, posJugador.x, posJugador.z) || [];
                }
                break;
            }

            case ESTADO_IA.WANDER: {
                if (!this.wanderTarget || this.mesh.position.distanceTo(
                    new THREE.Vector3(this.wanderTarget.x, 0, this.wanderTarget.z)) < 1.5) {
                    this.wanderTarget = {
                        x: (Math.random() * 2 - 1) * 22,
                        z: (Math.random() * 2 - 1) * 22
                    };
                }
                this.ruta = this._grid.astar(pos.x, pos.z, this.wanderTarget.x, this.wanderTarget.z) || [];
                break;
            }
        }
    }

    _mover(velocidad, posJugador, tiempo) {
        const pos = this.mesh.position;

        // Siguiente waypoint de la ruta A*
        if (this.ruta.length > 0) {
            const wp  = this.ruta[0];
            const dx  = wp.x - pos.x;
            const dz  = wp.z - pos.z;
            const dist = Math.hypot(dx, dz);

            if (dist < 0.6) {
                this.ruta.shift();
            } else {
                const nx = dx / dist;
                const nz = dz / dist;
                pos.x += nx * velocidad;
                pos.z += nz * velocidad;

                // Orientar IA en dirección de movimiento
                this.mesh.rotation.z = nx * 0.3;  // inclinación lateral visual
            }
        } else {
            // Sin ruta: movimiento directo suavizado hacia destino urgente
            let tx = posJugador.x, tz = posJugador.z;
            if (this.estado === ESTADO_IA.HUIR) {
                tx = pos.x + (pos.x - posJugador.x);
                tz = pos.z + (pos.z - posJugador.z);
            }
            const dx = tx - pos.x;
            const dz = tz - pos.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 0.1) {
                pos.x += (dx / dist) * velocidad;
                pos.z += (dz / dist) * velocidad;
            }
        }

        // Clamp al límite del escenario
        pos.x = Math.max(-30, Math.min(30, pos.x));
        pos.z = Math.max(-30, Math.min(30, pos.z));
    }

    _resolverContactoJugador(resultado) {
        // Esto solo llama a los callbacks; la resolución real está en juego.js
        if (this._onContactoJugador) {
            this._onContactoJugador(resultado);
        }
    }

    /**
     * Busca el power-up más cercano que dé una ventaja elemental
     * sobre el elemento del jugador.
     */
    _buscarPowerUpBeneficioso(powerUpsMap, posJugador) {
        if (!powerUpsMap || powerUpsMap.length === 0) return null;

        let mejor = null, mejorDist = Infinity;

        for (const pu of powerUpsMap) {
            // ¿Si tomamos este power-up ganamos al jugador?
            const elemPU = pu.elemento;
            const res    = resolverCombate(elemPU, this._elementoJugadorRef || "normal");
            if (res !== "gana") continue;

            const dist = this.mesh.position.distanceTo(pu.modelo.position);
            if (dist < mejorDist) {
                mejorDist = dist;
                mejor     = pu.modelo.position;
            }
        }

        return mejor;
    }

    /* ── Grid ────────────────────────────────────────────── */

    _construirGrid() {
        this._grid.desbloquearTodo();

        // Paredes del escenario
        const lim = IA_CFG.gridRadio - 1;
        for (let i = 0; i < this._grid.celdas; i++) {
            this._grid.bloqueado[this._grid.idx(i, 0)] = 1;
            this._grid.bloqueado[this._grid.idx(i, this._grid.celdas - 1)] = 1;
            this._grid.bloqueado[this._grid.idx(0, i)] = 1;
            this._grid.bloqueado[this._grid.idx(this._grid.celdas - 1, i)] = 1;
        }

        // Obstáculos del escenario
        for (const obs of this.obstaculos) {
            const bb = new THREE.Box3().setFromObject(obs.modelo);
            const centro = new THREE.Vector3();
            bb.getCenter(centro);
            const size   = new THREE.Vector3();
            bb.getSize(size);
            const radio = Math.max(size.x, size.z) * 0.5 + IA_CFG.margenObstaculo;
            this._grid.bloquear(centro.x, centro.z, radio);
        }
    }

    _actualizarGridRastros() {
        if (!this.gestorRastros) return;

        // Solo bloquear rastros del jugador (no los propios)
        for (const seg of this.gestorRastros.segmentos) {
            if (seg.propietario === "jugador") {
                const { i, j } = this._grid.mundoACelda(seg.mesh.position.x, seg.mesh.position.z);
                // Bloquear celda actual y vecinas
                for (let di = -1; di <= 1; di++) {
                    for (let dj = -1; dj <= 1; dj++) {
                        const ni = i + di, nj = j + dj;
                        if (ni >= 0 && ni < this._grid.celdas && nj >= 0 && nj < this._grid.celdas) {
                            this._grid.bloqueado[this._grid.idx(ni, nj)] = 1;
                        }
                    }
                }
            }
        }
    }

    /* ── Actualizar referencia al elemento del jugador ────── */
    setElementoJugador(elem) {
        this._elementoJugadorRef = elem;
    }

    /* ── Recoger un power-up (llamado desde juego.js) ─────── */
    recogerElemento(elemento) {
        this.elementoIA = elemento;
    }
}

/* ── HUD de estado de IA (debug/visual) ─────────────────── */

export function actualizarHUDIA(estado, elemento, vidas) {
    const div = document.getElementById("hud-ia");
    if (!div) return;

    const iconos = { fuego:"🌶️", agua:"🍋", hielo:"🍦", aire:"☁️", normal:"⚡" };
    const estados = {
        perseguir:"🎯 Persiguiendo",
        huir:"💨 Huyendo",
        neutral:"⚖️ Neutral",
        rodear:"🌀 Rodeando",
        wander:"🔍 Explorando",
        muerta:"💀 Derrotada"
    };

    div.innerHTML = `
        <span class="hud-ia-label">IA</span>
        <span>${iconos[elemento] ?? "⚡"}</span>
        <span class="hud-ia-estado">${estados[estado] ?? estado}</span>
        <span>${"❤️".repeat(vidas)}${"🖤".repeat(3 - vidas)}</span>
    `;
}
