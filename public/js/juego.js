import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { GestorRastros } from "./rastros.js";
import { AgentIA, ESTADO_IA } from "./ia.js";

const socket = io();
let nombreJugador = localStorage.getItem("nombreJugador") || "";
let escenarioSeleccionado = localStorage.getItem("escenarioSeleccionado") || "1";
let dificultadJuego = localStorage.getItem("dificultadJuego") || "normal";
let conectado = false;
let ultimoCambioCaos = performance.now();
const CAOS_INTERVALO_MS = 10000;
const manager = new THREE.LoadingManager();

let scene, camera, renderer, contenedor;
let ambientLight, directionalLight, spotLight, piso;
const teclas = {};
let jugadorLocal = null;
let jugadorBaseY = 0.5;
const clock = new THREE.Clock();
const LIMITE_ESCENARIO = 32;
const obstaculos = [];
const itemsElemento = [];
const jugadorBB = new THREE.Box3();
const modelosFlotantes = [];
const powerUps = [];
let aiAgent = null;
let agentIAMesh = null;
let gestorRastros = null;
let jugadorMuerto = false;

const sonidos = {
    colision: new Audio("./music/colision.mp3"),
    ganar: new Audio("./music/win.mp3"),
    perder: new Audio("./music/lose.mp3"),
    Selection: new Audio("./music/selection.mp3"),
    powerUp: new Audio("./music/pick_up.mp3")
}

const musicaEscenario = {
    "1": new Audio("./music/firstlevel.mp3"),
    "2": new Audio("./music/creepylevel.mp3"),
    "3": new Audio("./music/hardlevel.mp3")
}


// === SISTEMA DE COMBATE Y VIDAS (inline, sin dependencias de módulo) ===
const COMBATE = {
    fuego: { gana: 'hielo', pierde: 'agua' },
    agua: { gana: 'fuego', pierde: 'aire' },
    hielo: { gana: 'aire', pierde: 'fuego' },
    aire: { gana: 'agua', pierde: 'hielo' }
};
function combateResultado(atk, def) {
    const t = COMBATE[atk];
    if (!t) return 'empata';
    if (t.gana === def) return 'gana';
    if (t.pierde === def) return 'pierde';
    return 'empata';
}
let vidasJugador = 3;
let vidasIA = 3;
let puntajeJugador = 0;
let tDmgJugador = 0;
let tDmgIA = 0;
const INVUL_MS = 1400;

function sumarPuntos(cantidad) {
    puntajeJugador += cantidad;
    const el = document.getElementById('hud-puntaje');
    if (el) el.textContent = puntajeJugador;

    // Pequeño efecto visual en el texto
    if (el) {
        el.style.transform = 'scale(1.3)';
        setTimeout(() => el.style.transform = 'scale(1)', 200);
    }

    if (nombreJugador && socket) {
        socket.emit('GuardarPuntaje', {
            nombreJugador: nombreJugador,
            puntaje: puntajeJugador
        });
    }
}
function dañarJugador(idAtacante) {
    if (jugadorMuerto) return;
    const now = performance.now();
    if (now - tDmgJugador < INVUL_MS) return;
    tDmgJugador = now;
    vidasJugador = Math.max(0, vidasJugador - 1);
    _refrescarHUDJugador();
    _flashPantalla('rgba(255,0,0,0.45)');
    console.log('[COMBATE] Jugador pierde 1 vida. Quedan:', vidasJugador);
    reproducirSonido('colision');
    if (vidasJugador <= 0) {
        jugadorMuerto = true;
        reproducirSonido("perder");
        if (idAtacante) socket.emit("FuiEliminado", idAtacante);

        setTimeout(() => new bootstrap.Modal(document.getElementById('perderModal')).show(), 700);
    } else {
        if (idAtacante) socket.emit("RecibiDano", idAtacante);
    }
}
function dañarIA() {
    if (!aiAgent || aiAgent.muerta) return;
    const now = performance.now();
    if (now - tDmgIA < INVUL_MS) return;
    tDmgIA = now;
    vidasIA = Math.max(0, vidasIA - 1);
    _refrescarHUDIA();
    reproducirSonido('colision');
    console.log('[COMBATE] IA pierde 1 vida. Quedan:', vidasIA);
    if (vidasIA <= 0) {
        sumarPuntos(30);
        aiAgent.muerta = true;
        setTimeout(() => new bootstrap.Modal(document.getElementById('ganarModal')).show(), 700);
    } else {
        sumarPuntos(10);
    }
}
function verificarCombate() {
    if (!jugadorLocal) return;

    // --- PVE (VS IA) ---
    if (aiAgent && !aiAgent.muerta) {
        const dist = aiAgent.mesh.position.distanceTo(jugadorLocal.position);
        if (dist < 2.0) {
            const res = combateResultado(aiAgent.elementoIA, elementoActual);
            if (res === 'gana') dañarJugador('IA');
            else if (res === 'pierde') dañarIA();
        }
        if (gestorRastros) {
            const hit2 = gestorRastros.detectarColision(aiAgent.mesh.position, 'IA');
            if (hit2 && hit2.propietario === 'jugador') {
                const res3 = combateResultado(hit2.elemento, aiAgent.elementoIA);
                if (res3 === 'gana') dañarIA();
            }
        }
    }

    // --- PVP (VS OTROS JUGADORES) ---
    for (const id in jugadoresRemotos) {
        if (id === 'IA') continue;
        const remoto = jugadoresRemotos[id];
        const elementoRemoto = remoto.userData.elemento || 'normal';

        // Colisión cuerpo a cuerpo con otro jugador
        const dist = remoto.position.distanceTo(jugadorLocal.position);
        if (dist < 2.0) {
            const res = combateResultado(elementoRemoto, elementoActual);
            if (res === 'gana') dañarJugador(id); // El otro te gana -> pierdes vida.
            // Si el otro pierde, él calculará su propio daño en su cliente, no se lo hacemos nosotros.
        }
    }

    // --- COLISIÓN CON CUALQUIER RASTRO (IA o PVP) ---
    if (gestorRastros && !jugadorMuerto) {
        // Detecta si YO choco con un rastro ajeno (cualquiera que no sea 'jugador')
        const hit = gestorRastros.detectarColision(jugadorLocal.position, 'jugador');
        if (hit) {
            const res2 = combateResultado(hit.elemento, elementoActual);
            if (res2 === 'gana') dañarJugador(hit.propietario); // El rastro ajeno me gana -> pierdo vida.
        }
    }
}
function _refrescarHUDJugador() {
    const el = document.getElementById('hud-vidas');
    if (!el) return;
    let h = '';
    for (let i = 0; i < 3; i++) h += i < vidasJugador ? '❤️ ' : '🖤 ';
    el.innerHTML = h;
}
function _refrescarHUDIA() {
    const el = document.getElementById('hud-ia');
    if (!el) return;
    const elem = aiAgent ? aiAgent.elementoIA : '?';
    let h = '';
    for (let i = 0; i < 3; i++) h += i < vidasIA ? '❤️' : '🖤';
    el.textContent = 'IA • ' + elem + ' • ' + h;
}
function _flashPantalla(color) {
    let ov = document.getElementById('dmg-overlay');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = 'dmg-overlay';
        ov.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;transition:background 0.12s ease';
        document.body.appendChild(ov);
    }
    ov.style.background = color;
    setTimeout(() => { ov.style.background = 'transparent'; }, 280);
}
// ============================================================

