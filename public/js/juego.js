import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";

const socket = io();
let nombreJugador = "";
let conectado = false;

// jugadores remotos
const jugadoresRemotos = {};

// ---------------------------
// SOCKETS
// ---------------------------
socket.on("connect", () => {
    console.log("Conectado al servidor");
});

socket.on("listaJugadores", (lista) => {
    console.log("Lista de jugadores:", lista);

    const idsActivos = [];

    for (const jugador of lista) {
        idsActivos.push(jugador.id);

        // si es el jugador local, solo actualizamos referencia si queremos
        if (jugador.name === nombreJugador) {
            continue;
        }

        // si no existe, lo creamos
        if (!jugadoresRemotos[jugador.id]) {
            const cuboRemoto = new THREE.Mesh(
                new THREE.BoxGeometry(1, 1, 1),
                new THREE.MeshStandardMaterial({ color: 0xff4d6d })
            );
            cuboRemoto.position.set(jugador.x, jugador.y, jugador.z);
            scene.add(cuboRemoto);
            jugadoresRemotos[jugador.id] = cuboRemoto;
        }

        // actualizamos posición
        jugadoresRemotos[jugador.id].position.set(jugador.x, jugador.y, jugador.z);
    }

    // eliminar remotos desconectados
    for (const id in jugadoresRemotos) {
        if (!idsActivos.includes(id)) {
            scene.remove(jugadoresRemotos[id]);
            delete jugadoresRemotos[id];
        }
    }
});

const btnConectar = document.getElementById("idBoton");

btnConectar.addEventListener("click", () => {
    nombreJugador = document.getElementById("idNombreJugador").value.trim();

    if (!nombreJugador) {
        alert("Escribe un nombre");
        return;
    }

    socket.emit("Iniciar", nombreJugador);
    conectado = true;
    console.log("Nombre enviado:", nombreJugador);
});

// ---------------------------
// THREE.JS - ESCENA
// ---------------------------
const contenedor = document.querySelector(".campo-juego");
contenedor.innerHTML = "";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

const camera = new THREE.PerspectiveCamera(
    60,
    contenedor.clientWidth / contenedor.clientHeight,
    0.1,
    1000
);

camera.position.set(0, 8, 12);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(contenedor.clientWidth, contenedor.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
contenedor.appendChild(renderer.domElement);

// ---------------------------
// LUCES
// ---------------------------
const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
directionalLight.position.set(5, 10, 7);
scene.add(directionalLight);

// ---------------------------
// PISO
// ---------------------------
const piso = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x666666 })
);
piso.rotation.x = -Math.PI / 2;
scene.add(piso);

const manager = new THREE.LoadingManager();

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

// ---------------------------
// JUGADOR LOCAL
// ---------------------------
let jugadorLocal = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x00ffcc })
);
jugadorLocal.position.set(0, 0.5, 0);
scene.add(jugadorLocal);

async function cargarJugadorLocalModelo() {
    try {
        const modelo = await cargarModelo3D(
            "./models/Anakin",
            "Anakin",
            new THREE.Vector3(15, 15, 15)
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

cargarJugadorLocalModelo();

// ---------------------------
// TECLAS
// ---------------------------
const teclas = {};

window.addEventListener("keydown", (event) => {
    teclas[event.key.toLowerCase()] = true;
});

window.addEventListener("keyup", (event) => {
    teclas[event.key.toLowerCase()] = false;
});

// ---------------------------
// MOVIMIENTO
// ---------------------------
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

// ---------------------------
// RESIZE
// ---------------------------
function actualizarTamanoRenderer() {
    const ancho = contenedor.clientWidth;
    const alto = contenedor.clientHeight;

    camera.aspect = ancho / alto;
    camera.updateProjectionMatrix();
    renderer.setSize(ancho, alto);
}

window.addEventListener("resize", actualizarTamanoRenderer);

// ---------------------------
// ANIMACIÓN
// ---------------------------
function animate() {
    requestAnimationFrame(animate);

    moverJugador();
    renderer.render(scene, camera);
}

actualizarTamanoRenderer();
animate();