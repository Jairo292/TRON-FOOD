import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";

const socket = io();
let nombreJugador = localStorage.getItem("nombreJugador") || "";
let escenarioSeleccionado = localStorage.getItem("escenarioSeleccionado") || "1";
let conectado = false;
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
const AI_CONFIG = {
    detectionRadius: 12,
    fov: Math.PI / 3, // 60 grados (actualmente no usada)
    speed: 0.06,
    wanderSpeed: 0.015
};
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
    "1": 0x1f2432,
    "2": 0x203025,
    "3": 0x2f1f29
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
const objetivoCamaraPos = new THREE.Vector3();
const objetivoCamaraLookAt = new THREE.Vector3();
let ultimaEmisionPosicion = 0;

// jugadores remotos
const jugadoresRemotos = {};
const jugadoresRemotosEnCarga = new Set();
const posicionesPendientesRemotos = {};
let plantillaJugadorRemotoPromise = null;

let elementoActual = "normal";

const coloresElemento = {
    fuego: 0xff3300,
    agua: 0x00aaff,
    hielo: 0x99ddff,
    aire: 0xffffff,
    normal: 0xaaaaaa
};

const rastros = [];

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
    // Se invierte el signo para que la inclinacion visual coincida con derecha/izquierda reales.
    const direccionLateral = movIzq - movDer;
    const objetivoInclinacion = direccionLateral * ANIMACION_WALK_LATERAL.inclinacionMax;

    inclinacionLateralActual += (objetivoInclinacion - inclinacionLateralActual) * ANIMACION_WALK_LATERAL.suavizado;

    const estaMoviendoseLateral = direccionLateral !== 0;
    const wobble = estaMoviendoseLateral
        ? Math.sin(tiempo * ANIMACION_WALK_LATERAL.velocidad) * ANIMACION_WALK_LATERAL.oscilacionYaw * direccionLateral
        : 0;

    // Base del tenedor acostado + animacion lateral tipo walk.
    jugadorLocal.rotation.x = -Math.PI / 2;
    jugadorLocal.rotation.y = wobble;
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
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.y = wobble;
        mesh.rotation.z = data.inclinacionActual;
    }
}

function actualizarCamaraJugadorLocal() {
    if (!camera || !jugadorLocal) return;

    // Sigue al jugador por X/Z y mantiene altura estable para evitar mareo por la flotacion.
    objetivoCamaraPos.set(
        jugadorLocal.position.x + CAMARA_JUGADOR.offsetX,
        jugadorBaseY + CAMARA_JUGADOR.offsetY,
        jugadorLocal.position.z + CAMARA_JUGADOR.offsetZ
    );

    camera.position.lerp(objetivoCamaraPos, CAMARA_JUGADOR.suavizado);

    objetivoCamaraLookAt.set(
        jugadorLocal.position.x,
        jugadorBaseY + CAMARA_JUGADOR.alturaMirada,
        jugadorLocal.position.z
    );
    camera.lookAt(objetivoCamaraLookAt);
}

function configurarSockets() {
    socket.on("connect", () => {
        console.log("Conectado al servidor");

        socket.emit("Iniciar", nombreJugador);
        conectado = true;
    });

    socket.on("listaJugadores", (lista) => {
        actualizarJugadoresRemotos(lista);
    });

    socket.on("powerUpsActualizados", async (listaPowerUps) => {
        console.log("PowerUps recibidos:", listaPowerUps);

        limpiarPowerUps();

        for (const data of listaPowerUps) {
            await crearPowerUpDesdeServidor(data);
        }
    });

    socket.on("RastroCreado", (data) => {
        console.log("Rastro recibido en cliente:", data);

        crearRastro(
            new THREE.Vector3(data.x, data.y, data.z),
            data.elemento
        );
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
            const data = jugadoresRemotos[jugador.id].userData.animacionEnemigo;
            if (data) {
                data.objetivoX = jugador.x;
                data.objetivoZ = jugador.z;
                data.baseY = jugador.y;
            } else {
                jugadoresRemotos[jugador.id].position.set(jugador.x, jugador.y, jugador.z);
            }
        }
    }

    for (const id in jugadoresRemotos) {
        // No eliminar la IA local creada en cliente
        if (!idsActivos.includes(id) && !(aiAgent && aiAgent.id === id)) {
            scene.remove(jugadoresRemotos[id]);
            delete jugadoresRemotos[id];
            delete posicionesPendientesRemotos[id];
        }
    }
}

