const mysql = require("mysql2");
const bcrypt = require("bcrypt");
const cors = require("cors");
const path = require("node:path");
const http = require("node:http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "root",
  database: "kitchenarena"
});

db.connect((err) => {

  if (err) {
    console.log("Error MySQL");
    console.log(err);
  } else {
    console.log("MySQL conectado");
  }

});

const jugadores = [];

app.post("/registro", async (req, res) => {

  const { usuario, correo, password } = req.body;

  try {

    const hash = await bcrypt.hash(password, 10);

    const sql = `
      INSERT INTO usuarios (usuario, correo, password)
      VALUES (?, ?, ?)
    `;

    db.query(sql, [usuario, correo, hash], (err, result) => {

      if (err) {
        console.log(err);

        return res.status(500).json({
          mensaje: "Error al registrar"
        });
      }

      res.json({
        mensaje: "Usuario registrado"
      });

    });

  } catch (error) {

    res.status(500).json({
      mensaje: "Error del servidor"
    });

  }

});

app.post("/login", (req, res) => {

  const { correo, password } = req.body;

  const sql = `
    SELECT * FROM usuarios
    WHERE correo = ?
  `;

  db.query(sql, [correo], async (err, result) => {

    if (err) {

      return res.status(500).json({
        mensaje: "Error del servidor"
      });

    }

    if (result.length === 0) {

      return res.status(401).json({
        mensaje: "Usuario no encontrado"
      });

    }

    const usuario = result[0];

    const passwordCorrecta = await bcrypt.compare(
      password,
      usuario.password
    );

    if (!passwordCorrecta) {

      return res.status(401).json({
        mensaje: "Contraseña incorrecta"
      });

    }

    res.json({

      mensaje: "Login exitoso",

      id: usuario.id,

      usuario: usuario.usuario

    });

  });

});

app.get("/ranking", (req, res) => {

  const sql = `
    SELECT usuario, puntaje_max
    FROM usuarios
    ORDER BY puntaje_max DESC
    LIMIT 5
  `;

  db.query(sql, (err, result) => {

    if (err) {
      console.log(err);

      return res.status(500).json({
        mensaje: "Error al obtener ranking"
      });
    }

    res.json(result);

  });

});

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