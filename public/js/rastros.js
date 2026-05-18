/**
 * ============================================================
 *  rastros.js — Kitchen Arena · Sistema de Rastros / Líneas
 * ============================================================
 *  • Rastros continuos con colisiones reales
 *  • Cada segmento recuerda su elemento y propietario
 *  • Detección de colisión rastro↔jugador con resolución
 *    elemental
 *  • Los rastros bloquean el camino (sólidos)
 *  • Decoración visual por elemento (emisivo, glow)
 * ============================================================
 */

import * as THREE from "three";
import { ELEMENTOS } from "./elementos.js";

/* ── Configuración ───────────────────────────────────────── */

const CFG = {
    radioRastro:     0.45,   // tamaño visual del humo
    radioColision:   0.50,   // radio para detección de choque (generoso)
    distanciaMinima: 0.40,   // solo crear segmento si se movió esta distancia
    vidaRastroMs:    4000,   // cuánto dura un rastro (4 segundos)
    maxRastros:      280,    // máximo total en escena
    alturaRastro:    0.2     // Y fija sobre el piso
};

/* ── Geometría compartida (humo) ───────────── */

const GEO_RASTRO = new THREE.SphereGeometry(CFG.radioRastro, 12, 12);

/* ── Colores por elemento ─────────────────────────────────── */

const COLORES_ELEMENTO = {
    fuego:  0xff3300,
    agua:   0xffee00,
    hielo:  0x55ddff,
    aire:   0xff1493,
    normal: 0x888888
};

/* ── Mapa de materiales base ─────────────────────────────── */

const materialesBase = {};

function obtenerMaterial(elemento) {
    if (materialesBase[elemento]) return materialesBase[elemento];
    const hex = COLORES_ELEMENTO[elemento] ?? COLORES_ELEMENTO.normal;
    const mat = new THREE.MeshBasicMaterial({ 
        color: hex, 
        transparent: true, 
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    materialesBase[elemento] = mat;
    return mat;
}

/* ── Clase Rastro ────────────────────────────────────────── */

export class GestorRastros {
    /**
     * @param {THREE.Scene} scene
     */
    constructor(scene) {
        this.scene    = scene;
        this.segmentos = [];              // { mesh, propietario, elemento, expira }
        this._ultimaPos = {};             // propietario → THREE.Vector3
    }

    /**
     * Crear un nuevo segmento de rastro.
     * @param {THREE.Vector3} posicion
     * @param {string} propietario  "jugador" | "IA" | socket.id
     * @param {string} elemento     fuego|agua|hielo|aire|normal
     */
    /**
     * Crear un nuevo segmento de rastro.
     * @param {THREE.Vector3} posicion
     * @param {string} propietario  "jugador" | "IA" | socket.id
     * @param {string} elemento     fuego|agua|hielo|aire|normal
     */
    agregar(posicion, propietario, elemento) {
        const ultima = this._ultimaPos[propietario];
        if (ultima && ultima.distanceTo(posicion) < CFG.distanciaMinima) return;

        this._ultimaPos[propietario] = posicion.clone();

        if (this.segmentos.length >= CFG.maxRastros) {
            this._eliminarSegmento(0);
        }

        const mat  = obtenerMaterial(elemento); // Material compartido (sin clonar!)
        const mesh = new THREE.Mesh(GEO_RASTRO, mat);
        mesh.position.set(posicion.x, CFG.alturaRastro, posicion.z);
        mesh.castShadow    = false;
        mesh.receiveShadow = false;
        mesh.userData = { propietario, elemento };

        this.scene.add(mesh);

        const expira = performance.now() + CFG.vidaRastroMs;
        this.segmentos.push({ mesh, propietario, elemento, expira });

        setTimeout(() => this._iniciarFade(mesh), CFG.vidaRastroMs - 600);
        setTimeout(() => this._eliminarPorMesh(mesh),  CFG.vidaRastroMs);
    }

    /** Detectar colisión de una posición (jugador/IA) con rastros ajenos */
    detectarColision(posicion, propietarioPropio) {
        const r2 = CFG.radioColision * CFG.radioColision;
        const x  = posicion.x;
        const z  = posicion.z;

        for (const seg of this.segmentos) {
            if (seg.propietario === propietarioPropio) continue;
            const dx = seg.mesh.position.x - x;
            const dz = seg.mesh.position.z - z;
            if (dx * dx + dz * dz < r2) return seg;
        }
        return null;
    }

    /** Limpiar todos los rastros del mapa */
    limpiarTodo() {
        for (const seg of this.segmentos) {
            this.scene.remove(seg.mesh);
        }
        this.segmentos.length = 0;
        this._ultimaPos = {};
    }

    /** Eliminar rastros de un propietario específico (al morir) */
    limpiarPropietario(propietario) {
        for (let i = this.segmentos.length - 1; i >= 0; i--) {
            if (this.segmentos[i].propietario === propietario) {
                this._eliminarSegmento(i);
            }
        }
        delete this._ultimaPos[propietario];
    }

    /** Tick del sistema: eliminar segmentos expirados */
    actualizar() {
        const ahora = performance.now();
        for (let i = this.segmentos.length - 1; i >= 0; i--) {
            if (this.segmentos[i].expira < ahora) {
                this._eliminarSegmento(i);
            }
        }
    }

    /* ── Privados ─────────────────────────────────────────── */

    _eliminarSegmento(index) {
        const seg = this.segmentos[index];
        if (!seg) return;
        this.scene.remove(seg.mesh);
        // No llamamos a seg.mat.dispose() porque los materiales se comparten y se reutilizan
        this.segmentos.splice(index, 1);
    }

    _eliminarPorMesh(mesh) {
        const i = this.segmentos.findIndex(s => s.mesh === mesh);
        if (i !== -1) this._eliminarSegmento(i);
    }

    _iniciarFade(mesh) {
        if (!mesh.parent) return;
        const duracion = 600;
        const inicio   = performance.now();

        (function fade() {
            if (!mesh.parent) return;
            const t = (performance.now() - inicio) / duracion;
            if (t >= 1) { 
                mesh.scale.set(0, 0, 0);
                return; 
            }
            // En vez de alterar la opacidad del material compartido, reducimos su escala hacia cero de forma fluida
            const s = Math.max(0, 1 - t);
            mesh.scale.set(s, s, s);
            mesh.position.y += 0.005; // se eleva un poco
            requestAnimationFrame(fade);
        })();
    }
}

/* ── Utilidad: obtener color CSS del elemento ────────────── */
export function colorCSSElemento(elemento) {
    return ELEMENTOS[elemento]?.colorCSS ?? "#aaaaaa";
}
