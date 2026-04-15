import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";

const socket = io();
let nombreJugador = localStorage.getItem("nombreJugador") || "";
let escenarioSeleccionado = localStorage.getItem("escenarioSeleccionado") || "1";
let conectado = false;
const manager = new THREE.LoadingManager();

let scene, camera, renderer, contenedor;
let ambientLight, directionalLight, piso;
const teclas = {};
let jugadorLocal = null;
let jugadorBaseY = 0.5;
const clock = new THREE.Clock();
const modelosFlotantes = [];
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
        if (!idsActivos.includes(id)) {
            scene.remove(jugadoresRemotos[id]);
            delete jugadoresRemotos[id];
            delete posicionesPendientesRemotos[id];
        }
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
    contenedor.appendChild(renderer.domElement);

    ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);

    directionalLight = new THREE.DirectionalLight(0xffffff, 2);
    directionalLight.position.set(5, 10, 7);
    scene.add(directionalLight);

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
scene.add(piso);
    window.addEventListener("resize", actualizarTamanoRenderer);
    actualizarTamanoRenderer();
}


manager.onStart = function (url, itemsLoaded, itemsTotal) {
    console.log("Started loading file:", url);
    console.log("Loaded", itemsLoaded, "of", itemsTotal, "files.");
};

manager.onLoad = function () {
    console.log("Loading complete!");
};

