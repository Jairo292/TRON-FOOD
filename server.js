const path = require("node:path");
const http = require("node:http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const jugadores = [];

io.on("connection", (socket) => {
  console.log("Usuario conectado:", socket.id);

  socket.on("Iniciar", (nombre) => {
    console.log("Nombre recibido:", nombre);

    const yaExiste = jugadores.find(j => j.id === socket.id);
    if (yaExiste) return;

    const nuevoJugador = {
      id: socket.id,
      name: nombre,
      x: 0,
      y: 0.5,
      z: 0
    };

    jugadores.push(nuevoJugador);

    console.log("Jugadores actuales:", jugadores);
    io.emit("listaJugadores", jugadores);
  });

  socket.on("Posicion", (posicion) => {
    const jugador = jugadores.find(j => j.id === socket.id);
    if (!jugador) return;

    jugador.x = posicion.x;
    jugador.y = posicion.y;
    jugador.z = posicion.z;

    io.emit("listaJugadores", jugadores);
  });

  socket.on("disconnect", () => {
    console.log("Usuario desconectado:", socket.id);

    const index = jugadores.findIndex(j => j.id === socket.id);
    if (index !== -1) {
      jugadores.splice(index, 1);
    }

    io.emit("listaJugadores", jugadores);
  });
});

server.listen(3000, () => {
  console.log("Servidor corriendo en http://localhost:3000");
});