// --- IA (simple) ---
async function spawnAI() {
    if (aiAgent) return;
    try {
        // Cargar específicamente el modelo del tenedor para la IA
        const modeloIA = await cargarModelo3D("./models/tenedor", "ia-tenedor", new THREE.Vector3(2, 2, 2));
        // Aplicar color rojo para diferenciar
        aplicarColorModelo(modeloIA, 0xff4d6d);
        // Posicionar IA en un lugar aleatorio lejos del jugador
        const x = (Math.random() * 2 - 1) * 20;
        const z = (Math.random() * 2 - 1) * 20;
        modeloIA.position.set(x, jugadorBaseY, z);
        modeloIA.rotation.x = -Math.PI / 2;
        modeloIA.name = 'IA';
        inicializarAnimacionEnemigo(modeloIA, { x, y: jugadorBaseY, z });
        aiAgent = {
            id: 'IA',
            mesh: modeloIA,
            objetivo: null,
            wanderTarget: null
        };
        jugadoresRemotos[aiAgent.id] = modeloIA;
        modeloIA.traverse((child) => { if (child.isMesh) child.castShadow = true; });
        scene.add(modeloIA);
        console.log('IA (tenedor rojo) generada en', x, z);
    } catch (e) {
        console.error('No se pudo crear IA:', e);
    }
}

function updateAI(tiempo) {
    if (!aiAgent || !jugadorLocal) return;
    const ia = aiAgent.mesh;
    // Distancia al jugador
    const distancia = ia.position.distanceTo(jugadorLocal.position);

    // Direccion hacia jugador
    const dir = new THREE.Vector3().subVectors(jugadorLocal.position, ia.position).setY(0).normalize();

    if (distancia <= AI_CONFIG.detectionRadius) {
        // Perseguir al jugador (por proximidad)
        ia.position.x += dir.x * AI_CONFIG.speed;
        ia.position.z += dir.z * AI_CONFIG.speed;
        // rotar IA hacia jugador
        ia.lookAt(jugadorLocal.position.x, ia.position.y, jugadorLocal.position.z);
    } else {
        // Wander aleatorio
        if (!aiAgent.wanderTarget || ia.position.distanceTo(aiAgent.wanderTarget) < 1) {
            aiAgent.wanderTarget = new THREE.Vector3(
                ia.position.x + (Math.random() * 2 - 1) * 6,
                ia.position.y,
                ia.position.z + (Math.random() * 2 - 1) * 6
            );
        }
        const dirW = new THREE.Vector3().subVectors(aiAgent.wanderTarget, ia.position).setY(0).normalize();
        ia.position.x += dirW.x * AI_CONFIG.wanderSpeed;
        ia.position.z += dirW.z * AI_CONFIG.wanderSpeed;
        ia.lookAt(aiAgent.wanderTarget.x, ia.position.y, aiAgent.wanderTarget.z);
    }
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

    ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.set(1024, 1024);
    scene.add(directionalLight);

    spotLight = new THREE.SpotLight(0xfff2c0, 1.5, 90, Math.PI / 6, 0.18, 1);
    spotLight.position.set(0, 20, 15);
    spotLight.target.position.set(0, 0, 0);
    spotLight.castShadow = true;
    spotLight.shadow.mapSize.set(1024, 1024);
    scene.add(spotLight);
    scene.add(spotLight.target);

    const textureLoader = new THREE.TextureLoader();
    const texturaPiso = textureLoader.load("./mesa.png");

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

function cargarModelo3D(path, nombre, vectorEscala) {
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
    });

    window.addEventListener("keyup", (event) => {
        teclas[event.key.toLowerCase()] = false;
    });
}

