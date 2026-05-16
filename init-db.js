const mysql = require("mysql2");

// Conectar sin especificar base de datos para crearla
const connection = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "root"
});

connection.connect((err) => {
  if (err) {
    console.error("Error conectando a MySQL:", err);
    process.exit(1);
  }
  console.log("Conectado a MySQL");

  // SQL para crear la base de datos y tabla
  const sql = `
    CREATE DATABASE IF NOT EXISTS kitchenarena;
    USE kitchenarena;
    CREATE TABLE IF NOT EXISTS usuarios (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario VARCHAR(50) NOT NULL UNIQUE,
      correo VARCHAR(100) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      puntaje_max INT DEFAULT 0,
      fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Ejecutar cada comando por separado
  connection.query("CREATE DATABASE IF NOT EXISTS kitchenarena", (err) => {
    if (err) {
      console.error("Error creando BD:", err);
      connection.end();
      process.exit(1);
    }
    console.log("✓ Base de datos 'kitchenarena' lista");

    connection.query("USE kitchenarena", (err) => {
      if (err) {
        console.error("Error usando BD:", err);
        connection.end();
        process.exit(1);
      }

      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS usuarios (
          id INT AUTO_INCREMENT PRIMARY KEY,
          usuario VARCHAR(50) NOT NULL UNIQUE,
          correo VARCHAR(100) NOT NULL UNIQUE,
          password VARCHAR(255) NOT NULL,
          puntaje_max INT DEFAULT 0,
          fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;

      connection.query(createTableSQL, (err) => {
        if (err) {
          console.error("Error creando tabla:", err);
          connection.end();
          process.exit(1);
        }
        console.log("✓ Tabla 'usuarios' creada");
        connection.end();
        console.log("\n✓ Base de datos inicializada correctamente");
        process.exit(0);
      });
    });
  });
});