const RENDER_CONFIG = {
    pixelRatioMax: 1.25
};
const RED_CONFIG = {
    intervaloEmisionPosicionMs: 50
};
const FLOTACION_JUGADOR = {
    amplitud: 0.12,
    velocidad: 2.0
};
const FONDO_ESCENARIO = {
    "1": 0x76b5c5, // Celeste vivo
    "2": 0x151b24, // Azul muy oscuro (tétrico)
    "3": 0x080404  // Casi negro / pesadilla
};
const TEXTURA_MESA_ESCENARIO = {
    "1": "./mesa.png",
    "2": "./mesa2.png",
    "3": "./mesa.jpg"
};
const ANIMACION_WALK_LATERAL = {
    inclinacionMax: 0.35,
    oscilacionYaw: 0.12,
    velocidad: 12,
    suavizado: 0.2
};
const CAMARA_JUGADOR = {
    offsetX: 0,
    offsetY: 7.2,
    offsetZ: 4.2,
    suavizado: 0.12,
    alturaMirada: 0.4
};
const ANIMACION_ENEMIGO = {
    amplitudFlotacion: 0.2,
    velocidadFlotacion: 2.8,
    inclinacionMax: 0.6,
    oscilacionYaw: 0.2,
    velocidadWobble: 18,
    suavizadoInclinacion: 0.28
};
let inclinacionLateralActual = 0;
let anguloJugador = 0; // Ángulo de rotación del jugador (Y-axis heading)
const objetivoCamaraPos = new THREE.Vector3();
const objetivoCamaraLookAt = new THREE.Vector3();
let ultimaEmisionPosicion = 0;

// jugadores remotos
const jugadoresRemotos = {};
const jugadoresRemotosEnCarga = new Set();
const posicionesPendientesRemotos = {};
let plantillaJugadorRemotoPromise = null;

// Elementos válidos para asignar al inicio
const ELEMENTOS_REALES = ["fuego", "agua", "hielo", "aire"];
let elementoActual = ELEMENTOS_REALES[Math.floor(Math.random() * ELEMENTOS_REALES.length)];

const mapeoElementoIcono = {
    fuego: "salsa",
    agua: "limonada",
    hielo: "yogurt",
    aire: "algodon",
    normal: "salsa"
};

const coloresElemento = {
    fuego: 0xff3300,
    agua: 0xffee00,
    hielo: 0x55ddff,
    aire: 0xff69b4,
    normal: 0x888888
};

const rastros = [];

function actualizarUIElementos() {
    // Actualizar elemento actual
    const iconoActual = document.getElementById("icono-elemento-actual");
    if (iconoActual) {
        const nombreIcono = mapeoElementoIcono[elementoActual] || "normal";
        iconoActual.src = `iconos/${nombreIcono}.png`;
    }

}

function aplicarColorModelo(modelo, colorHex) {
    modelo.traverse((child) => {
        if (!child.isMesh) return;

        if (Array.isArray(child.material)) {
            child.material = child.material.map((material) => {
                const nuevoMaterial = material.clone();
                if (nuevoMaterial.color) {
                    nuevoMaterial.color.setHex(colorHex);
                }
                return nuevoMaterial;
            });
            return;
        }

        child.material = child.material.clone();
        if (child.material.color) {
            child.material.color.setHex(colorHex);
        }
    });
}

async function obtenerPlantillaJugadorRemoto() {
    if (!plantillaJugadorRemotoPromise) {
        plantillaJugadorRemotoPromise = cargarModelo3D(
            "./models/cuchara",
            "cuchara-remoto-plantilla",
            new THREE.Vector3(2, 2, 2)
        )
            .then((modelo) => {
                modelo.rotation.x = -Math.PI / 2;
                aplicarColorModelo(modelo, 0xff4d6d);
                return modelo;
            })
            .catch((error) => {
                console.error("No se pudo cargar el modelo remoto:", error);
                plantillaJugadorRemotoPromise = null;
                return null;
            });
    }

    return plantillaJugadorRemotoPromise;
}

async function crearJugadorRemotoModelo() {
    const plantilla = await obtenerPlantillaJugadorRemoto();
    if (plantilla) {
        return plantilla.clone(true);
    }

    // Fallback visual si el modelo llegara a fallar.
    return new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0xff4d6d })
    );
}

function registrarModeloFlotante(modelo, options = {}) {
    if (!modelo) return;

    const baseY = modelo.position.y;
    modelosFlotantes.push({
        modelo,
        baseY,
        amplitud: options.amplitud ?? 0.25,
        velocidad: options.velocidad ?? 1.3,
        fase: options.fase ?? Math.random() * Math.PI * 2,
        rotacionY: options.rotacionY ?? 0.6
    });
}

function animarModelosFlotantes(tiempo) {
    for (const item of modelosFlotantes) {
        if (camera) {
            const distancia2 = item.modelo.position.distanceToSquared(camera.position);
            if (distancia2 > 2500) continue;
        }

        // Mantiene X/Z fijos y solo oscila en Y para evitar invadir otros espacios.
        item.modelo.position.y = item.baseY + Math.sin(tiempo * item.velocidad + item.fase) * item.amplitud;
        item.modelo.rotation.y += item.rotacionY * 0.01;
    }
}

