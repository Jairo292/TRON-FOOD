/**
 * ============================================================
 *  auth.js — Kitchen Arena · Módulo de Autenticación
 * ============================================================
 *  Gestiona el estado de sesión y actualiza la UI en tiempo
 *  real sin necesidad de recargar la página (sin reload).
 *
 *  Estado persistido en localStorage:
 *    - "usuario"   → nombre del jugador logueado
 *    - "idUsuario" → ID numérico del jugador
 * ============================================================
 */

/* ── Estado global de sesión ─────────────────────────────── */
const AuthState = {
    get usuario()   { return localStorage.getItem('usuario') || null; },
    get idUsuario() { return localStorage.getItem('idUsuario') || null; },
    get logueado()  { return !!this.usuario; },

    guardar(usuario, id) {
        localStorage.setItem('usuario', usuario);
        localStorage.setItem('idUsuario', id);
    },

    limpiar() {
        localStorage.removeItem('usuario');
        localStorage.removeItem('idUsuario');
    }
};

/* ── Referencias DOM (se resuelven una sola vez al cargar) ── */
const DOM = {
    get zonaSesion()    { return document.getElementById('zona-sesion'); },
    get zoneGuest()     { return document.getElementById('zona-invitado'); },
    get zoneLogged()    { return document.getElementById('zona-logueado'); },
    get nombreDisplay() { return document.getElementById('nombre-usuario-display'); },
    get avatarLetra()   { return document.getElementById('avatar-letra'); }
};

/**
 * updateAuthUI()
 * --------------
 * Función principal. Actualiza TODA la interfaz del menú
 * principal según el estado de autenticación actual.
 * Llámala siempre que el estado de sesión cambie.
 */
function updateAuthUI() {
    const { logueado, usuario } = AuthState;

    if (logueado) {
        _mostrarUsuarioLogueado(usuario);
    } else {
        _mostrarInvitado();
    }
}

/* ── Helpers internos ────────────────────────────────────── */

function _mostrarUsuarioLogueado(nombre) {
    const { zoneGuest, zoneLogged, nombreDisplay, avatarLetra } = DOM;

    if (!zoneGuest || !zoneLogged) return;

    // Actualizar contenido
    if (nombreDisplay) nombreDisplay.textContent = nombre;
    if (avatarLetra)   avatarLetra.textContent   = nombre.charAt(0).toUpperCase();

    // Transición: ocultar guest → mostrar logueado
    _fadeOut(zoneGuest, () => _fadeIn(zoneLogged));
}

function _mostrarInvitado() {
    const { zoneGuest, zoneLogged, nombreDisplay, avatarLetra } = DOM;

    if (!zoneGuest || !zoneLogged) return;

    // Limpiar contenido visual
    if (nombreDisplay) nombreDisplay.textContent = '';
    if (avatarLetra)   avatarLetra.textContent   = '?';

    // Transición: ocultar logueado → mostrar guest
    _fadeOut(zoneLogged, () => _fadeIn(zoneGuest));
}

/**
 * cerrarSesion()
 * Limpia el estado, cierra modales si están abiertos
 * y actualiza la UI — sin reload.
 */
function cerrarSesion() {
    AuthState.limpiar();
    _cerrarModalSiAbierto('loginModal');
    _cerrarModalSiAbierto('registroModal');
    updateAuthUI();

    // Feedback visual sutil
    _mostrarToast('Sesión cerrada. ¡Hasta pronto! 👋');
}

/* ── Animaciones fade con CSS transitions ────────────────── */

function _fadeOut(elemento, callback) {
    if (!elemento) { callback && callback(); return; }
    elemento.classList.add('auth-fade-out');
    elemento.classList.remove('auth-visible');

    const onEnd = () => {
        elemento.removeEventListener('transitionend', onEnd);
        elemento.style.display = 'none';
        elemento.classList.remove('auth-fade-out');
        callback && callback();
    };

    // Si ya está oculto, ejecutar callback directo
    if (elemento.style.display === 'none') {
        elemento.classList.remove('auth-fade-out');
        callback && callback();
    } else {
        elemento.addEventListener('transitionend', onEnd, { once: true });
    }
}

function _fadeIn(elemento) {
    if (!elemento) return;
    elemento.style.display = '';
    // Forzar reflow para que la transición ocurra
    void elemento.offsetHeight;
    elemento.classList.add('auth-visible');
}

/* ── Toast de notificación ───────────────────────────────── */

function _mostrarToast(mensaje) {
    // Reutilizar toast existente o crear uno
    let toast = document.getElementById('auth-toast');

    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'auth-toast';
        toast.className = 'auth-toast';
        document.body.appendChild(toast);
    }

    toast.textContent = mensaje;
    toast.classList.add('auth-toast--visible');

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.remove('auth-toast--visible');
    }, 3000);
}

/* ── Cerrar modales Bootstrap sin reload ─────────────────── */

function _cerrarModalSiAbierto(idModal) {
    try {
        const el = document.getElementById(idModal);
        if (!el) return;
        const instancia = bootstrap.Modal.getInstance(el);
        if (instancia) instancia.hide();
    } catch (e) {
        // Bootstrap no disponible aún, ignorar
    }
}

/* ── Inicialización automática al cargar la página ───────── */

document.addEventListener('DOMContentLoaded', () => {
    updateAuthUI();
});