manager.onProgress = function (url, itemsLoaded, itemsTotal) {
    console.log("Loading file:", url);
    console.log("Loaded", itemsLoaded, "of", itemsTotal, "files.");
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

/*let jugadorLocal = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x00ffcc })
);
jugadorLocal.position.set(0, 0.5, 0);
scene.add(jugadorLocal);
*/

async function cargarJugadorLocalModelo() {
    try {
        // cubo temporal
        jugadorLocal = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({ color: 0x00ffcc })
        );
        jugadorLocal.position.set(0, 0.5, 0);
        scene.add(jugadorLocal);

        const modelo = await cargarModelo3D(
            "./models/tenedor",
            "tenedor",
            new THREE.Vector3(3,3,3)
        );

        modelo.position.copy(jugadorLocal.position);
        // Rotacion para que el tenedor quede acostado sobre el plano.
        modelo.rotation.x = -Math.PI / 2;
        jugadorBaseY = modelo.position.y;

        scene.remove(jugadorLocal);
        jugadorLocal = modelo;
        scene.add(jugadorLocal);

        console.log("Modelo local cargado correctamente");
    } catch (error) {
        console.error("No se pudo cargar el modelo local:", error);
    }
}
/*
async function cargarEscenario() {
    try {
        // algodon
        const algodon = await cargarModelo3D(
            "./models/algodon",
            "algodon",
            new THREE.Vector3(0.15, 0.15, 0.15)
        );
        algodon.position.set(3, 0, 2);
        scene.add(algodon);

        // catsup
        const catsup = await cargarModelo3D(
            "./models/catsup",
            "Catsup",
            new THREE.Vector3(0.6, 0.6, 0.6)
        );
        catsup.position.set(-4, 0, -2);
        scene.add(catsup);

        // cuchara
        const cuchara = await cargarModelo3D(
            "./models/cuchara",
            "cuchara",
            new THREE.Vector3(2, 2, 2)
        );
        cuchara.position.set(2, 0, 0);
        cuchara.rotation.y = Math.PI / 2;
        scene.add(cuchara);

        // florero
        const florero = await cargarModelo3D(
            "./models/florero",
            "Florero",
            new THREE.Vector3(5, 5, 5)
        );
        florero.position.set(2, 0, -3);
        florero.rotation.y = Math.PI / 2;
        scene.add(florero);

        // jugo
        const jugo = await cargarModelo3D(
            "./models/jugo",
            "Jugo",
            new THREE.Vector3(2, 2, 2)
        );
        jugo.position.set(2, 0, -3);
        jugo.rotation.y = Math.PI / 2;
        scene.add(jugo);

        // limonada
        const limonada = await cargarModelo3D(
            "./models/limonada",
            "Limonada",
            new THREE.Vector3(0.15, 0.15, 0.15)
        );
        limonada.position.set(2, 0, -3);
        limonada.rotation.y = Math.PI / 2;
        scene.add(limonada);

        // saleros
        const saleros = await cargarModelo3D(
            "./models/saleros",
            "Saleros",
            new THREE.Vector3(2, 2, 2)
        );
        saleros.position.set(2, 0, -3);
        saleros.rotation.y = Math.PI / 2;
        scene.add(saleros);

        // salsa
        const salsa = await cargarModelo3D(
            "./models/salsa",
            "Salsa",
            new THREE.Vector3(0.15, 0.15, 0.15)
        );
        salsa.position.set(2, 0, -3);
        salsa.rotation.y = Math.PI / 2;
        scene.add(salsa);
        //alo
        // taza
        const taza = await cargarModelo3D(
            "./models/taza",
            "Taza",
            new THREE.Vector3(13, 13, 13)
        );
        taza.position.set(5, 0, -5);
        taza.rotation.y = Math.PI / 2;
        scene.add(taza);

        // tenedor
        const tenedor = await cargarModelo3D(
            "./models/tenedor",
            "Tenedor",
            new THREE.Vector3(2, 2, 2)
        );
        tenedor.position.set(2, 0, 5);
        tenedor.rotation.y = Math.PI / 2;
        scene.add(tenedor);

        // yogurt
        const yogurt = await cargarModelo3D(
            "./models/yogurt",
            "Yogurt",
            new THREE.Vector3(0.15, 0.15, 0.15)
        );
        yogurt.position.set(2, 0, -3);
        yogurt.rotation.y = Math.PI / 2;
        scene.add(yogurt);

        console.log("Escenario cargado");
    } catch (error) {
        console.error("Error cargando escenario:", error);
    }
}
*/
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
    let seMovio = false;

    if (teclas["w"]) {
        jugadorLocal.position.z -= velocidad;
        seMovio = true;
    }
    if (teclas["s"]) {
        jugadorLocal.position.z += velocidad;
        seMovio = true;
    }
    if (teclas["a"]) {
        jugadorLocal.position.x -= velocidad;
        seMovio = true;
    }
    if (teclas["d"]) {
        jugadorLocal.position.x += velocidad;
        seMovio = true;
    }

    const ahora = performance.now();
    if (seMovio && conectado && (ahora - ultimaEmisionPosicion >= RED_CONFIG.intervaloEmisionPosicionMs)) {
        ultimaEmisionPosicion = ahora;
        socket.emit("Posicion", {
            x: jugadorLocal.position.x,
            y: jugadorLocal.position.y,
            z: jugadorLocal.position.z
        });
    }
}