function animarJugadorLocal(tiempo) {
    if (!jugadorLocal) return;

    // Solo sube y baja en Y para que conserve su ubicacion horizontal.
    jugadorLocal.position.y = jugadorBaseY + Math.sin(tiempo * FLOTACION_JUGADOR.velocidad) * FLOTACION_JUGADOR.amplitud;
}

function animarWalkLateralJugador(tiempo) {
    if (!jugadorLocal) return;

    const movIzq = teclas["a"] ? 1 : 0;
    const movDer = teclas["d"] ? 1 : 0;
    // En conducción, la dirección lateral es la dirección de giro
    const direccionLateral = movIzq - movDer;
    const objetivoInclinacion = direccionLateral * ANIMACION_WALK_LATERAL.inclinacionMax;

    inclinacionLateralActual += (objetivoInclinacion - inclinacionLateralActual) * ANIMACION_WALK_LATERAL.suavizado;

    // Wobble solo si nos estamos moviendo adelante/atrás
    const moviendo = teclas["w"] || teclas["s"];
    const wobble = moviendo
        ? Math.sin(tiempo * ANIMACION_WALK_LATERAL.velocidad) * ANIMACION_WALK_LATERAL.oscilacionYaw
        : 0;

    // Aplicar rotaciones usando el orden YXZ para evitar gimbal lock al girar e inclinarse
    jugadorLocal.rotation.order = 'YXZ';
    jugadorLocal.rotation.y = anguloJugador + wobble;
    jugadorLocal.rotation.x = -Math.PI / 2;
    jugadorLocal.rotation.z = inclinacionLateralActual;
}

function inicializarAnimacionEnemigo(mesh, posicionInicial) {
    mesh.userData.animacionEnemigo = {
        baseY: posicionInicial.y,
        inclinacionActual: 0,
        direccionLateral: 0,
        ultimoX: posicionInicial.x,
        ultimoZ: posicionInicial.z,
        fase: Math.random() * Math.PI * 2
    };
}

function animarJugadoresRemotos(tiempo) {
    for (const id in jugadoresRemotos) {
        const mesh = jugadoresRemotos[id];
        const data = mesh.userData.animacionEnemigo;
        if (!data) continue;

        const dx = mesh.position.x - data.ultimoX;
        const dz = mesh.position.z - data.ultimoZ;
        const velocidad = Math.hypot(dx, dz);

        if (data.objetivoX !== undefined && data.objetivoZ !== undefined) {
            mesh.position.x += (data.objetivoX - mesh.position.x) * 0.25;
            mesh.position.z += (data.objetivoZ - mesh.position.z) * 0.25;
        }

        if (velocidad > 0.001) {
            const lateral = Math.abs(dx) >= Math.abs(dz)
                ? Math.sign(dx)
                : 0;
            data.direccionLateral = lateral;
            data.ultimoX = mesh.position.x;
            data.ultimoZ = mesh.position.z;
        } else {
            data.direccionLateral *= 0.92;
        }

        const objetivoInclinacion = data.direccionLateral * ANIMACION_ENEMIGO.inclinacionMax;
        data.inclinacionActual += (objetivoInclinacion - data.inclinacionActual) * ANIMACION_ENEMIGO.suavizadoInclinacion;

        const wobble = Math.sin(tiempo * ANIMACION_ENEMIGO.velocidadWobble + data.fase)
            * ANIMACION_ENEMIGO.oscilacionYaw
            * data.direccionLateral;

        mesh.position.y = data.baseY + Math.sin(tiempo * ANIMACION_ENEMIGO.velocidadFlotacion + data.fase)
            * ANIMACION_ENEMIGO.amplitudFlotacion;

        // Usar orden YXZ para alinearlo con el giro e inclinación
        mesh.rotation.order = 'YXZ';
        mesh.rotation.y = (mesh.userData.angulo || 0) + wobble;
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = data.inclinacionActual;
    }
}

function actualizarCamaraJugadorLocal() {
    if (!camera || !jugadorLocal) return;

    // Distancia y altura ideal detrás del jugador (estilo Mario Kart - más picada)
    const distanciaCamara = 6.2;
    const alturaCamara = 5.2;

    // Posición ideal de la cámara detrás del jugador
    const targetCamX = jugadorLocal.position.x + Math.sin(anguloJugador) * distanciaCamara;
    const targetCamZ = jugadorLocal.position.z + Math.cos(anguloJugador) * distanciaCamara;
    const targetCamY = jugadorBaseY + alturaCamara;

    objetivoCamaraPos.set(targetCamX, targetCamY, targetCamZ);

    // Lerp suave para la posición de la cámara (cámara fluida con inercia de giro)
    camera.position.lerp(objetivoCamaraPos, 0.08);

    // Mirar al jugador, ligeramente hacia donde apunta el tenedor
    objetivoCamaraLookAt.set(
        jugadorLocal.position.x - Math.sin(anguloJugador) * 1.5,
        jugadorBaseY + CAMARA_JUGADOR.alturaMirada,
        jugadorLocal.position.z - Math.cos(anguloJugador) * 1.5
    );
    camera.lookAt(objetivoCamaraLookAt);
}

function configurarSockets() {
    socket.on("connect", () => {
        console.log("Conectado al servidor");

        socket.emit("Iniciar", nombreJugador);
        socket.emit("CambiarElemento", { elemento: elementoActual });
        conectado = true;
    });

    socket.on("listaJugadores", (lista) => {
        actualizarJugadoresRemotos(lista);
    });

    socket.on("SumaPuntos", (puntos) => {
        sumarPuntos(puntos);
    });

    socket.on("powerUpsActualizados", async (listaPowerUps) => {
        // console.log("PowerUps recibidos:", listaPowerUps);

        limpiarPowerUps();

        for (const data of listaPowerUps) {
            await crearPowerUpDesdeServidor(data);
        }
    });

    socket.on("RastroCreado", (data) => {
        if (!gestorRastros) return;
        gestorRastros.agregar(new THREE.Vector3(data.x, data.y, data.z), data.id, data.elemento);
    });

    socket.on("GanastePartida", () => {
        reproducirSonido("ganar");
        setTimeout(() => {
            new bootstrap.Modal(document.getElementById("ganarModal")).show();
        }, 700);
    });
}

