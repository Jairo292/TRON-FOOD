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
const clock = new THREE.Clock();
const modelosFlotantes = [];

// jugadores remotos
const jugadoresRemotos = {};

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

        if (!jugadoresRemotos[jugador.id]) {
            const cuboRemoto = new THREE.Mesh(
                new THREE.BoxGeometry(1, 1, 1),
                new THREE.MeshStandardMaterial({ color: 0xff4d6d })
            );
            scene.add(cuboRemoto);
            jugadoresRemotos[jugador.id] = cuboRemoto;
        }

        jugadoresRemotos[jugador.id].position.set(jugador.x, jugador.y, jugador.z);
    }

    for (const id in jugadoresRemotos) {
        if (!idsActivos.includes(id)) {
            scene.remove(jugadoresRemotos[id]);
            delete jugadoresRemotos[id];
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

    moverJugador();
    animarModelosFlotantes(tiempo);
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