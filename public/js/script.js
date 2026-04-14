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