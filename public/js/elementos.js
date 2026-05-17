/**
 * ============================================================
 *  elementos.js — Kitchen Arena · Sistema de Elementos
 * ============================================================
 *  Gestiona:
 *   • Tabla de combate  (ventaja / desventaja / empate)
 *   • Sistema de vidas
 *   • Efectos de partículas por elemento
 *   • Resolución de combate (jugador ↔ rastro ↔ IA)
 * ============================================================
 */

import * as THREE from "three";

/* ── Definición de elementos ─────────────────────────────── */

export const ELEMENTOS = {
    fuego:  { nombre: "Salsa",    emoji: "🌶️", color: 0xff3300, colorCSS: "#ff3300", iconoCSS: "salsa" },
    agua:   { nombre: "Limonada", emoji: "🍋", color: 0xffee00, colorCSS: "#ffee00", iconoCSS: "limonada" },
    hielo:  { nombre: "Yogurt",   emoji: "🍦", color: 0x99ddff, colorCSS: "#99ddff", iconoCSS: "yogurt" },
    aire:   { nombre: "Algodón",  emoji: "☁️", color: 0xffffff, colorCSS: "#ffffff", iconoCSS: "algodon" },
    normal: { nombre: "Normal",   emoji: "⚡", color: 0xaaaaaa, colorCSS: "#aaaaaa", iconoCSS: "salsa"   }
};

/**
 * Tabla de ventajas:
 *   fuego  (Salsa)    → gana a:  hielo (Yogurt)    | pierde contra: agua (Limonada) | empata: aire (Algodón)
 *   agua   (Limonada) → gana a:  fuego (Salsa)     | pierde contra: aire (Algodón)  | empata: hielo (Yogurt)
 *   hielo  (Yogurt)   → gana a:  aire  (Algodón)   | pierde contra: fuego (Salsa)   | empata: agua (Limonada)
 *   aire   (Algodón)  → gana a:  agua  (Limonada)  | pierde contra: hielo (Yogurt)  | empata: fuego (Salsa)
 */
export const TABLA_COMBATE = {
    fuego:  { gana: "hielo",  pierde: "agua",  empata: "aire"  },
    agua:   { gana: "fuego",  pierde: "aire",  empata: "hielo" },
    hielo:  { gana: "aire",   pierde: "fuego", empata: "agua"  },
    aire:   { gana: "agua",   pierde: "hielo", empata: "fuego" },
    normal: { gana: null,     pierde: null,    empata: null    }
};

/** Retorna "gana" | "pierde" | "empata" desde la perspectiva del atacante */
export function resolverCombate(elementoAtacante, elementoDefensor) {
    const reglas = TABLA_COMBATE[elementoAtacante];
    if (!reglas) return "empata";
    if (reglas.gana   === elementoDefensor) return "gana";
    if (reglas.pierde === elementoDefensor) return "pierde";
    return "empata";
}

/** Nombre del efecto visual para este par de elementos */
export function efectoPorCombate(elementoAtacante, elementoDefensor) {
    const clave = `${elementoAtacante}-${elementoDefensor}`;
    const efectos = {
        "agua-fuego":  "vapor",
        "fuego-agua":  "vapor",
        "fuego-hielo": "derretido",
        "hielo-fuego": "derretido",
        "hielo-aire":  "congelamiento",
        "aire-hielo":  "congelamiento",
        "aire-agua":   "dispersion",
        "agua-aire":   "dispersion"
    };
    return efectos[clave] || "chispa";
}

/* ── Sistema de Vidas ────────────────────────────────────── */

export const CONFIG_VIDAS = {
    vidasIniciales: 3,
    invulnerabilidadMs: 1200  // ms de gracia tras recibir daño
};

export class SistemaVidas {
    constructor(total = CONFIG_VIDAS.vidasIniciales) {
        this.total   = total;
        this.actuales = total;
        this.ultimoDaño = 0;
        this.muerto  = false;
        this.onDaño  = null;   // callback(vidasRestantes)
        this.onMuerte = null;  // callback()
    }

    recibirDaño() {
        if (this.muerto) return false;
        const ahora = performance.now();
        if (ahora - this.ultimoDaño < CONFIG_VIDAS.invulnerabilidadMs) return false;

        this.ultimoDaño = ahora;
        this.actuales = Math.max(0, this.actuales - 1);

        if (this.onDaño) this.onDaño(this.actuales);

        if (this.actuales <= 0) {
            this.muerto = true;
            if (this.onMuerte) this.onMuerte();
        }

        return true;
    }

    estaBajoDeVida() {
        return this.actuales <= Math.ceil(this.total / 2);
    }

    get porcentaje() {
        return this.actuales / this.total;
    }
}

/* ── Partículas ──────────────────────────────────────────── */

const PARTICULAS_POOL = [];