function actualizarJugadoresRemotos(lista) {
    const idsActivos = [];

    for (const jugador of lista) {
        idsActivos.push(jugador.id);

        if (jugador.name === nombreJugador) continue;

        posicionesPendientesRemotos[jugador.id] = {
            x: jugador.x,
            y: jugador.y,
            z: jugador.z
        };

        if (!jugadoresRemotos[jugador.id] && !jugadoresRemotosEnCarga.has(jugador.id)) {
            jugadoresRemotosEnCarga.add(jugador.id);

            crearJugadorRemotoModelo()
                .then((modeloRemoto) => {
                    if (!posicionesPendientesRemotos[jugador.id]) return;

                    const posicion = posicionesPendientesRemotos[jugador.id];
                    modeloRemoto.position.set(posicion.x, posicion.y, posicion.z);
                    inicializarAnimacionEnemigo(modeloRemoto, posicion);

                    if (!jugadoresRemotos[jugador.id]) {
                        jugadoresRemotos[jugador.id] = modeloRemoto;
                        scene.add(modeloRemoto);
                    }
                })
                .finally(() => {
                    jugadoresRemotosEnCarga.delete(jugador.id);
                });
        }

        if (jugadoresRemotos[jugador.id]) {
            const mesh = jugadoresRemotos[jugador.id];
            mesh.userData.elemento = jugador.elemento || 'normal';
            mesh.userData.angulo = jugador.angulo || 0;

            // Actualizar color del jugador remoto si cambió de elemento
            if (mesh.userData.elementoAnterior !== mesh.userData.elemento) {
                aplicarColorModelo(mesh, coloresElemento[mesh.userData.elemento] || coloresElemento.normal);
                mesh.userData.elementoAnterior = mesh.userData.elemento;
            }

            const data = mesh.userData.animacionEnemigo;
            if (data) {
                data.objetivoX = jugador.x;
                data.objetivoZ = jugador.z;
                data.baseY = jugador.y;
            } else {
                mesh.position.set(jugador.x, jugador.y, jugador.z);
            }
        }
    }

    for (const id in jugadoresRemotos) {
        // No eliminar la IA local creada en cliente
        if (!idsActivos.includes(id) && id !== 'IA') {
            scene.remove(jugadoresRemotos[id]);
            delete jugadoresRemotos[id];
            delete posicionesPendientesRemotos[id];
        }
    }
}

// --- IA Avanzada (AgentIA) ---
async function spawnAI() {
    if (aiAgent) return;
    try {
        // Reducimos un poco el tamaño de la cuchara (3.5x) para que sea manejable
        const modeloIA = await cargarModelo3D("./models/cuchara", "ia-cuchara", new THREE.Vector3(3.5, 3.5, 3.5));
        aplicarColorModelo(modeloIA, 0xff4d6d);
        const x = (Math.random() * 2 - 1) * 18;
        const z = (Math.random() * 2 - 1) * 18;
        modeloIA.position.set(x, jugadorBaseY, z);
        modeloIA.rotation.x = -Math.PI / 2;
        modeloIA.name = 'IA';
        inicializarAnimacionEnemigo(modeloIA, { x, y: jugadorBaseY, z });
        agentIAMesh = modeloIA;
        jugadoresRemotos['IA'] = modeloIA;
        modeloIA.traverse((child) => { if (child.isMesh) child.castShadow = true; });
        scene.add(modeloIA);

        // Crear AgentIA con obstaculos y gestor de rastros
        aiAgent = new AgentIA(modeloIA, obstaculos, gestorRastros);
        aiAgent.elementoIA = ELEMENTOS_REALES[Math.floor(Math.random() * ELEMENTOS_REALES.length)];
        aiAgent.vidasIA = 3;
        vidasIA = 3;
        _refrescarHUDIA();
        console.log('[IA] Generada en', x, z, '| Elemento:', aiAgent.elementoIA);
    } catch (e) {
        console.error('No se pudo crear IA:', e);
    }
}

function updateAI(tiempo) {
    if (!aiAgent || !jugadorLocal || aiAgent.muerta) return;

    aiAgent.setElementoJugador(elementoActual);
    aiAgent.actualizar(
        tiempo,
        jugadorLocal.position,
        elementoActual,
        vidasJugador,
        powerUps
    );

    // Rastro de la IA
    if (gestorRastros) {
        gestorRastros.agregar(aiAgent.mesh.position.clone(), 'IA', aiAgent.elementoIA);
    }

    _refrescarHUDIA();
}

