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
const FLOTACION_JUGADOR = {
    amplitud: 0.12,
    velocidad: 2.0
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
let inclinacionLateralActual = 0;
const objetivoCamaraPos = new THREE.Vector3();
const objetivoCamaraLookAt = new THREE.Vector3();

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
            "./models/tenedor",
            "tenedor-remoto-plantilla",
            new THREE.Vector3(3, 3, 3)
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
            jugadoresRemotos[jugador.id].position.set(jugador.x, jugador.y, jugador.z);
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
    scene.background = new THREE.Color(0x1a1a1a);

    camera = new THREE.PerspectiveCamera(
        60,
        contenedor.clientWidth / contenedor.clientHeight,
        0.1,
        1000
    );

    camera.position.set(0, 8, 12);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(contenedor.clientWidth, contenedor.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
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
texturaPiso.repeat.set(6, 6);

piso = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
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

    if (seMovio && conectado) {
        socket.emit("Posicion", {
            x: jugadorLocal.position.x,
            y: jugadorLocal.position.y,
            z: jugadorLocal.position.z
        });
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
    animarModelosFlotantes(tiempo);
    actualizarCamaraJugadorLocal();
    renderer.render(scene, camera);
}

async function cargarEscenario1() {
    const algodon = await cargarModelo3D(
        "./models/algodon",
        "algodon",
        new THREE.Vector3(0.15, 0.15, 0.15)
    );
    algodon.position.set(3, 0, 0);
    scene.add(algodon);
    registrarModeloFlotante(algodon, { amplitud: 0.22, velocidad: 1.4, rotacionY: 0.45 });

      const saleros = await cargarModelo3D(
            "./models/saleros",
            "saleros",
            new THREE.Vector3(20, 20, 20)
        );
        saleros.position.set(4, 0, 4);
        saleros.rotation.y = Math.PI / 2;
        scene.add(saleros);
    
        // florero
        const florero = await cargarModelo3D(
            "./models/florero",
            "florero",
            new THREE.Vector3(6, 6, 6)
        );
        florero.position.set(-7, 0, -3);
        florero.rotation.y = Math.PI / 2;
        scene.add(florero);
}

async function cargarEscenario2() {
    const salsa = await cargarModelo3D(
        "./models/salsa",
        "salsa",
        new THREE.Vector3(0.15, 0.15, 0.15)
    );
    salsa.position.set(2, 0, -3);
    scene.add(salsa);
    registrarModeloFlotante(salsa, { amplitud: 0.18, velocidad: 1.2, rotacionY: 0.5 });

        const catsup = await cargarModelo3D(
            "./models/catsup",
            "catsup",
            new THREE.Vector3(0.6, 0.6, 0.6)
        );
        catsup.position.set(-4, 0, -2);
        scene.add(catsup);

          const jugo = await cargarModelo3D(
            "./models/jugo",
            "jugo",
            new THREE.Vector3(5, 5, 5)
        );
        jugo.position.set(2, 0, -3);
        jugo.rotation.y = Math.PI / 2;
        scene.add(jugo);
}

async function cargarEscenario3() {
    //await cargarEscenario1();
    //await cargarEscenario2();

    const yogurt = await cargarModelo3D(
        "./models/yogurt",
        "yogurt",
        new THREE.Vector3(0.15, 0.15, 0.15)
    );
    yogurt.position.set(-3, 0, 2);
    scene.add(yogurt);
    registrarModeloFlotante(yogurt, { amplitud: 0.2, velocidad: 1.25, rotacionY: 0.42 });

      const limonada = await cargarModelo3D(
            "./models/limonada",
            "Limonada",
            new THREE.Vector3(0.15, 0.15, 0.15)
        );
        limonada.position.set(-1, 0, 7);
        limonada.rotation.y = Math.PI / 2;
        scene.add(limonada);
        registrarModeloFlotante(limonada, { amplitud: 0.2, velocidad: 1.15, rotacionY: 0.35 });


         const taza = await cargarModelo3D(
            "./models/taza",
            "taza",
            new THREE.Vector3(15, 15, 15)
        );
        taza.position.set(5, 0, -5);
        taza.rotation.y = Math.PI / 2;
        scene.add(taza);
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