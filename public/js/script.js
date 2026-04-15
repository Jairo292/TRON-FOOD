function mostrarPantalla(id) {
    document.querySelectorAll('.pantalla').forEach(p => p.classList.remove('activa'));
    document.getElementById(id).classList.add('activa');
}

function volverMenu() {
    mostrarPantalla('menuPrincipal');
    cerrarPausa();
}

function mostrarPausa() {
    document.getElementById('menuPausa').style.display = "flex";
}

function cerrarPausa() {
    document.getElementById('menuPausa').style.display = "none";
}

function guardarConfiguracion() {
    const config = {
        volumen: document.getElementById('volumen').value,
        dificultad: document.getElementById('dificultad').value,
        modo: document.getElementById('modoJuego').value
    };

    localStorage.setItem("configKitchenArena", JSON.stringify(config));
    alert("Configuración guardada correctamente 🔥");
}

function iniciarJuego(escenario) {
    const inputNombre = document.getElementById("nombreJugador");

    if (!inputNombre) {
        alert("No se encontró el campo de nombre.");
        return;
    }

    const nombre = inputNombre.value.trim();

    if (!nombre) {
        alert("Escribe tu nombre antes de iniciar.");
        inputNombre.focus();
        return;
    }

    localStorage.setItem("nombreJugador", nombre);
    localStorage.setItem("escenarioSeleccionado", escenario);

    window.location.href = "juego.html";
}