function crearEscena() {
    contenedor = document.querySelector(".campo-juego");
    contenedor.innerHTML = "";


    scene = new THREE.Scene();
    const colorFondo = FONDO_ESCENARIO[escenarioSeleccionado] ?? 0x1a1a1a;
    scene.background = new THREE.Color(colorFondo);

    camera = new THREE.PerspectiveCamera(
        60,
        contenedor.clientWidth / contenedor.clientHeight,
        0.1,
        1000
    );

    camera.position.set(0, 8, 12);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(contenedor.clientWidth, contenedor.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER_CONFIG.pixelRatioMax));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    contenedor.appendChild(renderer.domElement);

    // --- CONFIGURACIÓN DE LUCES Y NIEBLA SEGÚN EL ESCENARIO ---

    // Configuraciones comunes para la luz direccional (sombras)
    directionalLight = new THREE.DirectionalLight(0xffffff, 1.4);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.set(2048, 2048);
    directionalLight.shadow.camera.left = -25;
    directionalLight.shadow.camera.right = 25;
    directionalLight.shadow.camera.top = 25;
    directionalLight.shadow.camera.bottom = -25;
    directionalLight.shadow.bias = -0.0005;

    if (escenarioSeleccionado === "1") {
        // ESCENARIO 1: Animado y Vivo
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x445588, 0.6);
        hemiLight.position.set(0, 20, 0);
        scene.add(hemiLight);

        ambientLight = new THREE.AmbientLight(0xffeacc, 0.5);
        scene.add(ambientLight);

        directionalLight.color.setHex(0xffffff);
        directionalLight.intensity = 1.4;
        directionalLight.position.set(12, 25, 8);
        scene.add(directionalLight);

        spotLight = new THREE.SpotLight(0xffaa44, 1.8, 60, Math.PI / 4.5, 0.4, 1.2);
        spotLight.position.set(-5, 18, 12);
        spotLight.target.position.set(0, 0, 0);
        scene.add(spotLight);
        scene.add(spotLight.target);

        scene.fog = null; // Sin niebla

    } else if (escenarioSeleccionado === "2") {
        // ESCENARIO 2: Tétrico y Abandonado
        const hemiLight = new THREE.HemisphereLight(0x444455, 0x111122, 0.3);
        hemiLight.position.set(0, 20, 0);
        scene.add(hemiLight);

        ambientLight = new THREE.AmbientLight(0x223344, 0.3); // Luz azulada pálida
        scene.add(ambientLight);

        directionalLight.color.setHex(0x556688); // Luz de luna
        directionalLight.intensity = 0.8;
        directionalLight.position.set(10, 20, -5);
        scene.add(directionalLight);

        spotLight = new THREE.SpotLight(0xff5522, 2.5, 50, Math.PI / 5, 0.8, 1.8); // Foco naranja oxidado
        spotLight.position.set(0, 15, 0);
        spotLight.target.position.set(0, 0, 0);
        scene.add(spotLight);
        scene.add(spotLight.target);

        // Añadir una ligera niebla para dar misterio
        scene.fog = new THREE.FogExp2(FONDO_ESCENARIO["2"], 0.025);

    } else {
        // ESCENARIO 3: Oscuro pero jugable

        ambientLight = new THREE.AmbientLight(0x403040, 0.75);
        scene.add(ambientLight);

        directionalLight.color.setHex(0xffaa88);
        directionalLight.intensity = 1.2;
        directionalLight.position.set(0, 20, 10);
        scene.add(directionalLight);

        // Spotlight más abierto
        spotLight = new THREE.SpotLight(
            0xffffff,
            2,
            80,
            Math.PI / 3,
            0.4,
            1
        );

        spotLight.position.set(0, 18, 8);
        spotLight.target.position.set(0, 0, 0);

        scene.add(spotLight);
        scene.add(spotLight.target);

        // Niebla MUCHO menos intensa
        scene.fog = new THREE.FogExp2(0x595454, 0.050);
    }

    const textureLoader = new THREE.TextureLoader();
    const rutaTexturaMesa = TEXTURA_MESA_ESCENARIO[escenarioSeleccionado] || "./mesa.png";
    const texturaPiso = textureLoader.load(rutaTexturaMesa);

    texturaPiso.wrapS = THREE.RepeatWrapping;
    texturaPiso.wrapT = THREE.RepeatWrapping;
    texturaPiso.repeat.set(20, 20);

    piso = new THREE.Mesh(
        new THREE.PlaneGeometry(72, 72),
        new THREE.MeshStandardMaterial({ map: texturaPiso })
    );

    piso.rotation.x = -Math.PI / 2;
    piso.receiveShadow = true;
    scene.add(piso);
    window.addEventListener("resize", actualizarTamanoRenderer);
    actualizarTamanoRenderer();
}

manager.onStart = function (url, itemsLoaded, itemsTotal) {
    //console.log("Started loading file:", url);
    //console.log("Loaded", itemsLoaded, "of", itemsTotal, "files.");
};

manager.onLoad = function () {
    console.log("Loading complete!");
};

manager.onProgress = function (url, itemsLoaded, itemsTotal) {
    //console.log("Loading file:", url);
    //console.log("Loaded", itemsLoaded, "of", itemsTotal, "files.");
};

manager.onError = function (url) {
    console.log("There was an error loading", url);
};

const cacheModelos = {};

function cargarModelo3D(path, nombre, vectorEscala) {
    const key = path;
    if (cacheModelos[key]) {
        // Clonar el modelo limpio guardado en caché
        const clon = cacheModelos[key].clone();
        clon.name = nombre;
        clon.scale.copy(vectorEscala);
        return Promise.resolve(clon);
    }

    return new Promise((resolve, reject) => {
        const loaderOBJ = new OBJLoader(manager);
        const loaderMTL = new MTLLoader(manager);

        loaderMTL.load(
            path + ".mtl",
            function (materials) {
                materials.preload();
                loaderOBJ.setMaterials(materials);

                loaderOBJ.load(
                    path + ".obj",
                    function (object) {
                        // Guardar una versión limpia (con escala 1,1,1) en la caché
                        const limpio = object.clone();
                        cacheModelos[key] = limpio;

                        object.name = nombre;
                        object.scale.copy(vectorEscala);
                        resolve(object);
                    },
                    undefined,
                    function (error) {
                        console.error("Error cargando OBJ:", error);
                        reject(error);
                    }
                );
            },
            undefined,
            function (error) {
                console.error("Error cargando MTL:", error);
                reject(error);
            }
        );
    });
}

async function cargarJugadorLocalModelo() {
    try {
        // cubo temporal
        jugadorLocal = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({ color: 0x00ffcc })
        );
        jugadorLocal.position.set(0, 0.5, 0);
        jugadorLocal.castShadow = true;
        scene.add(jugadorLocal);

        const modelo = await cargarModelo3D(
            "./models/tenedor",
            "tenedor",
            new THREE.Vector3(3, 3, 3)
        );

        modelo.position.copy(jugadorLocal.position);
        // Rotacion para que el tenedor quede acostado sobre el plano.
        modelo.rotation.x = -Math.PI / 2;
        jugadorBaseY = modelo.position.y;

        scene.remove(jugadorLocal);
        jugadorLocal = modelo;
        jugadorLocal.traverse((child) => {
            if (child.isMesh) child.castShadow = true;
        });
        scene.add(jugadorLocal);

        console.log("Modelo local cargado correctamente");
    } catch (error) {
        console.error("No se pudo cargar el modelo local:", error);
    }
}

function configurarTeclado() {
    window.addEventListener("keydown", (event) => {
        teclas[event.key.toLowerCase()] = true;
        //iniciarMusica();
    });

    window.addEventListener("keyup", (event) => {
        teclas[event.key.toLowerCase()] = false;
    });
}

