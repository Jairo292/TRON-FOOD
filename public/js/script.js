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

async function registrar() {

    const usuario = document.getElementById("usuarioRegistro").value;
    const correo = document.getElementById("correoRegistro").value;
    const password = document.getElementById("passwordRegistro").value;

    if (!usuario || !correo || !password) {

        alert("Completa todos los campos");
        return;

    }

    try {

        const respuesta = await fetch("/registro", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                usuario,
                correo,
                password
            })

        });

        const data = await respuesta.json();

        alert(data.mensaje);

    } catch (error) {

        console.log(error);

        alert("Error al conectar con el servidor");

    }

}

async function login() {

    const correo = document.getElementById("correoLogin").value;
    const password = document.getElementById("passwordLogin").value;

    if (!correo || !password) {

        alert("Completa todos los campos");
        return;

    }

    try {

        const respuesta = await fetch("/login", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                correo,
                password
            })

        });

        const data = await respuesta.json();

        if (respuesta.ok) {

            // Guardar sesión y actualizar UI sin reload
            AuthState.guardar(data.usuario, data.id);
            updateAuthUI();

            // Cerrar modal de login suavemente
            try {
                const modalEl = document.getElementById('loginModal');
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();
            } catch (e) { }

            _mostrarToast('¡Bienvenido, ' + data.usuario + '! 🔥');

        } else {

            alert(data.mensaje);

        }

    } catch (error) {

        console.log(error);

        alert("Error al conectar con el servidor");

    }

}

function entrarJuego(escenario) {

    const usuario = localStorage.getItem("usuario");

    if (!usuario) {
        alert("Primero inicia sesión.");
        return;
    }

    localStorage.setItem("nombreJugador", usuario);
    localStorage.setItem("escenarioSeleccionado", escenario);

    window.location.href = "juego.html";
}

// --- Facebook Login helpers ---
async function fbLogin() {
    if (!window.FB) {
        alert('Facebook SDK no cargado. Asegúrate de configurar tu App ID en index.html');
        return;
    }

    FB.getLoginStatus(function (response) {
        if (response.status === 'connected') {
            handleFBResponse(response);
        } else {
            FB.login(function (resp) {
                if (resp.authResponse) handleFBResponse(resp);
                else alert('Inicio de sesión cancelado');
            }, { scope: 'public_profile' });
        }
    });
}

function handleFBResponse(resp) {
    FB.api('/me', { fields: 'name' }, async function (profile) {
        if (!profile || profile.error) {
            console.log(profile && profile.error);
            alert('No se pudo obtener datos de Facebook');
            return;
        }

        const usuario = profile.name || 'FBUser';
        const correo = profile.email || (profile.id + '@facebook.local');
        const password = generateRandomPassword();

        try {
            // Intenta registrar (si ya existe, la API puede devolver error y procederemos a login)
            await fetch('/registro', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuario, correo, password })
            });
        } catch (e) {
            console.log('registro fb error', e);
        }

        try {
            const loginRes = await fetch('/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ correo, password })
            });

            const data = await loginRes.json();

            if (loginRes.ok) {
                // Guardar sesión y actualizar UI sin reload
                AuthState.guardar(data.usuario, data.id);
                updateAuthUI();

                // Cerrar modal
                try {
                    const modalEl = document.getElementById('loginModal');
                    const modal = bootstrap.Modal.getInstance(modalEl);
                    if (modal) modal.hide();
                } catch (e) { }

                _mostrarToast('¡Bienvenido, ' + data.usuario + '! 🔥');
            } else {
                alert(data.mensaje || 'Error en login con Facebook');
            }

        } catch (e) {
            console.log(e);
            alert('Error al iniciar con Facebook');
        }
    });
}

function generateRandomPassword() {
    try {
        const arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        return Array.from(arr).map(n => (n % 36).toString(36)).join('') + Date.now().toString(36);
    } catch (e) {
        return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
}