function moverJugador() {
    if (!jugadorLocal) return;

    const velocidad = 0.08;
    const desplazamiento = new THREE.Vector3();
    let seMovio = false;

    if (teclas["w"]) {
        desplazamiento.z -= velocidad;
        seMovio = true;
    }
    if (teclas["s"]) {
        desplazamiento.z += velocidad;
        seMovio = true;
    }
    if (teclas["a"]) {
        desplazamiento.x -= velocidad;
        seMovio = true;
    }
    if (teclas["d"]) {
        desplazamiento.x += velocidad;
        seMovio = true;
    }

    if (!seMovio) return;

    const posicionPropuesta = jugadorLocal.position.clone().add(desplazamiento);
    const dentroDeLimites = Math.abs(posicionPropuesta.x) < LIMITE_ESCENARIO && Math.abs(posicionPropuesta.z) < LIMITE_ESCENARIO;

    if (dentroDeLimites) {
        const posicionAnterior = jugadorLocal.position.clone();

        jugadorLocal.position.copy(posicionPropuesta);

        crearRastro(jugadorLocal.position, elementoActual);

        socket.emit("CrearRastro", {
            x: jugadorLocal.position.x,
            y: jugadorLocal.position.y,
            z: jugadorLocal.position.z,
            elemento: elementoActual
        });

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
                z: jugadorLocal.position.z
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
    moverJugador();
    revisarColisionPowerUps();
    animarWalkLateralJugador(tiempo);
    animarJugadoresRemotos(tiempo);
    animarModelosFlotantes(tiempo);
    actualizarCamaraJugadorLocal();
    if (aiAgent) updateAI(tiempo);
    renderer.render(scene, camera);
}
async function cargarEscenario1() {
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

    const jugo = await cargarModelo3D("./models/jugo", "jugo", new THREE.Vector3(10, 10, 10));
    jugo.position.set(2, 0, 10);
    jugo.rotation.y = Math.PI / 2;
    scene.add(jugo);
    obstaculos.push({ modelo: jugo });
}

async function cargarEscenario2() {
    // SUPER POBLADO

    const florero1 = await cargarModelo3D("./models/florero", "florero1", new THREE.Vector3(6, 6, 6));
    florero1.position.set(-10, 0, -8);
    florero1.rotation.y = Math.PI / 2;
    scene.add(florero1);
    obstaculos.push({ modelo: florero1 });

    const florero2 = await cargarModelo3D("./models/florero", "florero2", new THREE.Vector3(6, 6, 6));
    florero2.position.set(11, 0, 7);
    florero2.rotation.y = Math.PI / 3;
    scene.add(florero2);
    obstaculos.push({ modelo: florero2 });

    const mostaza1 = await cargarModelo3D("./models/mostaza", "mostaza1", new THREE.Vector3(0.8, 0.8, 0.8));
    mostaza1.position.set(5, 0, -9);
    scene.add(mostaza1);
    obstaculos.push({ modelo: mostaza1 });

    const mostaza2 = await cargarModelo3D("./models/mostaza", "mostaza2", new THREE.Vector3(0.8, 0.8, 0.8));
    mostaza2.position.set(-12, 0, 3);
    scene.add(mostaza2);
    obstaculos.push({ modelo: mostaza2 });

    const mayonesa1 = await cargarModelo3D("./models/mayonesa", "mayonesa1", new THREE.Vector3(0.8, 0.8, 0.8));
    mayonesa1.position.set(-4, 0, 9);
    scene.add(mayonesa1);
    obstaculos.push({ modelo: mayonesa1 });

    const mayonesa2 = await cargarModelo3D("./models/mayonesa", "mayonesa2", new THREE.Vector3(0.8, 0.8, 0.8));
    mayonesa2.position.set(9, 0, -2);
    scene.add(mayonesa2);
    obstaculos.push({ modelo: mayonesa2 });

    const saleros1 = await cargarModelo3D("./models/saleros", "saleros1", new THREE.Vector3(20, 20, 20));
    saleros1.position.set(0, 0, -12);
    saleros1.rotation.y = Math.PI / 2;
    scene.add(saleros1);
    obstaculos.push({ modelo: saleros1 });

    const saleros2 = await cargarModelo3D("./models/saleros", "saleros2", new THREE.Vector3(20, 20, 20));
    saleros2.position.set(13, 0, 2);
    saleros2.rotation.y = Math.PI / 2;
    scene.add(saleros2);
    obstaculos.push({ modelo: saleros2 });

    const taza1 = await cargarModelo3D("./models/taza", "taza1", new THREE.Vector3(15, 15, 15));
    taza1.position.set(-9, 0, 11);
    taza1.rotation.y = Math.PI / 2;
    scene.add(taza1);
    obstaculos.push({ modelo: taza1 });

    const taza2 = await cargarModelo3D("./models/taza", "taza2", new THREE.Vector3(15, 15, 15));
    taza2.position.set(3, 0, 5);
    taza2.rotation.y = Math.PI / 4;
    scene.add(taza2);
    obstaculos.push({ modelo: taza2 });

    const jugo1 = await cargarModelo3D("./models/jugo", "jugo1", new THREE.Vector3(10, 10, 10));
    jugo1.position.set(-2, 0, -5);
    jugo1.rotation.y = Math.PI / 2;
    scene.add(jugo1);
    obstaculos.push({ modelo: jugo1 });

    const jugo2 = await cargarModelo3D("./models/jugo", "jugo2", new THREE.Vector3(10, 10, 10));
    jugo2.position.set(10, 0, 12);
    jugo2.rotation.y = Math.PI / 2;
    scene.add(jugo2);
    obstaculos.push({ modelo: jugo2 });
}

async function cargarEscenario3() {
    // CASI VACÍO

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

            elementoActual = powerUp.elemento;

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
    const color = coloresElemento[elemento] ?? coloresElemento.normal;

    const geometry = new THREE.SphereGeometry(0.18, 12, 12);
    const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.65
    });

    const rastro = new THREE.Mesh(geometry, material);
    rastro.position.set(posicion.x, 0.08, posicion.z);

    scene.add(rastro);

    rastros.push(rastro);

    setTimeout(() => {
        scene.remove(rastro);
        material.dispose();
        geometry.dispose();

        const index = rastros.indexOf(rastro);
        if (index !== -1) rastros.splice(index, 1);
    }, 2500);
}

async function init() {
    if (!nombreJugador) {
        alert("No se encontró el nombre del jugador.");
        window.location.href = "index.html";
        return;
    }

    crearEscena();
    configurarSockets();
    configurarTeclado();

    await cargarJugadorLocalModelo();
    await cargarEscenarioSeleccionado();


    // Modo de juego: leer elección de configuración (pvp | pvia)
    const modo = localStorage.getItem('modoJuego') || 'pvp';
    if (modo === 'pvia') {
        await spawnAI();
    }

    animate();
}

init();