function moverJugador() {
    if (!jugadorLocal) return;

    const velocidad = 0.30;
    const desplazamiento = new THREE.Vector3();
    let seMovio = false;
    let seRoto = false;

    // Rotar con A y D (estilo Mario Kart)
    if (teclas["a"]) {
        anguloJugador += 0.045; // Sensibilidad del giro
        seRoto = true;
    }
    if (teclas["d"]) {
        anguloJugador -= 0.045;
        seRoto = true;
    }

    // Asegurar rango [0, 2*PI]
    anguloJugador = (anguloJugador + Math.PI * 2) % (Math.PI * 2);

    // Mover adelante/atrás en base al ángulo actual
    if (teclas["w"]) {
        desplazamiento.x = -Math.sin(anguloJugador) * velocidad;
        desplazamiento.z = -Math.cos(anguloJugador) * velocidad;
        seMovio = true;
    }
    if (teclas["s"]) {
        desplazamiento.x = Math.sin(anguloJugador) * (velocidad * 0.6); // Marcha atrás más lenta
        desplazamiento.z = Math.cos(anguloJugador) * (velocidad * 0.6);
        seMovio = true;
    }

    if (!seMovio && !seRoto) return;

    const posicionPropuesta = jugadorLocal.position.clone().add(desplazamiento);
    const dentroDeLimites = Math.abs(posicionPropuesta.x) < LIMITE_ESCENARIO && Math.abs(posicionPropuesta.z) < LIMITE_ESCENARIO;

    if (dentroDeLimites) {
        const posicionAnterior = jugadorLocal.position.clone();

        if (seMovio) {
            jugadorLocal.position.copy(posicionPropuesta);

            crearRastro(jugadorLocal.position, elementoActual);

            socket.emit("CrearRastro", {
                x: jugadorLocal.position.x,
                y: jugadorLocal.position.y,
                z: jugadorLocal.position.z,
                elemento: elementoActual
            });
        }

        if (hayColisionConObstaculo()) {
            jugadorLocal.position.copy(posicionAnterior);
            return;
        }

        const ahora = performance.now();
        if (conectado && (ahora - ultimaEmisionPosicion >= RED_CONFIG.intervaloEmisionPosicionMs)) {
            ultimaEmisionPosicion = ahora;
            socket.emit("Posicion", {
                x: jugadorLocal.position.x,
                y: jugadorLocal.position.y,
                z: jugadorLocal.position.z,
                angulo: anguloJugador
            });
        }
    }
}

function actualizarTamanoRenderer() {
    const ancho = contenedor.clientWidth;
    const alto = contenedor.clientHeight;

    camera.aspect = ancho / alto;
    camera.updateProjectionMatrix();
    renderer.setSize(ancho, alto);
}

window.addEventListener("resize", actualizarTamanoRenderer);

function animate() {
    requestAnimationFrame(animate);
    const tiempo = clock.getElapsedTime();

    animarJugadorLocal(tiempo);

    if (!jugadorMuerto) {
        moverJugador();
        revisarColisionPowerUps();

        // --- Dificultad: Caos en Cocina ---
        if (dificultadJuego === "caos") {
            const ahora = performance.now();
            if (ahora - ultimoCambioCaos >= CAOS_INTERVALO_MS) {
                ultimoCambioCaos = ahora;

                // Cambiar al elemento al que le ganas
                elementoActual = COMBATE[elementoActual].gana;

                // Efecto de feedback visual
                const iconoActual = document.getElementById("icono-elemento-actual");
                if (iconoActual) {
                    iconoActual.style.transform = 'scale(1.5) rotate(15deg)';
                    iconoActual.style.transition = 'transform 0.3s ease';
                    setTimeout(() => iconoActual.style.transform = 'scale(1) rotate(0deg)', 300);
                }

                // Notificar al servidor en PVP
                if (conectado) {
                    socket.emit("CambiarElemento", { elemento: elementoActual });
                }

                console.log("[CAOS] Elemento rotado a:", elementoActual);

                // Si estamos jugando contra la IA, la IA cambia al elemento que nos gana
                if (aiAgent && !aiAgent.muerta) {
                    // El elemento que vence a nuestro nuevo elementoActual es COMBATE[elementoActual].pierde
                    const elementoContraJugador = COMBATE[elementoActual].pierde;
                    aiAgent.elementoIA = elementoContraJugador;

                    // Actualizar color de la IA visualmente
                    aplicarColorModelo(aiAgent.mesh, coloresElemento[elementoContraJugador] || coloresElemento.normal);
                    _refrescarHUDIA();

                    console.log("[CAOS] IA rotada a:", elementoContraJugador, "para intentar vencer a", elementoActual);
                }
            }
        }
    }

    animarWalkLateralJugador(tiempo);
    animarJugadoresRemotos(tiempo);
    animarModelosFlotantes(tiempo);
    actualizarCamaraJugadorLocal();

    if (aiAgent) updateAI(tiempo);

    verificarCombate();

    // Tick del gestor de rastros (limpia expirados)
    if (gestorRastros) gestorRastros.actualizar();

    renderer.render(scene, camera);
}
async function cargarEscenario1() {
    reproducirMusica("1");
    const florero = await cargarModelo3D("./models/florero", "florero", new THREE.Vector3(6, 6, 6));
    florero.position.set(-27, 0, -6);
    florero.rotation.y = Math.PI / 2;
    scene.add(florero);
    obstaculos.push({ modelo: florero });

    const mostaza = await cargarModelo3D("./models/mostaza", "mostaza", new THREE.Vector3(0.8, 0.8, 0.8));
    mostaza.position.set(6, 0, -17);
    scene.add(mostaza);
    obstaculos.push({ modelo: mostaza });

    const mayonesa = await cargarModelo3D("./models/mayonesa", "mayonesa", new THREE.Vector3(0.8, 0.8, 0.8));
    mayonesa.position.set(-5, 0, 5);
    scene.add(mayonesa);
    obstaculos.push({ modelo: mayonesa });

    const saleros = await cargarModelo3D("./models/saleros", "saleros", new THREE.Vector3(20, 20, 20));
    saleros.position.set(19, 0, 4);
    saleros.rotation.y = Math.PI / 2;
    scene.add(saleros);
    obstaculos.push({ modelo: saleros });

    const taza = await cargarModelo3D("./models/taza", "taza", new THREE.Vector3(15, 15, 15));
    taza.position.set(-10, 0, 18);
    taza.rotation.y = Math.PI / 2;
    scene.add(taza);
    obstaculos.push({ modelo: taza });

    const jugo = await cargarModelo3D("./models/jugo", "jugo", new THREE.Vector3(15, 15, 15));
    jugo.position.set(2, 0, 10);
    jugo.rotation.y = Math.PI / 2;
    scene.add(jugo);
    obstaculos.push({ modelo: jugo });
}