function obtenerParticula(scene) {
    let mesh = PARTICULAS_POOL.find(p => !p.visible);
    if (!mesh) {
        const geo = new THREE.SphereGeometry(0.12, 6, 6);
        const mat = new THREE.MeshBasicMaterial({ transparent: true });
        mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);
        PARTICULAS_POOL.push(mesh);
    }
    mesh.visible = true;
    return mesh;
}

/**
 * Lanza un burst de partículas en la posición indicada.
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} posicion
 * @param {string} tipoEfecto  "vapor"|"derretido"|"congelamiento"|"dispersion"|"chispa"
 */
export function lanzarEfectoVisual(scene, posicion, tipoEfecto) {
    const config = {
        vapor:         { color: 0xdddddd, count: 14, vel: 0.09, vida: 800,  escala: 1.4 },
        derretido:     { color: 0xff6600, count: 12, vel: 0.12, vida: 700,  escala: 1.2 },
        congelamiento: { color: 0x88ccff, count: 16, vel: 0.07, vida: 900,  escala: 1.6 },
        dispersion:    { color: 0xffee44, count: 18, vel: 0.14, vida: 600,  escala: 1.0 },
        chispa:        { color: 0xffffff, count: 8,  vel: 0.10, vida: 500,  escala: 1.0 },
        daño:          { color: 0xff0000, count: 6,  vel: 0.06, vida: 400,  escala: 0.8 },
        muerte:        { color: 0xff4400, count: 30, vel: 0.18, vida: 1200, escala: 2.0 }
    };

    const cfg = config[tipoEfecto] || config.chispa;

    for (let i = 0; i < cfg.count; i++) {
        const p = obtenerParticula(scene);
        p.material.color.setHex(cfg.color);
        p.material.opacity = 1;
        p.position.set(posicion.x, posicion.y + 0.3, posicion.z);
        p.scale.setScalar(cfg.escala);

        const vel = new THREE.Vector3(
            (Math.random() - 0.5) * cfg.vel * 2,
            Math.random() * cfg.vel + 0.03,
            (Math.random() - 0.5) * cfg.vel * 2
        );

        const inicio = performance.now();
        const vida   = cfg.vida + Math.random() * 200;

        (function animar() {
            const t = (performance.now() - inicio) / vida;
            if (t >= 1) { p.visible = false; return; }
            p.position.addScaledVector(vel, 0.016 * 60);
            vel.y -= 0.002;
            p.material.opacity = 1 - t;
            p.scale.setScalar(cfg.escala * (1 - t * 0.5));
            requestAnimationFrame(animar);
        })();
    }
}

/* ── Flash de daño en pantalla ───────────────────────────── */

export function flashDaño() {
    let overlay = document.getElementById("damage-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "damage-overlay";
        overlay.style.cssText = `
            position:fixed;inset:0;pointer-events:none;z-index:5000;
            background:rgba(255,0,0,0);transition:background 0.08s ease;
        `;
        document.body.appendChild(overlay);
    }
    overlay.style.background = "rgba(255,0,0,0.35)";
    setTimeout(() => { overlay.style.background = "rgba(255,0,0,0)"; }, 200);
}

/* ── Actualizar HUD de vidas ─────────────────────────────── */

export function actualizarHUDVidas(vidas, total) {
    const contenedor = document.getElementById("hud-vidas");
    if (!contenedor) return;

    // Usar corazones emoji simples — compatible con el HUD original
    let html = "";
    for (let i = 0; i < total; i++) {
        html += i < vidas ? "❤️ " : "🖤 ";
    }
    contenedor.innerHTML = html;

    // Barra opcional (solo si existe en el DOM)
    const barra = document.getElementById("hud-barra-vida");
    if (barra) {
        const pct = (vidas / total) * 100;
        barra.style.width = pct + "%";
        barra.style.background = pct > 50 ? "#22dd55" : pct > 25 ? "#ffaa00" : "#ff2222";
    }
}

/* ── Indicador flotante de combate ───────────────────────── */

export function mostrarIndicadorCombate(texto, colorCSS, x, y) {
    const div = document.createElement("div");
    div.className = "indicador-combate";
    div.textContent = texto;
    div.style.cssText = `
        position:fixed;left:${x}px;top:${y}px;
        color:${colorCSS};font-family:'Orbitron',sans-serif;
        font-size:1.1rem;font-weight:800;pointer-events:none;
        z-index:6000;text-shadow:0 0 8px currentColor;
        animation:subirFade 0.9s ease forwards;
    `;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 900);
}

/* ── CSS de animación (inyectado una sola vez) ───────────── */

if (!document.getElementById("elementos-style")) {
    const s = document.createElement("style");
    s.id = "elementos-style";
    s.textContent = `
        @keyframes subirFade {
            0%   { opacity:1; transform:translateY(0) scale(1); }
            100% { opacity:0; transform:translateY(-40px) scale(1.3); }
        }
        .vida-corazon { font-size:1.3rem; margin:0 2px; transition:opacity 0.3s; }
    `;
    document.head.appendChild(s);
}
