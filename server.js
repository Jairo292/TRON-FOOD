const sqlite3 = require("sqlite3").verbose();
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

// Conectar a SQLite
const db = new sqlite3.Database(path.join(__dirname, "kitchenarena.db"), (err) => {
  if (err) {
    console.log("Error SQLite:", err);
  } else {
    console.log("SQLite conectado");
    // Crear tabla si no existe
    db.run(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario TEXT NOT NULL UNIQUE,
        correo TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        puntaje_max INTEGER DEFAULT 0,
        fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.log("Error creando tabla:", err);
      else console.log("Tabla 'usuarios' lista");
    });
  }
});

const jugadores = [];

const powerUps = [];
let contadorPowerUps = 0;

const tiposPowerUps = [
  { modelo: "salsa", elemento: "fuego" },
  { modelo: "limonada", elemento: "agua" },
  { modelo: "yogurt", elemento: "hielo" },
  { modelo: "algodon", elemento: "aire" }
];

function generarPowerUps() {
  powerUps.length = 0;
  console.log("PowerUps generados:", powerUps);
  for (let i = 0; i < 8; i++) {
    const tipo = tiposPowerUps[Math.floor(Math.random() * tiposPowerUps.length)];

    powerUps.push({
      id: contadorPowerUps++,
      modelo: tipo.modelo,
      elemento: tipo.elemento,
      x: Math.random() * 60 - 30,
      y: 0,
      z: Math.random() * 60 - 30
    });
  }

  io.emit("powerUpsActualizados", powerUps);

  setTimeout(() => {
    powerUps.length = 0;
    io.emit("powerUpsActualizados", powerUps);
  }, 7000);
}

app.post("/registro", async (req, res) => {

  const { usuario, correo, password } = req.body;

  try {

    const hash = await bcrypt.hash(password, 10);

    const sql = `
      INSERT INTO usuarios (usuario, correo, password)
      VALUES (?, ?, ?)
    `;

    db.run(sql, [usuario, correo, hash], (err) => {

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

  db.get(sql, [correo], async (err, usuario) => {

    if (err) {

      return res.status(500).json({
        mensaje: "Error del servidor"
      });

    }

    if (!usuario) {

      return res.status(401).json({
        mensaje: "Usuario no encontrado"
      });

    }

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

  db.all(sql, (err, result) => {

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
  socket.emit("powerUpsActualizados", powerUps);

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

  socket.on("CambiarElemento", (data) => {
    const jugador = jugadores.find(j => j.id === socket.id);
    if (!jugador) return;

    jugador.elemento = data.elemento;

    io.emit("listaJugadores", jugadores);
  });

  socket.on("CrearRastro", (data) => {
    data.id = socket.id;
    socket.broadcast.emit("RastroCreado", data);
  });

  socket.on("Posicion", (posicion) => {
    const jugador = jugadores.find(j => j.id === socket.id);
    if (!jugador) return;

    jugador.x = posicion.x;
    jugador.y = posicion.y;
    jugador.z = posicion.z;

    io.emit("listaJugadores", jugadores);
  });

  socket.on("RecibiDano", (idAtacante) => {
    if (idAtacante && idAtacante !== "IA") {
      io.to(idAtacante).emit("SumaPuntos", 10);
    }
  });

  socket.on("FuiEliminado", (idAtacante) => {
    if (idAtacante && idAtacante !== "IA") {
      io.to(idAtacante).emit("SumaPuntos", 30);
    }
  });

  socket.on("GuardarPuntaje", (data) => {
    if (!data.nombreJugador || data.puntaje === undefined) return;
    
    // Solo actualizar si el puntaje nuevo es mayor al puntaje maximo actual
    const sql = `
      UPDATE usuarios 
      SET puntaje_max = ? 
      WHERE usuario = ? AND puntaje_max < ?
    `;

    db.run(sql, [data.puntaje, data.nombreJugador, data.puntaje], (err) => {
      if (err) console.log("Error al guardar puntaje:", err);
    });
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

setInterval(generarPowerUps, 5000);
server.listen(3000, () => {
  console.log("Servidor corriendo en http://localhost:3000");
});