async function cargarEscenario2() {
    // SUPER POBLADO
    reproducirMusica("2");
    const florero1 = await cargarModelo3D("./models/florero", "florero1", new THREE.Vector3(6, 6, 6));
    florero1.position.set(-18, 0, -15);
    florero1.rotation.y = Math.PI / 2;
    scene.add(florero1);
    obstaculos.push({ modelo: florero1 });

    const florero2 = await cargarModelo3D("./models/florero", "florero2", new THREE.Vector3(6, 6, 6));
    florero2.position.set(20, 0, 14);
    florero2.rotation.y = Math.PI / 3;
    scene.add(florero2);
    obstaculos.push({ modelo: florero2 });

    const mostaza1 = await cargarModelo3D("./models/mostaza", "mostaza1", new THREE.Vector3(0.8, 0.8, 0.8));
    mostaza1.position.set(12, 0, -18);
    scene.add(mostaza1);
    obstaculos.push({ modelo: mostaza1 });

    const mostaza2 = await cargarModelo3D("./models/mostaza", "mostaza2", new THREE.Vector3(0.8, 0.8, 0.8));
    mostaza2.position.set(-20, 0, 6);
    scene.add(mostaza2);
    obstaculos.push({ modelo: mostaza2 });

    const mayonesa1 = await cargarModelo3D("./models/mayonesa", "mayonesa1", new THREE.Vector3(0.8, 0.8, 0.8));

    mayonesa1.position.set(-8, 0, 18)
    scene.add(mayonesa1);
    obstaculos.push({ modelo: mayonesa1 });

    const mayonesa2 = await cargarModelo3D("./models/mayonesa", "mayonesa2", new THREE.Vector3(0.8, 0.8, 0.8));
    mayonesa2.position.set(18, 0, -4);
    scene.add(mayonesa2);
    obstaculos.push({ modelo: mayonesa2 });

    const saleros1 = await cargarModelo3D("./models/saleros", "saleros1", new THREE.Vector3(20, 20, 20));
    saleros1.position.set(0, 0, -22);
    saleros1.rotation.y = Math.PI / 2;
    scene.add(saleros1);
    obstaculos.push({ modelo: saleros1 });

    const saleros2 = await cargarModelo3D("./models/saleros", "saleros2", new THREE.Vector3(20, 20, 20));
    saleros2.position.set(22, 0, 4);
    saleros2.rotation.y = Math.PI / 2;
    scene.add(saleros2);
    obstaculos.push({ modelo: saleros2 });

    const taza1 = await cargarModelo3D("./models/taza", "taza1", new THREE.Vector3(15, 15, 15));
    taza1.position.set(-16, 0, 20);
    taza1.rotation.y = Math.PI / 2;
    scene.add(taza1);
    obstaculos.push({ modelo: taza1 });

    const taza2 = await cargarModelo3D("./models/taza", "taza2", new THREE.Vector3(15, 15, 15));
    taza2.position.set(6, 0, 12);
    taza2.rotation.y = Math.PI / 4;
    scene.add(taza2);
    obstaculos.push({ modelo: taza2 });

    const jugo1 = await cargarModelo3D("./models/jugo", "jugo1", new THREE.Vector3(15, 15, 15));
    jugo1.position.set(-4, 0, -12);
    jugo1.rotation.y = Math.PI / 2;
    scene.add(jugo1);
    obstaculos.push({ modelo: jugo1 });

    const jugo2 = await cargarModelo3D("./models/jugo", "jugo2", new THREE.Vector3(15, 15, 15));
    jugo2.position.set(17, 0, 22);
    jugo2.rotation.y = Math.PI / 2;
    scene.add(jugo2);
    obstaculos.push({ modelo: jugo2 });

    const arana = await cargarModelo3D("./models/arana", "arana", new THREE.Vector3(2, 2, 2));
    arana.position.set(-24, 0, -18);
    arana.rotation.y = Math.PI / 2;
    scene.add(arana);
    obstaculos.push({ modelo: arana });

    const arana1 = await cargarModelo3D("./models/arana", "arana1", new THREE.Vector3(2, 2, 2));
    arana1.position.set(-14, 0, -22);
    arana1.rotation.y = Math.PI / 2;
    scene.add(arana1);
    obstaculos.push({ modelo: arana1 });

    const arana2 = await cargarModelo3D("./models/arana", "arana2", new THREE.Vector3(1.7, 1.7, 1.7));
    arana2.position.set(-10, 0, 16);
    arana2.rotation.y = Math.PI;
    scene.add(arana2);
    obstaculos.push({ modelo: arana2 });

    const arana3 = await cargarModelo3D("./models/arana", "arana3", new THREE.Vector3(2.2, 2.2, 2.2));
    arana3.position.set(24, 0, -12);
    arana3.rotation.y = Math.PI / 4;
    scene.add(arana3);
    obstaculos.push({ modelo: arana3 });

    const arana4 = await cargarModelo3D("./models/arana", "arana4", new THREE.Vector3(1.5, 1.5, 1.5));
    arana4.position.set(8, 0, 24);
    arana4.rotation.y = -Math.PI / 2;
    scene.add(arana4);
    obstaculos.push({ modelo: arana4 });
}

async function cargarEscenario3() {
    // CASI VACÍO
    reproducirMusica("3");
    const taza = await cargarModelo3D("./models/taza", "taza", new THREE.Vector3(15, 15, 15));
    taza.position.set(7, 0, -6);
    taza.rotation.y = Math.PI / 2;
    scene.add(taza);
    obstaculos.push({ modelo: taza });

    const florero = await cargarModelo3D("./models/florero", "florero", new THREE.Vector3(6, 6, 6));
    florero.position.set(-8, 0, 7);
    florero.rotation.y = Math.PI / 2;
    scene.add(florero);
    obstaculos.push({ modelo: florero });

    const saleros = await cargarModelo3D("./models/saleros", "saleros", new THREE.Vector3(20, 20, 20));
    saleros.position.set(0, 0, 10);
    saleros.rotation.y = Math.PI / 2;
    scene.add(saleros);
    obstaculos.push({ modelo: saleros });

}