const DEFINICIONES_MODELOS_ESCENARIO = [
    {
        path: "./models/algodon",
        nombreBase: "algodon",
        escala: new THREE.Vector3(0.15, 0.15, 0.15),
        radio: 2.8,
        flotante: { amplitud: 0.22, velocidad: 1.4, rotacionY: 0.45 }
    },
    {
        path: "./models/catsup",
        nombreBase: "catsup",
        escala: new THREE.Vector3(0.6, 0.6, 0.6),
        radio: 3.6
    },
    {
        path: "./models/florero",
        nombreBase: "florero",
        escala: new THREE.Vector3(6, 6, 6),
        radio: 5.2,
        rotacionYInicial: Math.PI / 2
    },
    {
        path: "./models/limonada",
        nombreBase: "limonada",
        escala: new THREE.Vector3(0.15, 0.15, 0.15),
        radio: 2.8,
        flotante: { amplitud: 0.2, velocidad: 1.15, rotacionY: 0.35 }
    },
    {
        path: "./models/saleros",
        nombreBase: "saleros",
        escala: new THREE.Vector3(20, 20, 20),
        radio: 7.5,
        rotacionYInicial: Math.PI / 2
    },
    {
        path: "./models/salsa",
        nombreBase: "salsa-a",
        escala: new THREE.Vector3(0.15, 0.15, 0.15),
        radio: 2.8,
        flotante: { amplitud: 0.18, velocidad: 1.2, rotacionY: 0.5 }
    },
    {
        path: "./models/salsa",
        nombreBase: "salsa-b",
        escala: new THREE.Vector3(0.15, 0.15, 0.15),
        radio: 2.8,
        flotante: { amplitud: 0.18, velocidad: 1.3, rotacionY: 0.45 }
    },
    {
        path: "./models/taza",
        nombreBase: "taza",
        escala: new THREE.Vector3(15, 15, 15),
        radio: 6.8,
        rotacionYInicial: Math.PI / 2
    },
    {
        path: "./models/yogurt",
        nombreBase: "yogurt",
        escala: new THREE.Vector3(0.15, 0.15, 0.15),
        radio: 2.8,
        flotante: { amplitud: 0.2, velocidad: 1.25, rotacionY: 0.42 }
    }
];

function crearDefinicionAleatoria() {
    const base = DEFINICIONES_MODELOS_ESCENARIO[
        Math.floor(Math.random() * DEFINICIONES_MODELOS_ESCENARIO.length)
    ];

    return {
        ...base,
        nombreBase: `${base.nombreBase}-extra`
    };
}

function generarPosicionLibre(ocupadas, radio, rango = 30, radioCentroBloqueado = 5) {
    const maxIntentos = 200;

    for (let i = 0; i < maxIntentos; i++) {
        const x = (Math.random() * 2 - 1) * rango;
        const z = (Math.random() * 2 - 1) * rango;

        // Deja libre la zona central para el spawn del jugador.
        if (Math.hypot(x, z) < radioCentroBloqueado) continue;

        let hayChoque = false;
        for (const ocupada of ocupadas) {
            const distancia = Math.hypot(x - ocupada.x, z - ocupada.z);
            if (distancia < radio + ocupada.radio + 2.5) {
                hayChoque = true;
                break;
            }
        }

        if (!hayChoque) {
            return { x, z };
        }
    }

    return null;
}

async function poblarEscenarioAleatorio(totalModelos) {
    const definiciones = DEFINICIONES_MODELOS_ESCENARIO.map((item) => ({ ...item }));

    while (definiciones.length < totalModelos) {
        definiciones.push(crearDefinicionAleatoria());
    }

    const ocupadas = [];

    for (let i = 0; i < definiciones.length; i++) {
        const def = definiciones[i];
        const posicion = generarPosicionLibre(ocupadas, def.radio);
        if (!posicion) continue;

        const modelo = await cargarModelo3D(
            def.path,
            `${def.nombreBase}-${i + 1}`,
            def.escala
        );

        modelo.position.set(posicion.x, 0, posicion.z);
        modelo.rotation.y = def.rotacionYInicial ?? Math.random() * Math.PI * 2;
        scene.add(modelo);

        if (def.flotante) {
            registrarModeloFlotante(modelo, def.flotante);
        } else {
            // Los props estaticos no requieren recalcular matrices cada frame.
            modelo.updateMatrix();
            modelo.matrixAutoUpdate = false;
        }

        ocupadas.push({ x: posicion.x, z: posicion.z, radio: def.radio });
    }
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
    animarWalkLateralJugador(tiempo);
    animarJugadoresRemotos(tiempo);
    animarModelosFlotantes(tiempo);
    actualizarCamaraJugadorLocal();
    renderer.render(scene, camera);
}

async function cargarEscenario1() {
    await poblarEscenarioAleatorio(28);
}

async function cargarEscenario2() {
    await poblarEscenarioAleatorio(34);
}

async function cargarEscenario3() {
    await poblarEscenarioAleatorio(40);
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

    animate();
}

init();