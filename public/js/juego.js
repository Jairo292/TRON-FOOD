
const socket = io();

socket.on("connect", () => {
    console.log("Conectado al servidor 🔥");
});

let nombreJugador = "";

document.getElementById("idBoton").addEventListener("click", () => {
    nombreJugador = document.getElementById("idNombreJugador").value;

    if (!nombreJugador) {
        alert("Escribe un nombre");
        return;
    }

    socket.emit("Iniciar", nombreJugador);
});

socket.on("listaJugadores", (lista) => {
    console.log("Jugadores:", lista);
});