async function cargarEscenarioSeleccionado() {
    if (escenarioSeleccionado === "1") {
        await cargarEscenario1();
    } else if (escenarioSeleccionado === "2") {
        await cargarEscenario2();
    } else {
        await cargarEscenario3();
    }
}

function hayColisionConObstaculo() {
    if (!jugadorLocal) return false;

    jugadorBB.setFromObject(jugadorLocal);

    for (const obstaculo of obstaculos) {
        const obstaculoBB = new THREE.Box3();
        obstaculoBB.setFromObject(obstaculo.modelo);

        if (jugadorBB.intersectsBox(obstaculoBB)) {
            console.log("Chocaste con:", obstaculo.modelo.name);
            return true;
        }
    }

    return false;
}

function revisarColisionPowerUps() {
    if (!jugadorLocal) return;


    jugadorBB.setFromObject(jugadorLocal);

    for (let i = powerUps.length - 1; i >= 0; i--) {
        const powerUp = powerUps[i];

        const powerUpBB = new THREE.Box3();
        powerUpBB.setFromObject(powerUp.modelo);

        if (jugadorBB.intersectsBox(powerUpBB)) {
            console.log("Agarraste power up:", powerUp.elemento);
            reproducirSonido('powerUp');
            elementoActual = powerUp.elemento;


            // Actualizar UI
            actualizarUIElementos();

            socket.emit("CambiarElemento", {
                elemento: elementoActual
            });

            scene.remove(powerUp.modelo);

            powerUps.splice(i, 1);

            const indexFlotante = modelosFlotantes.findIndex(
                item => item.modelo === powerUp.modelo
            );

            if (indexFlotante !== -1) {
                modelosFlotantes.splice(indexFlotante, 1);
            }
        }
    }
}

function limpiarPowerUps() {
    for (const powerUp of powerUps) {
        scene.remove(powerUp.modelo);
    }

    powerUps.length = 0;

    for (let i = modelosFlotantes.length - 1; i >= 0; i--) {
        if (modelosFlotantes[i].modelo.name.includes("power")) {
            modelosFlotantes.splice(i, 1);
        }
    }
}

async function crearPowerUpDesdeServidor(data) {
    const modelo = await cargarModelo3D(
        `./models/${data.modelo}`,
        `${data.modelo}-power-${data.id}`,
        new THREE.Vector3(0.15, 0.15, 0.15)
    );

    modelo.position.set(data.x, data.y, data.z);
    scene.add(modelo);

    registrarModeloFlotante(modelo, {
        amplitud: 0.25,
        velocidad: 1.5,
        rotacionY: 0.8
    });

    powerUps.push({
        id: data.id,
        modelo,
        elemento: data.elemento
    });
}

function crearRastro(posicion, elemento) {
    if (!gestorRastros) return;
    gestorRastros.agregar(posicion.clone(), 'jugador', elemento);
}

function reproducirSonido(nombre) {
    const sonido = sonidos[nombre];
    if (!sonido) return;
    sonido.currentTime = 0;
    sonido.play().catch(() => { })
}

let musicaActual = null;

function reproducirMusica(escenario) {
    if (musicaActual) {
        musicaActual.pause();
        musicaActual.currentTime = 0;
    }

    musicaActual = musicaEscenario[escenario];

    if (!musicaActual) return;

    musicaActual.loop = true;
    musicaActual.volume = 0.25;
    musicaActual.play().catch(() => { });
}

async function init() {
    if (!nombreJugador) {
        alert("No se encontró el nombre del jugador.");
        window.location.href = "index.html";
        return;
    }

    try {
        crearEscena();
        gestorRastros = new GestorRastros(scene);

        configurarSockets();
        configurarTeclado();
        //iniciarMusica();

        await cargarJugadorLocalModelo();
        await cargarEscenarioSeleccionado();

        const modo = localStorage.getItem('modoJuego') || 'pvp';
        if (modo === 'pvia') {
            await spawnAI();
        } else {
            vidasJugador = 3;
            _refrescarHUDJugador();
        }

        // Configurar botones de reinicio
        document.getElementById('btnReintentar')?.addEventListener('click', () => {
            vidasJugador = 3;
            jugadorMuerto = false;
            puntajeJugador = 0; // Reiniciar puntos al perder
            const el = document.getElementById('hud-puntaje');
            if (el) el.textContent = '0';
            _refrescarHUDJugador();
            if (gestorRastros) gestorRastros.limpiarPropietario('jugador');
            if (jugadorLocal) {
                jugadorLocal.position.set(0, jugadorBaseY, 0);
                anguloJugador = 0;
                jugadorLocal.rotation.order = 'YXZ';
                jugadorLocal.rotation.y = 0;
            }
            ultimoCambioCaos = performance.now();
        });

        document.getElementById('btnSiguienteRonda')?.addEventListener('click', () => {
            if (aiAgent) {
                aiAgent.muerta = false;
                vidasIA = 3;
                aiAgent.elementoIA = ELEMENTOS_REALES[Math.floor(Math.random() * ELEMENTOS_REALES.length)];
                _refrescarHUDIA();
                if (gestorRastros) gestorRastros.limpiarPropietario('IA');
                const x = (Math.random() * 2 - 1) * 18;
                const z = (Math.random() * 2 - 1) * 18;
                aiAgent.mesh.position.set(x, jugadorBaseY, z);
            }
            vidasJugador = 3;
            jugadorMuerto = false;
            _refrescarHUDJugador();
            if (gestorRastros) gestorRastros.limpiarPropietario('jugador');
            if (jugadorLocal) {
                anguloJugador = 0;
                jugadorLocal.rotation.order = 'YXZ';
                jugadorLocal.rotation.y = 0;
            }
            ultimoCambioCaos = performance.now();
        });

        actualizarUIElementos();
        animate();
    } catch (error) {
        console.error("Error en init:", error);
    }
}

init();