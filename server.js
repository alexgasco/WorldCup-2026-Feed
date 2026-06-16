const http = require('http');
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');

const parser = new Parser({
    timeout: 9000, // si YouTube tarda más de 9s, abortamos (y usamos la caché)
    customFields: {
        item: [['media:group', 'mediaGroup']],
    },
});

// Official FIFA World Cup 2026 emblem, loaded once and served at /emblem.svg
let EMBLEM_SVG = null;
try {
    EMBLEM_SVG = fs.readFileSync(path.join(__dirname, 'emblem.svg'));
} catch (error) {
    console.warn('Aviso: no se encontró emblem.svg, la cabecera saldrá sin emblema.');
}

// Logo del canal Replay: se usa solo si colocas el archivo en la carpeta
// (replay-logo.png o replay-logo.svg). Si no está, se usa el icono genérico.
let REPLAY_LOGO = null;
try {
    if (fs.existsSync(path.join(__dirname, 'replay-logo.png'))) {
        REPLAY_LOGO = { data: fs.readFileSync(path.join(__dirname, 'replay-logo.png')), type: 'image/png' };
    } else if (fs.existsSync(path.join(__dirname, 'replay-logo.svg'))) {
        REPLAY_LOGO = { data: fs.readFileSync(path.join(__dirname, 'replay-logo.svg')), type: 'image/svg+xml' };
    } else if (fs.existsSync(path.join(__dirname, 'replay-logo.jpg'))) {
        REPLAY_LOGO = { data: fs.readFileSync(path.join(__dirname, 'replay-logo.jpg')), type: 'image/jpeg' };
    } else if (fs.existsSync(path.join(__dirname, 'replay-logo.jpeg'))) {
        REPLAY_LOGO = { data: fs.readFileSync(path.join(__dirname, 'replay-logo.jpeg')), type: 'image/jpeg' };
    }
} catch (error) {
    REPLAY_LOGO = null;
}

// Icono del balón del Mundial para la pestaña del navegador (favicon).
// Coloca el archivo en la carpeta (ball.png / ball.svg / ball.jpg). Si no está, se usa el emblema oficial.
let BALL_ICON = null;
try {
    if (fs.existsSync(path.join(__dirname, 'ball.png'))) {
        BALL_ICON = { data: fs.readFileSync(path.join(__dirname, 'ball.png')), type: 'image/png' };
    } else if (fs.existsSync(path.join(__dirname, 'ball.svg'))) {
        BALL_ICON = { data: fs.readFileSync(path.join(__dirname, 'ball.svg')), type: 'image/svg+xml' };
    } else if (fs.existsSync(path.join(__dirname, 'ball.jpg'))) {
        BALL_ICON = { data: fs.readFileSync(path.join(__dirname, 'ball.jpg')), type: 'image/jpeg' };
    }
} catch (error) {
    BALL_ICON = null;
}

const daznPlaylistId = 'PL8vYHFKv-YcqjDmrVZm-AghTsjCaMNNwi';
const tvePlaylistId = 'PLhEMBJiEYKv5FvOHB49kE5-dCMHzZHuKa';
const replayPlaylistId = 'PLPPlHBqoxcoM';
const PORT = process.env.PORT || 3000;

// Clave de la API de YouTube (se lee de la variable de entorno de Render, nunca va en el código).
// Si existe, leemos la lista COMPLETA de cada cadena por la API. Si no, usamos el RSS (máx. 15).
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';

const getRssUrl = (playlistId) => `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;

// Lee TODOS los vídeos de una lista por la API de YouTube (de 50 en 50, paginando).
// Devuelve los vídeos con la misma forma que el RSS, para reutilizar el resto del código.
const fetchPlaylistApi = async (playlistId) => {
    const items = [];
    let pageToken = '';
    let pages = 0;
    do {
        const url = 'https://www.googleapis.com/youtube/v3/playlistItems' +
            '?part=snippet,contentDetails&maxResults=50&playlistId=' + encodeURIComponent(playlistId) +
            '&key=' + encodeURIComponent(YOUTUBE_API_KEY) + (pageToken ? '&pageToken=' + pageToken : '');
        const response = await fetch(url);
        if (!response.ok) throw new Error('API HTTP ' + response.status);
        const data = await response.json();
        (data.items || []).forEach((it) => {
            const details = it.contentDetails || {};
            const snippet = it.snippet || {};
            const videoId = details.videoId;
            if (!videoId) return;
            const thumbs = snippet.thumbnails || {};
            const best = thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default || {};
            items.push({
                title: snippet.title || '',
                link: 'https://www.youtube.com/watch?v=' + videoId,
                id: 'yt:video:' + videoId,
                isoDate: details.videoPublishedAt || snippet.publishedAt,
                mediaGroup: { 'media:thumbnail': [{ $: { url: best.url || '' } }] },
            });
        });
        pageToken = data.nextPageToken || '';
        pages += 1;
    } while (pageToken && pages < 10); // tope de seguridad: hasta 500 vídeos

    // Segunda llamada: pedir la DURACIÓN de cada vídeo (la lista anterior no la trae).
    const ids = items.map((it) => it.id.split(':').pop());
    const durations = await fetchDurations(ids);
    items.forEach((it) => { it.duration = durations[it.id.split(':').pop()] || ''; });
    return { items };
};

// Convierte la duración de YouTube (formato ISO, p. ej. "PT3M45S") a "3:45" (min:seg).
const parseDuration = (iso) => {
    const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
    if (!m) return '';
    const total = (parseInt(m[1] || '0', 10) * 3600) + (parseInt(m[2] || '0', 10) * 60) + parseInt(m[3] || '0', 10);
    if (total <= 0) return '';
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return mm + ':' + String(ss).padStart(2, '0');
};

// Pide las duraciones de una lista de vídeos (de 50 en 50) y devuelve { videoId: "3:45" }.
const fetchDurations = async (videoIds) => {
    const map = {};
    for (let i = 0; i < videoIds.length; i += 50) {
        const batch = videoIds.slice(i, i + 50);
        const url = 'https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=' +
            batch.join(',') + '&key=' + encodeURIComponent(YOUTUBE_API_KEY);
        const response = await fetch(url);
        if (!response.ok) throw new Error('API videos HTTP ' + response.status);
        const data = await response.json();
        (data.items || []).forEach((v) => {
            map[v.id] = parseDuration(v.contentDetails && v.contentDetails.duration);
        });
    }
    return map;
};

// ===========================================================================
//  CALENDARIO DE PARTIDOS  (EDITA AQUÍ los partidos del día)
// ---------------------------------------------------------------------------
//  Añade una línea por cada partido. Formato:
//      { date: 'AAAA-MM-DD', time: 'HH:MM', home: 'Equipo1', away: 'Equipo2' },
//  - 'date' es el día del partido (año-mes-día). Ej: '2026-06-13'
//  - 'time' es la hora (opcional). Ej: '21:00'
//  - 'home' y 'away' son los nombres de los equipos (en español, con tilde).
//    Usa exactamente los nombres de la lista COUNTRIES de más abajo.
//  Cuando el vídeo del partido aparezca en YouTube, los botones se activan solos.
//  Borra o cambia estas líneas de ejemplo por los partidos reales del día.
// ===========================================================================
// Horas en hora peninsular española (los partidos de madrugada caen al día siguiente).
const FIXTURES = [
    // --- Jornada 1 ---
    { date: '2026-06-11', time: '21:00', home: 'México', away: 'Sudáfrica' },
    { date: '2026-06-12', time: '04:00', home: 'Corea del Sur', away: 'República Checa' },
    { date: '2026-06-12', time: '21:00', home: 'Canadá', away: 'Bosnia y Herzegovina' },
    { date: '2026-06-13', time: '03:00', home: 'Estados Unidos', away: 'Paraguay' },
    { date: '2026-06-13', time: '21:00', home: 'Catar', away: 'Suiza' },
    { date: '2026-06-14', time: '00:00', home: 'Brasil', away: 'Marruecos' },
    { date: '2026-06-14', time: '03:00', home: 'Haití', away: 'Escocia' },
    { date: '2026-06-14', time: '06:00', home: 'Australia', away: 'Turquía' },
    { date: '2026-06-14', time: '19:00', home: 'Alemania', away: 'Curazao' },
    { date: '2026-06-14', time: '22:00', home: 'Países Bajos', away: 'Japón' },
    { date: '2026-06-15', time: '01:00', home: 'Costa de Marfil', away: 'Ecuador' },
    { date: '2026-06-15', time: '04:00', home: 'Suecia', away: 'Túnez' },
    { date: '2026-06-15', time: '18:00', home: 'España', away: 'Cabo Verde' },
    { date: '2026-06-15', time: '21:00', home: 'Bélgica', away: 'Egipto' },
    { date: '2026-06-16', time: '00:00', home: 'Arabia Saudí', away: 'Uruguay' },
    { date: '2026-06-16', time: '03:00', home: 'Irán', away: 'Nueva Zelanda' },
    { date: '2026-06-16', time: '21:00', home: 'Francia', away: 'Senegal' },
    { date: '2026-06-17', time: '00:00', home: 'Irak', away: 'Noruega' },
    { date: '2026-06-17', time: '03:00', home: 'Argentina', away: 'Argelia' },
    { date: '2026-06-17', time: '06:00', home: 'Austria', away: 'Jordania' },
    { date: '2026-06-17', time: '19:00', home: 'Portugal', away: 'RD Congo' },
    { date: '2026-06-17', time: '22:00', home: 'Inglaterra', away: 'Croacia' },
    { date: '2026-06-18', time: '01:00', home: 'Ghana', away: 'Panamá' },
    { date: '2026-06-18', time: '04:00', home: 'Uzbekistán', away: 'Colombia' },
    // --- Jornada 2 ---
    { date: '2026-06-18', time: '18:00', home: 'República Checa', away: 'Sudáfrica' },
    { date: '2026-06-18', time: '21:00', home: 'Suiza', away: 'Bosnia y Herzegovina' },
    { date: '2026-06-19', time: '00:00', home: 'Canadá', away: 'Catar' },
    { date: '2026-06-19', time: '03:00', home: 'México', away: 'Corea del Sur' },
    { date: '2026-06-19', time: '21:00', home: 'Estados Unidos', away: 'Australia' },
    { date: '2026-06-20', time: '00:00', home: 'Escocia', away: 'Marruecos' },
    { date: '2026-06-20', time: '02:30', home: 'Brasil', away: 'Haití' },
    { date: '2026-06-20', time: '05:00', home: 'Turquía', away: 'Paraguay' },
    { date: '2026-06-20', time: '19:00', home: 'Países Bajos', away: 'Suecia' },
    { date: '2026-06-20', time: '22:00', home: 'Alemania', away: 'Costa de Marfil' },
    { date: '2026-06-21', time: '02:00', home: 'Ecuador', away: 'Curazao' },
    { date: '2026-06-21', time: '06:00', home: 'Túnez', away: 'Japón' },
    { date: '2026-06-21', time: '18:00', home: 'España', away: 'Arabia Saudí' },
    { date: '2026-06-21', time: '21:00', home: 'Bélgica', away: 'Irán' },
    { date: '2026-06-22', time: '00:00', home: 'Uruguay', away: 'Cabo Verde' },
    { date: '2026-06-22', time: '03:00', home: 'Nueva Zelanda', away: 'Egipto' },
    { date: '2026-06-22', time: '19:00', home: 'Argentina', away: 'Austria' },
    { date: '2026-06-22', time: '23:00', home: 'Francia', away: 'Irak' },
    { date: '2026-06-23', time: '02:00', home: 'Noruega', away: 'Senegal' },
    { date: '2026-06-23', time: '05:00', home: 'Jordania', away: 'Argelia' },
    { date: '2026-06-23', time: '19:00', home: 'Portugal', away: 'Uzbekistán' },
    { date: '2026-06-23', time: '22:00', home: 'Inglaterra', away: 'Ghana' },
    { date: '2026-06-24', time: '01:00', home: 'Panamá', away: 'Croacia' },
    { date: '2026-06-24', time: '04:00', home: 'Colombia', away: 'RD Congo' },
    // --- Jornada 3 ---
    { date: '2026-06-24', time: '21:00', home: 'Suiza', away: 'Canadá' },
    { date: '2026-06-24', time: '21:00', home: 'Bosnia y Herzegovina', away: 'Catar' },
    { date: '2026-06-25', time: '00:00', home: 'Escocia', away: 'Brasil' },
    { date: '2026-06-25', time: '00:00', home: 'Marruecos', away: 'Haití' },
    { date: '2026-06-25', time: '03:00', home: 'Sudáfrica', away: 'Corea del Sur' },
    { date: '2026-06-25', time: '03:00', home: 'República Checa', away: 'México' },
    { date: '2026-06-25', time: '22:00', home: 'Ecuador', away: 'Alemania' },
    { date: '2026-06-25', time: '22:00', home: 'Curazao', away: 'Costa de Marfil' },
    { date: '2026-06-26', time: '01:00', home: 'Túnez', away: 'Países Bajos' },
    { date: '2026-06-26', time: '01:00', home: 'Japón', away: 'Suecia' },
    { date: '2026-06-26', time: '04:00', home: 'Turquía', away: 'Estados Unidos' },
    { date: '2026-06-26', time: '04:00', home: 'Paraguay', away: 'Australia' },
    { date: '2026-06-26', time: '21:00', home: 'Senegal', away: 'Irak' },
    { date: '2026-06-26', time: '21:00', home: 'Noruega', away: 'Francia' },
    { date: '2026-06-27', time: '02:00', home: 'Uruguay', away: 'España' },
    { date: '2026-06-27', time: '02:00', home: 'Cabo Verde', away: 'Arabia Saudí' },
    { date: '2026-06-27', time: '05:00', home: 'Nueva Zelanda', away: 'Bélgica' },
    { date: '2026-06-27', time: '05:00', home: 'Egipto', away: 'Irán' },
    { date: '2026-06-27', time: '23:00', home: 'Panamá', away: 'Inglaterra' },
    { date: '2026-06-27', time: '23:00', home: 'Croacia', away: 'Ghana' },
    { date: '2026-06-28', time: '01:30', home: 'RD Congo', away: 'Uzbekistán' },
    { date: '2026-06-28', time: '01:30', home: 'Colombia', away: 'Portugal' },
    { date: '2026-06-28', time: '04:00', home: 'Jordania', away: 'Argentina' },
    { date: '2026-06-28', time: '04:00', home: 'Argelia', away: 'Austria' },
];

// Country name (Spanish) -> ISO code used to load the real flag image.
const COUNTRIES = [
    ['Bosnia y Herzegovina', 'ba'], ['Emiratos Árabes Unidos', 'ae'],
    ['Estados Unidos', 'us'], ['Guinea Ecuatorial', 'gq'],
    ['República Checa', 'cz'], ['Corea del Norte', 'kp'],
    ['Corea del Sur', 'kr'], ['Costa de Marfil', 'ci'],
    ['Costa Rica', 'cr'], ['Cabo Verde', 'cv'], ['Burkina Faso', 'bf'],
    ['Nueva Zelanda', 'nz'], ['Países Bajos', 'nl'], ['Arabia Saudí', 'sa'],
    ['Sudáfrica', 'za'], ['RD Congo', 'cd'], ['Eslovaquia', 'sk'],
    ['Eslovenia', 'si'], ['Uzbekistán', 'uz'], ['Dinamarca', 'dk'],
    ['Inglaterra', 'gb-eng'], ['Escocia', 'gb-sct'], ['Gales', 'gb-wls'],
    ['Argentina', 'ar'], ['Australia', 'au'], ['Alemania', 'de'],
    ['Argelia', 'dz'], ['Camerún', 'cm'], ['Colombia', 'co'],
    ['Croacia', 'hr'], ['Ecuador', 'ec'], ['Honduras', 'hn'],
    ['Hungría', 'hu'], ['Jamaica', 'jm'], ['Marruecos', 'ma'],
    ['Noruega', 'no'], ['Paraguay', 'py'], ['Portugal', 'pt'],
    ['Rumanía', 'ro'], ['Senegal', 'sn'], ['Serbia', 'rs'],
    ['Túnez', 'tn'], ['Turquía', 'tr'], ['Ucrania', 'ua'],
    ['Uruguay', 'uy'], ['Venezuela', 've'], ['Angola', 'ao'],
    ['Austria', 'at'], ['Bélgica', 'be'], ['Bolivia', 'bo'],
    ['Brasil', 'br'], ['Canadá', 'ca'], ['Chile', 'cl'],
    ['Egipto', 'eg'], ['España', 'es'], ['Francia', 'fr'],
    ['Ghana', 'gh'], ['Grecia', 'gr'], ['Guinea', 'gn'],
    ['Irak', 'iq'], ['Irán', 'ir'], ['Italia', 'it'],
    ['Japón', 'jp'], ['Jordania', 'jo'], ['Mali', 'ml'],
    ['México', 'mx'], ['Nigeria', 'ng'], ['Panamá', 'pa'],
    ['Perú', 'pe'], ['Polonia', 'pl'], ['Qatar', 'qa'],
    ['Catar', 'qa'], ['Suecia', 'se'], ['Suiza', 'ch'],
    ['Haití', 'ht'], ['Curazao', 'cw'], ['Zambia', 'zm'],
    // Alias usados por las cadenas (mismo país, otra forma de escribirlo)
    ['República de Corea', 'kr'], ['Corea', 'kr'], ['Chequia', 'cz'],
    ['Holanda', 'nl'], ['Curaçao', 'cw'], ['Arabia Saudita', 'sa'],
    ['República Democrática del Congo', 'cd'], ['Bosnia', 'ba'],
];

const stripAccents = (text) =>
    text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const COUNTRY_INDEX = COUNTRIES
    .map(([name, iso]) => ({ name, iso, normalized: stripAccents(name) }))
    .sort((a, b) => b.normalized.length - a.normalized.length);

const resolveCountry = (name) => {
    const wanted = stripAccents(String(name).trim());
    return COUNTRY_INDEX.find((country) => country.normalized === wanted) || null;
};

// Grupos del Mundial (A-L). Cada grupo son los 4 equipos que se enfrentan entre sí
// en la fase de grupos. Si cambia el sorteo real, edita aquí los equipos de cada letra.
const GROUPS = {
    A: ['México', 'Sudáfrica', 'Corea del Sur', 'República Checa'],
    B: ['Canadá', 'Bosnia y Herzegovina', 'Catar', 'Suiza'],
    C: ['Brasil', 'Marruecos', 'Haití', 'Escocia'],
    D: ['Estados Unidos', 'Paraguay', 'Australia', 'Turquía'],
    E: ['Alemania', 'Curazao', 'Costa de Marfil', 'Ecuador'],
    F: ['Países Bajos', 'Japón', 'Suecia', 'Túnez'],
    G: ['Bélgica', 'Egipto', 'Irán', 'Nueva Zelanda'],
    H: ['España', 'Cabo Verde', 'Arabia Saudí', 'Uruguay'],
    I: ['Francia', 'Senegal', 'Irak', 'Noruega'],
    J: ['Argentina', 'Argelia', 'Austria', 'Jordania'],
    K: ['Portugal', 'RD Congo', 'Uzbekistán', 'Colombia'],
    L: ['Inglaterra', 'Croacia', 'Ghana', 'Panamá'],
};

// Índice rápido: código ISO del país -> letra de su grupo.
const TEAM_GROUP = {};
Object.keys(GROUPS).forEach((letter) => {
    GROUPS[letter].forEach((teamName) => {
        const country = resolveCountry(teamName);
        if (country) TEAM_GROUP[country.iso] = letter;
    });
});

// Finds exactly two distinct national teams inside a video title.
const findTeams = (title) => {
    let haystack = ' ' + stripAccents(title).replace(/\s+/g, ' ') + ' ';
    const found = [];
    for (const country of COUNTRY_INDEX) {
        if (found.some((team) => team.name === country.name)) continue;
        if (haystack.includes(' ' + country.normalized + ' ')) {
            found.push(country);
            haystack = haystack.replace(' ' + country.normalized + ' ', '  ');
            if (found.length === 2) break;
        }
    }
    return found.length === 2 ? found : null;
};

const matchKeyOf = (teams) => teams.map((team) => team.iso).sort().join('-');

const dateKeyMadrid = (date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(date);

const prettyDate = (dateKey) => {
    const date = new Date(dateKey + 'T12:00:00Z');
    const text = new Intl.DateTimeFormat('es-ES', {
        weekday: 'long', day: 'numeric', month: 'long',
    }).format(date);
    return text.charAt(0).toUpperCase() + text.slice(1);
};

// Turns one raw RSS item into a clean object, or null if it is not a match.
const buildVideoEntry = (item, source) => {
    const teams = findTeams(item.title);
    if (!teams) return null;
    const group = item.mediaGroup || {};
    const thumbnail = group['media:thumbnail'] && group['media:thumbnail'][0]
        ? group['media:thumbnail'][0].$.url : '';
    let views = '';
    try {
        views = group['media:community'][0]['media:statistics'][0].$.views;
    } catch (error) {
        views = '';
    }
    // Posición del marcador dentro del título (para tapar solo esos caracteres).
    const scoreMatch = item.title.match(/\(\s*\d+\s*[-–—]\s*\d+\s*\)/) || item.title.match(/\d+\s*[-–—]\s*\d+/);
    return {
        source, teams, link: item.link, videoId: (item.id || '').split(':').pop(),
        thumbnail, views, title: item.title || '',
        duration: item.duration || '', // "3:45"; vacío si se leyó por RSS (sin duración)
        scoreStart: scoreMatch ? scoreMatch.index : -1,
        scoreLen: scoreMatch ? scoreMatch[0].length : 0,
        date: new Date(item.isoDate),
        matchKey: matchKeyOf(teams),
    };
};

const escapeHtml = (text) =>
    String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const flagImg = (team) =>
    `<img class="flag" src="https://flagcdn.com/w80/${team.iso}.png" srcset="https://flagcdn.com/w160/${team.iso}.png 2x" width="44" height="33" alt="${escapeHtml(team.name)}" loading="lazy">`;

const renderButton = (entry, symbolId, brandClass, textLogo) => {
    let logo;
    if (brandClass === 'replay' && REPLAY_LOGO) {
        logo = `<img class="brand replay-img" src="/replay-logo" alt="Replay" aria-hidden="true">`;
    } else if (symbolId) {
        logo = `<svg class="brand ${brandClass}" aria-hidden="true"><use href="#${symbolId}"></use></svg>`;
    } else {
        logo = `<span class="brand brand-text ${brandClass}">${textLogo}</span>`;
    }
    const audio = brandClass === 'replay'
        ? `<span class="audio" title="Sin narración"><span class="nospeak">🗣️</span></span>`
        : `<span class="audio" title="Narración en español de España">🗣️<img class="miniflag" src="https://flagcdn.com/w20/es.png" width="16" height="11" alt="España"></span>`;
    if (entry) {
        const cap = entry.duration ? `Ver ▶ <span class="dur">${entry.duration}</span>` : 'Ver ▶';
        return `<button class="watch ${brandClass}" data-provider="${brandClass}" data-video="${escapeHtml(entry.videoId)}" data-title="${escapeHtml(entry.title)}" data-score-start="${entry.scoreStart}" data-score-len="${entry.scoreLen}">${logo}<span class="cap">${cap}</span>${audio}</button>`;
    }
    return `<button class="watch ${brandClass} disabled" disabled>${logo}<span class="cap">No disponible</span>${audio}</button>`;
};

const renderMatchCard = (match) => {
    const [home, away] = match.teams;
    const reference = match.rtve || match.dazn || match.replay;
    const thumbnail = reference && reference.thumbnail ? reference.thumbnail : '';
    const phase = match.phase || 'Fase de grupos';
    // Solo en fase de grupos añadimos "· Grupo X" (en eliminatorias no hay grupo).
    const groupLetter = phase === 'Fase de grupos' ? (TEAM_GROUP[home.iso] || '') : '';
    const phaseLabel = groupLetter ? `${phase} · Grupo ${groupLetter}` : phase;

    // Un partido se considera finalizado ~2 horas después de su inicio.
    const finished = match.sortTime instanceof Date && (match.sortTime.getTime() + 2 * 60 * 60 * 1000) < Date.now();
    const statusBadge = finished ? '<span class="status">✓ Finalizado</span>' : '';
    const timeBadge = match.time ? `<span class="kick">🕒 ${match.time}</span>` : '';
    const meta = statusBadge + timeBadge;
    const soonBadge = (!thumbnail && !finished) ? '<span class="soon">Próximamente</span>' : '';

    const banner = thumbnail
        ? `<div class="banner" style="background-image:url('${escapeHtml(thumbnail)}')">${meta}</div>`
        : `<div class="banner banner-empty">${meta}${soonBadge}</div>`;

    return `
        <article class="card">
            ${banner}
            <div class="body">
                <div class="teams">
                    <div class="team">${flagImg(home)}<span class="name">${escapeHtml(home.name)}</span></div>
                    <span class="vs">VS</span>
                    <div class="team">${flagImg(away)}<span class="name">${escapeHtml(away.name)}</span></div>
                </div>
                <div class="phase">${escapeHtml(phaseLabel)}</div>
                <div class="buttons">
                    ${renderButton(match.dazn, 'logo-dazn', 'dazn')}
                    ${renderButton(match.rtve, 'logo-rtve', 'rtve')}
                    ${renderButton(match.replay, null, 'replay', '@Replay')}
                </div>
            </div>
        </article>`;
};

const buildPage = (daznFeed, tveFeed, replayFeed) => {
    const matches = new Map();

    // 1) Seed with the manual calendar so future matches show without a video.
    FIXTURES.forEach((fixture) => {
        const home = resolveCountry(fixture.home);
        const away = resolveCountry(fixture.away);
        if (!home || !away) {
            console.warn('Fixture con equipo no reconocido:', fixture.home, '/', fixture.away);
            return;
        }
        const teams = [home, away];
        const key = matchKeyOf(teams);
        matches.set(key, {
            teams, matchKey: key,
            dateKey: fixture.date,
            time: fixture.time || '',
            phase: fixture.phase || 'Fase de grupos',
            sortTime: new Date(`${fixture.date}T${fixture.time || '00:00'}:00+02:00`),
        });
    });

    // 2) Add the published videos (DAZN / RTVE), merging into existing matches.
    const addVideo = (item, source) => {
        const entry = buildVideoEntry(item, source);
        if (!entry) return;
        if (!matches.has(entry.matchKey)) {
            matches.set(entry.matchKey, {
                teams: entry.teams, matchKey: entry.matchKey,
                dateKey: dateKeyMadrid(entry.date),
                time: '', phase: 'Fase de grupos', sortTime: entry.date,
            });
        }
        matches.get(entry.matchKey)[source] = entry;
    };
    tveFeed.items.forEach((item) => addVideo(item, 'rtve'));
    daznFeed.items.forEach((item) => addVideo(item, 'dazn'));
    replayFeed.items.forEach((item) => addVideo(item, 'replay'));

    // 3) Group by day (newest day first), matches sorted by kickoff time.
    const days = new Map();
    for (const match of matches.values()) {
        if (!days.has(match.dateKey)) days.set(match.dateKey, []);
        days.get(match.dateKey).push(match);
    }

    const today = dateKeyMadrid(new Date());
    // Hace 6 días (para mostrar hoy + 6 días anteriores = 7 días en la pestaña principal).
    const sixDaysAgo = dateKeyMadrid(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));

    const renderDay = (dateKey, heading) => {
        // Dentro de cada día, el más reciente (hora más tardía) primero.
        const items = days.get(dateKey).sort((a, b) => b.sortTime - a.sortTime);
        return `<section class="day"><h2>${heading}</h2><div class="cards">${items.map(renderMatchCard).join('')}</div></section>`;
    };
    const dayHeading = (dateKey) => dateKey === today ? 'Hoy · ' + prettyDate(today) : prettyDate(dateKey);

    // Pestaña 1, parte visible: hoy y los 6 días anteriores (del más reciente al más antiguo).
    const recentSections = [...days.keys()]
        .filter((dateKey) => dateKey <= today && dateKey >= sixDaysAgo)
        .sort((a, b) => b.localeCompare(a))
        .map((dateKey) => renderDay(dateKey, dayHeading(dateKey)))
        .join('');

    // Pestaña 1, desplegable: partidos de hace más de 7 días (calendario completo de lo jugado).
    const olderSections = [...days.keys()]
        .filter((dateKey) => dateKey < sixDaysAgo)
        .sort((a, b) => b.localeCompare(a))
        .map((dateKey) => renderDay(dateKey, prettyDate(dateKey)))
        .join('');
    const olderBlock = olderSections
        ? `<details class="calendar"><summary>📅 Ver partidos anteriores (calendario completo)</summary>${olderSections}</details>`
        : '';

    // Pestaña 2: próximos partidos (futuros), en orden cronológico.
    const restSections = [...days.keys()]
        .filter((dateKey) => dateKey > today)
        .sort((a, b) => a.localeCompare(b))
        .map((dateKey) => renderDay(dateKey, prettyDate(dateKey)))
        .join('');

    // Dos pestañas: "Hoy y anteriores" (partidos jugados) y "Próximos partidos".
    const content = `
        <div class="tabs">
            <button class="tab active" data-tab="prev">Hoy y anteriores</button>
            <button class="tab" data-tab="next">Próximos partidos</button>
        </div>
        <div class="tab-panel active" id="tab-prev">${(recentSections + olderBlock) || '<p class="empty">Aún no hay partidos jugados.</p>'}</div>
        <div class="tab-panel" id="tab-next">${restSections || '<p class="empty">No hay próximos partidos.</p>'}</div>`;
    return PAGE_TEMPLATE.replace('<!--CONTENT-->', content);
};

// Official DAZN and RTVE logos (vector), embedded once and reused on buttons.
const LOGO_DEFS = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <symbol id="logo-dazn" viewBox="0 0 613.5 617.6">
        <polygon fill="#000" points="0,308.8 0,617.6 306.7,617.6 613.5,617.6 613.5,308.8 613.5,0 306.7,0 0,0 "/>
        <path fill="#fff" d="M540.2,178v102.8l-13.9,13.9l-14,14l14,14l13.9,13.9v102.8v102.7H306.7H73.3V439.6V336.7l13.9-13.9l14-14l-14-14l-13.9-13.9V178V75.3h233.5h233.5V178z M95.9,184.4v86.5l18.9,18.9l19,19l-19,19l-18.9,18.9v86.5v86.5h210.8h210.8v-86.5v-86.5l-18.9-18.9l-19-19l19-19l18.9-18.9v-86.5V97.9H306.7H95.9V184.4z"/>
        <path fill="#fff" d="M265.1,166.4l14.7,14.7v35v35l-14.6,14.6l-14.7,14.7h-39.1h-39.1v-64.4v-64.4h39.1h39.1L265.1,166.4z M195,216.1v41.7h22.9h22.9l7.5-8.1l7.5-8v-25.6v-25.7l-7.6-8.1l-7.6-8.1h-22.9H195V216.1z"/>
        <path fill="#fff" d="M425.3,216c14.6,35.2,26.5,64,26.5,64.2s-5.5,0.3-12.3,0.3h-12.3l-3.2-7.6l-3.2-7.6h-32.7h-32.7l-3,7.4l-3,7.4l-12.5,0.2c-9.9,0.1-12.5,0-12.2-0.7c0.2-0.5,12-29.1,26.3-63.5c14.3-34.5,26.1-63,26.3-63.5c0.3-0.6,2.9-0.8,11-0.7l10.5,0.2L425.3,216z M377,213.8c-5.9,14.3-11,26.5-11.2,27.2c-0.4,1.2,0.9,1.3,22.4,1.3c18.3,0,22.7-0.2,22.5-0.9c-0.5-2-22.1-53.6-22.5-53.6C387.9,187.8,383,199.6,377,213.8z"/>
        <polygon fill="#fff" points="270,348.3 270,359.6 236.3,401.3 202.8,442.9 236.3,443.1 270,443.2 270,454.6 270,465.9 221.1,465.9 172.3,465.9 172.3,454.3 172.4,442.9 206.2,401.5 240,360.1 206.1,359.9 172.3,359.7 172.3,348.4 172.3,337.1 221.1,337.1 270,337.1 "/>
        <polygon fill="#fff" points="386.1,382.9 418.2,428.9 418.4,382.9 418.5,337.1 429.9,337.1 441.2,337.1 441.2,401.5 441.2,465.9 428.3,465.9 415.4,465.9 386.7,424.2 358,382.6 357.8,424.3 357.7,465.9 345.7,465.9 333.6,465.9 333.6,401.5 333.6,337.1 343.8,337.1 353.9,337.1 "/>
    </symbol>
    <symbol id="logo-rtve" viewBox="0 0 483.9 250">
        <linearGradient id="rtveGrad" gradientUnits="userSpaceOnUse" x1="92.4439" y1="-34.806" x2="387.7236" y2="260.4739" gradientTransform="matrix(1 0 0 -1 0 251.7)">
            <stop offset="0" stop-color="#F5A717"/>
            <stop offset="1" stop-color="#E6511F"/>
        </linearGradient>
        <path fill="url(#rtveGrad)" d="M40.7,187.3c0,10.6-6.4,15.4-20.2,15.4C6.4,202.7,0,197.6,0,187.3V61c0-11.3,5.4-16.1,17.6-16.1c11.3,0,15.1,2.5,17.6,12.2c0.6,1.9,1.6,2.9,2.5,2.9c1,0,1.6-0.4,3.8-2.5c8-7.7,21.5-12.5,35.3-12.5c8.3,0,12.5,4.4,12.5,13.2c0,20.2-3.8,27.6-13.8,27.6c-24.4,0-35.9,13.2-34.9,39.7V187.3z M104.5,16.1C104.5,5.2,111,0,124.8,0c14.2,0,20.5,5.2,20.5,16.1v23c0,4.8,1.6,6.4,6.4,6.4h10.9c10.9,0,16.1,6.1,16.1,19.2c0,12.8-5.2,19-16.1,19h-10.9c-4.4,0-6.4,1.9-6.4,6.4v48.1c0,21.8,7.1,32.4,21.5,32.4c3.5,0,7.1-0.4,16.7-1.3c1-0.4,1.9-0.4,3.2-0.4c7.1,0,10.2,3.5,10.2,11.9c0,15.7-13.8,24.4-38.2,24.4c-35.9,0-54.2-23.4-54.2-69.3C104.5,135.9,104.5,16.1,104.5,16.1z M285.8,67.7c6.5-18.6,11.3-23,24.4-23c12.2,0,18.6,4.8,18.6,13.8c0,2.3-0.4,3.2-1.6,7.1l-42.7,115.1c-6.5,17.6-11.5,22.1-24.4,22.1c-12.8,0-18-4.4-24.4-22.1L193.1,65.5c-1.3-3.2-1.6-4.8-1.6-7.1c0-9,6.5-13.8,18.6-13.8c13.2,0,17.6,4.4,24,23l21.5,61.9c1,2.5,2.3,3.8,4.4,3.8c1.9,0,3.5-1.3,4.2-3.8L285.8,67.7z M375.3,158.2c-3.8,0-5.4,1.6-5.4,4.8c0,31.8,20.9,51.4,55.2,51.4c12.2,0,20.5-1.9,35.6-8c5.2-1.9,7.3-2.5,9.6-2.5c5.4,0,9.4,4.8,9.4,12.2c0,19.2-26.3,34-61.2,34c-57.1,0-89.2-36.6-89.2-101.7c0-64.5,30.8-103.3,81.7-103.3c43.6,0,72.9,32.8,72.9,81.5c0,24.4-6.4,31.8-27.8,31.8h-80.8V158.2z M439.4,125.8c3.8,0,5.2-1.6,5.2-5.8c0-29.5-12.8-45.5-35.9-45.5c-22.8,0-38.2,19.2-38.2,46.8c0,2.9,1.9,4.4,5.2,4.4C375.7,125.8,439.4,125.8,439.4,125.8z"/>
    </symbol>
    <symbol id="logo-replay" viewBox="0 0 24 24">
        <path fill="currentColor" d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
    </symbol>
</svg>`;

const PAGE_TEMPLATE = `<!DOCTYPE html>
<html lang="es">
<head>
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-K3Z9H173W1"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-K3Z9H173W1');
    </script>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>World Cup 2026 sin Spoilers</title>
    <link rel="icon" href="/favicon.ico">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700;900&family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #f2f4f9; --card: #ffffff; --text: #0f1430; --muted: #6b7280;
            --line: #e7eaf1; --ca: #E4002B; --us: #0033A0; --mx: #009A44;
            --gold: #C9A227; --accent: #009A44; --rtve: #e6511f; --dazn: #111111;
        }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body {
            margin: 0; color: var(--text);
            font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: radial-gradient(120% 70% at 50% 0%, #ffffff, var(--bg));
            min-height: 100vh; padding: 6px 16px 48px;
        }
        .flagbar {
            position: fixed; top: 0; left: 0; right: 0; height: 6px; z-index: 50;
            background: linear-gradient(90deg, var(--ca) 0 33.33%, var(--us) 33.33% 66.66%, var(--mx) 66.66% 100%);
        }
        header { text-align: center; padding: 24px 0 14px; }
        header .emblem { height: 98px; width: auto; display: block; margin: 0 auto 14px; }
        header h1 {
            margin: 0; font-family: 'Orbitron', sans-serif; font-weight: 900; font-size: 1.5rem;
            letter-spacing: 4px; text-transform: uppercase;
            background: linear-gradient(95deg, var(--ca), var(--us) 50%, var(--mx));
            -webkit-background-clip: text; background-clip: text; color: transparent;
        }
        header h1 .sub2 { display: block; font-size: .82em; margin-top: 4px; }
        header .host {
            margin-top: 10px; font-family: 'Orbitron', sans-serif; font-size: .72rem; font-weight: 700; letter-spacing: 4px;
        }
        header .host .ca { color: var(--ca); } header .host .us { color: var(--us); } header .host .mx { color: var(--mx); }
        header .host span { margin: 0 5px; color: #c2c7d6; }
        header .note {
            margin: 16px auto 0; max-width: 400px; font-size: .62rem; color: var(--muted); line-height: 1.7;
            text-transform: uppercase; letter-spacing: .8px; font-weight: 600;
        }
        .day { max-width: 540px; margin: 0 auto; }
        .day h2 {
            font-size: .95rem; color: var(--us); text-transform: uppercase; letter-spacing: 1.2px;
            margin: 26px 0 12px; padding-left: 10px; border-left: 4px solid var(--gold);
        }
        /* El primer título (Hoy) va pegado al texto de la cabecera: menos hueco arriba. */
        main .day:first-of-type h2 { margin-top: 8px; }
        /* Rejilla de tarjetas: 1 columna (móvil por defecto). En PC pasa a 2-3 columnas (más abajo). */
        .cards { display: grid; grid-template-columns: 1fr; gap: 10px; align-items: start; }
        .dots {
            height: 8px; border-radius: 999px; max-width: 540px; margin: 32px auto 0; opacity: .9;
            background: repeating-linear-gradient(90deg, var(--ca) 0 14px, var(--us) 14px 28px, var(--mx) 28px 42px);
        }
        .card {
            background: var(--card); border: 1px solid var(--line); border-radius: 18px;
            overflow: hidden; box-shadow: 0 8px 24px rgba(20,30,60,.07);
        }
        .banner {
            position: relative; height: 50px; background-size: cover; background-position: center;
            display: flex; align-items: center; justify-content: center; gap: 10px;
        }
        .banner::after { content: ""; position: absolute; inset: 0; backdrop-filter: blur(16px); background: rgba(20,24,40,.28); }
        .banner-empty { background: linear-gradient(110deg, var(--ca), var(--us) 55%, var(--mx)); }
        .banner-empty::after { display: none; }
        .banner .kick, .banner .soon, .banner .status {
            position: relative; z-index: 1; color: #fff; font-weight: 700; font-size: .82rem;
            background: rgba(0,0,0,.35); padding: 4px 12px; border-radius: 999px;
        }
        .banner .status { background: rgba(0,154,68,.92); }
        .body { padding: 10px 14px 12px; }
        .teams { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .team { display: flex; flex-direction: column; align-items: center; flex: 1; gap: 5px; }
        .flag {
            width: 40px; height: 30px; object-fit: cover; border-radius: 5px;
            box-shadow: 0 1px 4px rgba(0,0,0,.18); background: #f0f0f0;
        }
        .team .name { font-size: .92rem; font-weight: 700; text-align: center; line-height: 1.2; }
        .vs { font-size: .82rem; font-weight: 900; color: var(--gold); padding: 0 6px; letter-spacing: 1px; }
        .phase {
            text-align: center; margin: 8px auto 0; width: fit-content;
            color: var(--us); font-size: .64rem; font-weight: 800; letter-spacing: .8px;
            text-transform: uppercase; background: #eef2fb; border: 1px solid var(--line);
            padding: 3px 10px; border-radius: 999px;
        }
        .buttons { display: flex; gap: 8px; margin-top: 10px; }
        #videoOverlay {
            display: none; position: fixed; inset: 0; z-index: 9999; align-items: center; justify-content: center;
            padding: 24px; background: rgba(15,20,48,.55); backdrop-filter: blur(3px);
        }
        #videoOverlay.show { display: flex; }
        #videoOverlay .box {
            background: #fff; border-radius: 20px; padding: 28px 24px; max-width: 360px; width: 100%;
            text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,.35);
        }
        #videoOverlay .icon { font-size: 3rem; line-height: 1; }
        #videoOverlay .title { font-size: 1.2rem; font-weight: 800; margin: 14px 0 6px; }
        #videoOverlay .sub { font-size: .88rem; color: var(--muted); margin: 0 0 22px; line-height: 1.4; }
        #videoOverlay .go {
            width: 100%; border: none; border-radius: 12px; padding: 14px; font-size: 1rem; font-weight: 800;
            background: var(--mx); color: #fff; cursor: pointer; transition: background .2s;
        }
        #videoOverlay .go.disabled { background: #c4c9d6; cursor: not-allowed; }
        #videoOverlay .close {
            margin-top: 14px; background: none; border: none; color: var(--muted);
            font-size: .9rem; text-decoration: underline; cursor: pointer;
        }
        #videoOverlay .player { display: none; width: 100%; max-width: 1000px; }
        #videoOverlay.playing { background: rgba(0,0,0,.94); padding: 12px; }
        #videoOverlay.playing .box { display: none; }
        #videoOverlay.playing .player { display: block; }
        /* Modo "Agrandar" (iPhone): el vídeo llena la pantalla del navegador, manteniendo la franja. */
        #videoOverlay.big { padding: 0; }
        #videoOverlay.big .player {
            position: fixed; inset: 0; max-width: none; width: 100%; height: 100%; margin: 0;
            display: flex; align-items: center; justify-content: center; background: #000; z-index: 30;
        }
        #videoOverlay.big .player-bar {
            position: absolute; top: 8px; left: 8px; right: 8px; z-index: 2; margin: 0;
        }
        #videoOverlay.big .frame {
            width: min(100vw, calc(100vh * 16 / 9)); height: auto; border-radius: 0;
        }
        #videoOverlay.big .yt-fallback { display: none; }
        /* En "Agrandar" (iPhone) no mostramos el botón Reducir; se sale con "✕ Cerrar". */
        #videoOverlay.big .player-fs { display: none; }
        .player .player-bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; }
        .player .player-close, .player .player-fs {
            background: rgba(255,255,255,.16); color: #fff;
            border: none; border-radius: 8px; padding: 8px 14px; font-weight: 700; cursor: pointer;
        }
        .player .player-fs { background: var(--us); }
        .player .frame {
            position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000;
            border-radius: 10px; overflow: hidden;
        }
        .player .frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
        .player .frame .score-box {
            position: absolute; z-index: 2; pointer-events: none; border-radius: 4px;
            background: rgba(28,28,32,.62);
            backdrop-filter: blur(11px) saturate(1.1);
            -webkit-backdrop-filter: blur(11px) saturate(1.1);
        }
        .player .frame .cal-catch { position: absolute; inset: 0; z-index: 5; }
        .player .frame .score-box.cal { pointer-events: auto; cursor: move; z-index: 6; touch-action: none; }
        .player .frame .rs-handle {
            position: absolute; right: -16px; bottom: -16px; width: 32px; height: 32px; z-index: 7;
            background: #fff; border: 3px solid #2aa7ff; border-radius: 50%; cursor: nwse-resize; pointer-events: auto;
            touch-action: none;
        }
        .player .frame .cal-readout {
            position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); z-index: 8;
            background: rgba(0,0,0,.82); color: #fff; padding: 7px 14px; border-radius: 8px;
            font-size: .78rem; font-weight: 700; pointer-events: none;
            white-space: normal; max-width: 92vw; text-align: center; line-height: 1.35;
        }
        .player .frame .load-cover {
            position: absolute; inset: 0; z-index: 3; display: flex; align-items: center; justify-content: center;
            background: #000; color: #fff; font-weight: 700; letter-spacing: .5px; font-size: .9rem;
            transition: opacity .4s ease;
        }
        .player .frame .load-cover.hidden { opacity: 0; pointer-events: none; }
        .player .frame .mute-hint {
            position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 8;
            background: var(--mx); color: #fff; font-weight: 800; font-size: .92rem;
            font-family: inherit; padding: 12px 20px; border-radius: 999px; border: none;
            pointer-events: auto; cursor: pointer; white-space: nowrap;
            box-shadow: 0 6px 20px rgba(0,0,0,.45); transition: opacity .5s ease;
        }
        .player .frame .mute-hint:active { transform: translateX(-50%) scale(.96); }
        .player .frame .mute-hint.hidden { opacity: 0; }
        .player .yt-fallback { display: block; margin-top: 12px; color: #cdd3e6; font-size: .8rem; text-decoration: underline; text-align: center; }
        .watch {
            flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px;
            border: 1.5px solid var(--line); border-radius: 14px; padding: 8px 8px; cursor: pointer;
            background: #fff; transition: transform .08s, box-shadow .15s;
        }
        .watch:active { transform: scale(.97); }
        .watch .brand { display: block; }
        .watch .brand.logo-rtve, .brand.rtve { height: 20px; width: 39px; }
        .watch .brand.logo-dazn, .brand.dazn { height: 26px; width: 26px; border-radius: 4px; }
        .watch .brand.logo-replay, .brand.replay { height: 24px; width: 24px; }
        .watch .brand.replay-img { height: 26px; width: 26px; border-radius: 50%; object-fit: cover; }
        .watch .brand.brand-text { height: auto; width: auto; font-weight: 800; font-size: .95rem; line-height: 26px; letter-spacing: .2px; }
        .watch .cap { font-size: .7rem; font-weight: 700; white-space: nowrap; }
        .watch .cap .dur { font-weight: 800; opacity: .6; font-variant-numeric: tabular-nums; }
        .watch .audio { display: flex; align-items: center; justify-content: center; gap: 3px; font-size: .72rem; margin-top: 3px; line-height: 1; }
        .watch .miniflag { width: 16px; height: 11px; border-radius: 2px; box-shadow: 0 0 0 .5px rgba(0,0,0,.15); }
        .watch .audio .nospeak { position: relative; display: inline-block; line-height: 1; }
        .watch .audio .nospeak::after {
            content: ''; position: absolute; top: 50%; left: 50%; width: 145%; height: 2.5px;
            background: #e0231a; border-radius: 2px; transform: translate(-50%, -50%) rotate(-45deg);
        }
        .watch.rtve { box-shadow: inset 0 0 0 0 var(--rtve); }
        .watch.rtve .cap { color: var(--rtve); }
        .watch.rtve:not(.disabled) { border-color: rgba(230,81,31,.45); background: #fff7f2; }
        .watch.dazn .cap { color: var(--dazn); }
        .watch.dazn:not(.disabled) { border-color: rgba(17,17,17,.30); background: #f6f7f9; }
        .watch.replay .brand.replay { color: var(--us); }
        .watch.replay .cap { color: var(--us); }
        .watch.replay:not(.disabled) { border-color: rgba(0,51,160,.4); background: #eef2fb; }
        .watch.disabled { cursor: default; opacity: .45; background: #f5f6f9; }
        .watch.disabled .cap { color: var(--muted); }
        /* Pestañas: "Hoy y anteriores" / "Próximos partidos". */
        .tabs { display: flex; gap: 8px; max-width: 540px; margin: 8px auto 14px; }
        .tab {
            flex: 1; padding: 12px 10px; font-family: inherit; font-weight: 800; font-size: .85rem;
            color: var(--muted); background: #fff; border: 1.5px solid var(--line); border-radius: 12px;
            cursor: pointer; transition: background .15s, color .15s, border-color .15s;
        }
        .tab.active { color: #fff; background: var(--us); border-color: var(--us); box-shadow: 0 6px 16px rgba(0,51,160,.18); }
        .tab-panel { display: none; }
        .tab-panel.active { display: block; }
        /* Desplegable de partidos anteriores (más de 7 días). */
        .calendar { max-width: 540px; margin: 18px auto 0; }
        .calendar > summary {
            list-style: none; cursor: pointer; text-align: center; font-weight: 800; font-size: .9rem;
            color: var(--us); background: #fff; border: 1.5px solid var(--line); border-radius: 14px;
            padding: 15px; box-shadow: 0 6px 18px rgba(20,30,60,.06); user-select: none;
        }
        .calendar > summary::-webkit-details-marker { display: none; }
        .calendar[open] > summary { margin-bottom: 4px; }
        .empty { text-align: center; color: var(--muted); margin-top: 40px; }
        footer { text-align: center; color: var(--muted); font-size: .72rem; margin-top: 36px; line-height: 1.7; }
        footer .contact { font-weight: 600; }
        footer .contact a { color: var(--us); font-weight: 800; text-decoration: none; }
        footer .contact a:hover { text-decoration: underline; }
        footer .donate {
            display: inline-block; margin-left: 10px; padding: 4px 12px; border-radius: 999px;
            background: transparent; color: var(--muted); border: 1px solid var(--line);
            font-size: .7rem; font-weight: 700; text-decoration: none; letter-spacing: .2px;
            vertical-align: middle; transition: color .15s, border-color .15s;
        }
        footer .donate:hover { color: var(--us); border-color: var(--us); }

        /* === SOLO PC === Pantallas anchas: ensanchar el contenedor y mostrar varias tarjetas por fila.
           En el móvil no se aplica nada de esto (sigue 1 tarjeta por fila). */
        @media (min-width: 760px) {
            .day, .tabs, .calendar, .dots { max-width: 940px; }
            .cards { grid-template-columns: repeat(2, 1fr); gap: 14px; }
        }
        @media (min-width: 1180px) {
            .day, .tabs, .calendar, .dots { max-width: 1180px; }
            .cards { grid-template-columns: repeat(3, 1fr); }
        }
    </style>
</head>
<body>
    <div class="flagbar"></div>
    ${LOGO_DEFS}

    <header>
        <img class="emblem" src="/emblem.svg" alt="FIFA World Cup 2026" width="63" height="98">
        <h1>World Cup 2026<span class="sub2">Sin Spoilers</span></h1>
        <div class="host"><span class="ca">CANADÁ</span><span>·</span><span class="us">USA</span><span>·</span><span class="mx">MÉXICO</span></div>
        <div class="note">Resúmenes sin spoilers (sin mostrar el resultado final).</div>
    </header>

    <main><!--CONTENT--></main>

    <div class="dots"></div>
    <footer>
        <span class="contact">¿Fallos o sugerencias? Escríbeme: <a href="mailto:footballnospoilers@gmail.com">footballnospoilers@gmail.com</a></span>
        <a class="donate" href="https://www.paypal.me/FootballNoSpoilers" target="_blank" rel="noopener">❤️ Donar</a>
    </footer>

    <div id="videoOverlay">
        <div class="box">
            <div class="icon">📱</div>
            <p class="title">Gira el móvil en horizontal</p>
            <p class="sub">Para ver el resumen, pon el móvil en posición horizontal y se activará el botón.</p>
            <button class="go disabled" id="videoGo" disabled>Gira el móvil para activar</button>
            <button class="close" id="videoClose">Cancelar</button>
        </div>
        <div class="player">
            <div class="player-bar">
                <button class="player-fs" id="playerFs">⛶ Pantalla completa</button>
                <button class="player-close" id="playerClose">✕ Cerrar</button>
            </div>
            <div class="frame" id="videoFrame"></div>
            <a class="yt-fallback" id="ytFallback" target="_blank" rel="noopener">¿No se ve el vídeo? Ábrelo en YouTube ↗</a>
        </div>
    </div>

    <script>
        (function () {
            var overlay = document.getElementById('videoOverlay');
            var goButton = document.getElementById('videoGo');
            var closeButton = document.getElementById('videoClose');
            var playerClose = document.getElementById('playerClose');
            var playerFs = document.getElementById('playerFs');
            var frame = document.getElementById('videoFrame');
            var fallback = document.getElementById('ytFallback');
            var pendingId = null;
            var pendingTitle = '';
            var pendingScoreStart = -1;
            var pendingScoreLen = 0;
            var pendingProvider = 'dazn';
            var coverTimer = null;
            var landscape = window.matchMedia('(orientation: landscape)');
            var isDesktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
            // iOS (iPhone/iPad) bloquea el autoplay con sonido: hay que arrancar en silencio.
            var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            var calibrating = /[?&]calibrar=1/.test(location.search);

            // ---- CALIBRACIÓN del recuadro que tapa el marcador del título ----
            // En vez de contar letras (la fuente es proporcional), MEDIMOS el ancho real
            // en píxeles del texto que va antes del número, con la misma fuente que YouTube (Roboto).
            // Una calibración independiente por suministrador, en píxeles a pantalla completa:
            //   padLeft  = x donde empieza el texto del título
            //   fontSize = tamaño de fuente del título
            //   top/height = posición y alto del recuadro
            // Dos juegos de calibración: PC (desktop) y móvil (mobile). En móvil el título
            // de YouTube se ve más pequeño y en otra posición, así que necesita sus propios valores.
            // En móvil hay DOS posiciones por suministrador: el móvil en vertical (portrait)
            // y en horizontal (landscape), porque el título de YouTube se ve distinto en cada una.
            var CALS = {
                desktop: {
                    dazn:   { padLeft: 49, fontSize: 21.8, top: 12, height: 27 },
                    rtve:   { padLeft: 56, fontSize: 22.5, top: 12, height: 23 },
                    replay: { padLeft: 69, fontSize: 22.0, top: 12, height: 23 }
                },
                mobile: {
                    portrait: {
                        dazn:   { padLeft: 100, fontSize: 16.1, top: 57, height: 26 },
                        rtve:   { padLeft: 76, fontSize: 18.1, top: 59, height: 26 },
                        replay: { padLeft: 71, fontSize: 19.2, top: 59, height: 25 }
                    },
                    landscape: {
                        dazn:   { padLeft: 84, fontSize: 19.6, top: 13, height: 23 },
                        rtve:   { padLeft: 58, fontSize: 22.4, top: 12, height: 20 },
                        replay: { padLeft: 75, fontSize: 20.2, top: 12, height: 22 }
                    }
                }
            };
            function CAL() {
                if (isDesktop) return CALS.desktop[pendingProvider] || CALS.desktop.dazn;
                var set = CALS.mobile[landscape.matches ? 'landscape' : 'portrait'] || CALS.mobile.portrait;
                return set[pendingProvider] || set.dazn || CALS.desktop.dazn;
            }

            function isFullscreen() {
                return !!(document.fullscreenElement || document.webkitFullscreenElement);
            }

            // Medidor de ancho de texto real con la fuente de YouTube (canvas measureText).
            var _measureCtx = document.createElement('canvas').getContext('2d');
            function measureText(str, fontSize) {
                _measureCtx.font = '500 ' + fontSize + 'px Roboto, Arial, sans-serif';
                return _measureCtx.measureText(str || '').width;
            }
            function titleBefore() { return pendingScoreStart >= 0 ? pendingTitle.slice(0, pendingScoreStart) : ''; }
            function titleScore() { return pendingScoreStart >= 0 ? pendingTitle.slice(pendingScoreStart, pendingScoreStart + pendingScoreLen) : ''; }

            // Al girar el móvil (o cambiar el tamaño), recolocar el recuadro con la calibración
            // que toque (vertical u horizontal). En modo calibrar NO se toca: lo colocas tú.
            function repositionBox() {
                if (calibrating) return;
                if (!overlay.classList.contains('playing')) return;
                var boxEl = document.getElementById('scoreBox');
                if (boxEl && pendingScoreStart >= 0) boxEl.style.cssText = boxStyle();
            }
            if (landscape.addEventListener) {
                landscape.addEventListener('change', repositionBox);
            } else {
                window.addEventListener('orientationchange', repositionBox);
            }
            window.addEventListener('resize', repositionBox);
            // Al entrar/salir de pantalla completa cambia el tamaño del reproductor → recolocar.
            document.addEventListener('fullscreenchange', repositionBox);
            document.addEventListener('webkitfullscreenchange', repositionBox);

            function goFullscreen() {
                var request = frame.requestFullscreen || frame.webkitRequestFullscreen || frame.msRequestFullscreen;
                if (request) { try { request.call(frame); } catch (error) { /* no soportado */ } }
            }


            function boxStyle() {
                // El iPhone no permite pantalla completa real de un contenedor, así que usa el modo
                // "Agrandar" (clase .big). En HORIZONTAL el vídeo llena la pantalla en 16:9 (igual que
                // Android a pantalla completa) y el recuadro fino va bien. En VERTICAL el vídeo queda
                // como una franja pequeña centrada, con otra geometría, y el recuadro se descoloca:
                // por eso en iPhone vertical caemos a la franja entera (más abajo), que tapa seguro.
                var bigIOS = isIOS && overlay.classList.contains('big') && landscape.matches;
                // Si NO está a pantalla completa real NI en "Agrandar" de iPhone (p. ej. incrustado
                // en pequeño en PC), el título se dibuja a un tamaño impredecible → el recuadro fino
                // no es fiable. En ese caso tapamos toda la franja del título a lo ancho.
                if (!isFullscreen() && !bigIOS) {
                    // iPhone vertical (modo Agrandar): el título sale pequeño, así que la franja
                    // puede ser más estrecha. (Si hace falta, ajusta este 30px a tu iPhone.)
                    if (isIOS && overlay.classList.contains('big')) {
                        return 'left:0;top:0;width:100%;height:30px';
                    }
                    // Resto de casos (PC con reproductor pequeño): mínimo 40px y como mucho 3%.
                    return 'left:0;top:0;width:100%;height:max(40px, 3%)';
                }
                // A pantalla completa: recuadro fino y preciso sobre los números (como se calibró).
                var c = CAL();
                // Posición = inicio del título + ancho REAL del texto antes del número.
                // Margen asimétrico: más por la IZQUIERDA, porque el error de medición de la fuente
                // siempre deja asomar el primer número por ese lado. Por la derecha basta un poco.
                // Más margen izquierdo en MÓVIL: el recuadro se calibró en un móvil concreto y en
                // otros móviles (pantalla distinta) el primer número puede asomar por la izquierda.
                var mL = c.fontSize * (isDesktop ? 0.60 : 0.90);
                var mR = c.fontSize * 0.42;
                // iPhone horizontal: sobraba recuadro por la izquierda y quedaba justo por la derecha.
                // Reducimos el margen izquierdo (el borde izquierdo se mete a la derecha) y ampliamos
                // un poco el derecho, sin tocar la calibración de Android.
                if (bigIOS) {
                    mL = c.fontSize * 0.30;
                    mR = c.fontSize * 0.62;
                }
                var left = c.padLeft + measureText(titleBefore(), c.fontSize) - mL;
                var width = measureText(titleScore(), c.fontSize) + mL + mR;
                return 'left:' + left + 'px;top:' + c.top + 'px;width:' + width + 'px;height:' + c.height + 'px';
            }

            // URL del vídeo embebido. 'muted' = arrancar en silencio (necesario en iPhone).
            // hl=es y cc_lang_pref=es: forzar idioma español para que el TÍTULO coincida con el del RSS.
            // fs=0: ocultar el botón de pantalla completa de YouTube (usamos el nuestro).
            function embedSrc(muted) {
                var id = encodeURIComponent(pendingId);
                var mute = muted ? '&mute=1' : '';
                // enablejsapi=1: permite enviar órdenes al reproductor (p. ej. quitar el silencio)
                // SIN recargar el vídeo, para que en iPhone no reaparezca la portada con el resultado.
                return 'https://www.youtube-nocookie.com/embed/' + id +
                    '?autoplay=1' + mute + '&rel=0&modestbranding=1&playsinline=1&hl=es&cc_lang_pref=es&fs=0&enablejsapi=1';
            }

            // En iPhone, el vídeo ya está sonando en silencio. Al tocar el botón le quitamos
            // el mute "al vuelo" mandándole una orden al reproductor (NO recargamos: así no
            // aparece la portada con el resultado).
            function enableSound() {
                var iframe = document.getElementById('ytFrame');
                if (iframe && iframe.contentWindow) {
                    var send = function (func, args) {
                        iframe.contentWindow.postMessage(
                            JSON.stringify({ event: 'command', func: func, args: args || [] }), '*');
                    };
                    send('unMute');
                    send('setVolume', [100]);
                    send('playVideo');
                }
                var btn = document.getElementById('muteHint');
                if (btn) btn.style.display = 'none';
            }

            function play() {
                if (!pendingId) return;
                var id = encodeURIComponent(pendingId);
                // En iPhone arrancamos en silencio (iOS no deja autoplay con sonido).
                var html = '<iframe id="ytFrame" src="' + embedSrc(isIOS) +
                    '" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>';
                if (!calibrating) {
                    html += '<div class="load-cover" id="loadCover">Cargando resumen…</div>';
                }
                if (pendingScoreStart >= 0) {
                    if (calibrating) {
                        html += '<div class="score-box cal" id="scoreBox"><div class="rs-handle" id="rsHandle"></div></div>';
                    } else {
                        html += '<div class="score-box" id="scoreBox" style="' + boxStyle() + '"></div>';
                    }
                }
                if (calibrating) {
                    // Sin capa bloqueante: el ratón llega al reproductor y mantiene visible el título.
                    html += '<div class="cal-readout" id="calReadout">Arrastra el recuadro · esquina = tamaño</div>';
                }
                if (isIOS && !calibrating) {
                    html += '<button type="button" class="mute-hint" id="muteHint">🔊 Toca para activar el sonido</button>';
                }
                frame.innerHTML = html;
                var muteBtn = document.getElementById('muteHint');
                if (muteBtn) muteBtn.addEventListener('click', enableSound);
                fallback.href = 'https://www.youtube.com/watch?v=' + id;
                overlay.classList.add('show');
                overlay.classList.add('playing');
                // En iPhone abrimos el vídeo ya agrandado (iOS no permite pantalla completa real de un div).
                if (isIOS && !calibrating) {
                    overlay.classList.add('big');
                    if (playerFs) playerFs.textContent = '✕ Reducir';
                    setTimeout(repositionBox, 60);
                }
                goFullscreen();
                clearTimeout(coverTimer);
                coverTimer = setTimeout(function () {
                    var cover = document.getElementById('loadCover');
                    if (cover) cover.classList.add('hidden');
                }, 1800);
                if (calibrating && pendingScoreStart >= 0) setupCalibration();
            }

            function setupCalibration() {
                var boxEl = document.getElementById('scoreBox');
                var handleEl = document.getElementById('rsHandle');
                var readout = document.getElementById('calReadout');
                if (!boxEl || !handleEl) return;

                var c = CAL();
                var box = {
                    left: c.padLeft + measureText(titleBefore(), c.fontSize),
                    top: c.top,
                    width: measureText(titleScore(), c.fontSize),
                    height: c.height
                };
                var mode = null, startX = 0, startY = 0, startBox = null;

                function render() {
                    boxEl.style.cssText = 'left:' + box.left + 'px;top:' + box.top +
                        'px;width:' + box.width + 'px;height:' + box.height + 'px';
                }
                // Deriva los valores de la fórmula a partir del recuadro que el usuario ha colocado:
                //   fontSize: el tamaño con el que el ancho medido del marcador coincide con el ancho del recuadro
                //   padLeft : x del recuadro menos el ancho medido del texto anterior (a ese fontSize)
                function showValues() {
                    if (!readout) return;
                    var baseScore = measureText(titleScore(), 100);   // ancho del marcador a 100px de fuente
                    var fontSize = baseScore > 0 ? (box.width * 100 / baseScore) : c.fontSize;
                    var padLeft = box.left - measureText(titleBefore(), fontSize);
                    var plat = isDesktop ? 'PC' : ('MÓVIL ' + (landscape.matches ? 'HORIZONTAL' : 'VERTICAL'));
                    readout.textContent = '[' + pendingProvider.toUpperCase() + ' · ' + plat + ']  fontSize=' + fontSize.toFixed(1) +
                        'px  padLeft=' + padLeft.toFixed(0) + 'px  top=' + box.top.toFixed(0) + 'px  alto=' + box.height.toFixed(0) + 'px';
                }
                function toPx(cx, cy) {
                    var r = frame.getBoundingClientRect();
                    return { x: cx - r.left, y: cy - r.top };
                }
                function start(cx, cy, m) {
                    mode = m;
                    var p = toPx(cx, cy);
                    startX = p.x; startY = p.y;
                    startBox = { left: box.left, top: box.top, width: box.width, height: box.height };
                }
                function moveTo(cx, cy) {
                    if (!mode) return;
                    var p = toPx(cx, cy);
                    var dx = p.x - startX, dy = p.y - startY;
                    if (mode === 'move') {
                        box.left = startBox.left + dx;
                        box.top = startBox.top + dy;
                    } else {
                        box.width = Math.max(6, startBox.width + dx);
                        box.height = Math.max(6, startBox.height + dy);
                    }
                    render();
                    showValues();
                }

                boxEl.addEventListener('mousedown', function (e) { start(e.clientX, e.clientY, 'move'); e.preventDefault(); });
                handleEl.addEventListener('mousedown', function (e) { start(e.clientX, e.clientY, 'resize'); e.stopPropagation(); e.preventDefault(); });
                window.addEventListener('mousemove', function (e) { moveTo(e.clientX, e.clientY); });
                window.addEventListener('mouseup', function () { mode = null; });
                boxEl.addEventListener('touchstart', function (e) { var t = e.touches[0]; start(t.clientX, t.clientY, 'move'); }, { passive: true });
                // stopPropagation: si no, el toque en el tirador "sube" al recuadro y activa 'move' en vez de 'resize'.
                handleEl.addEventListener('touchstart', function (e) { e.stopPropagation(); var t = e.touches[0]; start(t.clientX, t.clientY, 'resize'); }, { passive: true });
                window.addEventListener('touchmove', function (e) { if (mode) { e.preventDefault(); } var t = e.touches[0]; if (t) moveTo(t.clientX, t.clientY); }, { passive: false });
                window.addEventListener('touchend', function () { mode = null; });

                render();
                showValues();
            }

            function closeAll() {
                overlay.classList.remove('show');
                overlay.classList.remove('playing');
                overlay.classList.remove('big');
                if (playerFs && isIOS) playerFs.textContent = '⛶ Agrandar';
                clearTimeout(coverTimer);
                frame.innerHTML = '';
            }

            // Pestañas: al pulsar una, se marca como activa y se muestra su panel.
            document.querySelectorAll('.tab').forEach(function (tab) {
                tab.addEventListener('click', function () {
                    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
                    document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
                    tab.classList.add('active');
                    var panel = document.getElementById('tab-' + tab.getAttribute('data-tab'));
                    if (panel) panel.classList.add('active');
                });
            });

            document.querySelectorAll('.watch[data-video]').forEach(function (element) {
                element.addEventListener('click', function () {
                    pendingId = element.getAttribute('data-video');
                    pendingProvider = element.getAttribute('data-provider') || 'dazn';
                    pendingTitle = element.getAttribute('data-title') || '';
                    pendingScoreStart = parseInt(element.getAttribute('data-score-start'), 10);
                    if (isNaN(pendingScoreStart)) pendingScoreStart = -1;
                    pendingScoreLen = parseInt(element.getAttribute('data-score-len'), 10) || 0;
                    play();   // PC y móvil: abrir el vídeo directamente (sin pop-up de girar)
                });
            });

            goButton.addEventListener('click', function () {
                if (goButton.disabled || !pendingId) return;
                play();
            });

            closeButton.addEventListener('click', closeAll);
            playerClose.addEventListener('click', closeAll);
            // En iPhone/iPad no se puede pantalla completa de un contenedor (solo de vídeo nativo),
            // así que el botón hace "Agrandar": el vídeo llena la pantalla del navegador con CSS,
            // manteniendo la franja que tapa el resultado. En PC/Android, pantalla completa de verdad.
            function toggleBig() {
                overlay.classList.toggle('big');
                playerFs.textContent = overlay.classList.contains('big') ? '✕ Reducir' : '⛶ Agrandar';
                setTimeout(repositionBox, 60);
            }
            if (playerFs) {
                if (isIOS) {
                    playerFs.textContent = '⛶ Agrandar';
                    playerFs.addEventListener('click', toggleBig);
                } else {
                    playerFs.addEventListener('click', goFullscreen);
                }
            }
        })();
    </script>
</body>
</html>`;

// ===========================================================================
//  CACHÉ DE LOS FEEDS DE YOUTUBE
// ---------------------------------------------------------------------------
//  Pedimos los RSS a YouTube como mucho una vez cada CACHE_TTL. Entre medias,
//  todas las visitas reutilizan la última respuesta guardada. Además, si una
//  petición falla, conservamos la última respuesta BUENA de ese suministrador,
//  para que un fallo temporal de YouTube no deje todos los botones en
//  "No disponible" (que es lo que pasó en la franja de las 8:30-9:00).
// ===========================================================================
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos
const feedCache = { dazn: { items: [] }, rtve: { items: [] }, replay: { items: [] } };
let cacheTime = 0;          // momento de la última actualización
let refreshing = null;      // actualización en curso (para no lanzar varias a la vez)

const refreshFeeds = async () => {
    const tryFetch = async (id, key) => {
        try {
            // Con clave de API: lista completa. Sin clave: RSS (máx. 15 vídeos).
            const feed = YOUTUBE_API_KEY ? await fetchPlaylistApi(id) : await parser.parseURL(getRssUrl(id));
            // Solo sobreescribimos si la respuesta es válida. Si falla, dejamos la anterior.
            if (feed && Array.isArray(feed.items)) feedCache[key] = feed;
        } catch (error) {
            console.warn('Aviso: no se pudo actualizar el feed', key, '-', error.message);
        }
    };
    await Promise.all([
        tryFetch(daznPlaylistId, 'dazn'),
        tryFetch(tvePlaylistId, 'rtve'),
        tryFetch(replayPlaylistId, 'replay'),
    ]);
    cacheTime = Date.now();
};

const getFeeds = async () => {
    // Si la caché es reciente, la devolvemos tal cual (sin pedir nada a YouTube).
    if (Date.now() - cacheTime < CACHE_TTL) return feedCache;
    // Si está caducada, refrescamos. Si ya hay un refresco en marcha, esperamos a ese mismo.
    if (!refreshing) {
        refreshing = refreshFeeds().finally(() => { refreshing = null; });
    }
    await refreshing;
    return feedCache;
};

const server = http.createServer(async (req, res) => {
    if (req.url === '/favicon.ico' || req.url === '/favicon') {
        const icon = BALL_ICON || (EMBLEM_SVG ? { data: EMBLEM_SVG, type: 'image/svg+xml; charset=utf-8' } : null);
        if (icon) {
            res.writeHead(200, { 'Content-Type': icon.type, 'Cache-Control': 'public, max-age=86400' });
            res.end(icon.data);
        } else {
            res.writeHead(204);
            res.end();
        }
        return;
    }

    if (req.url === '/emblem.svg') {
        if (EMBLEM_SVG) {
            res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
            res.end(EMBLEM_SVG);
        } else {
            res.writeHead(404);
            res.end();
        }
        return;
    }

    if (req.url === '/replay-logo') {
        if (REPLAY_LOGO) {
            res.writeHead(200, { 'Content-Type': REPLAY_LOGO.type, 'Cache-Control': 'public, max-age=86400' });
            res.end(REPLAY_LOGO.data);
        } else {
            res.writeHead(404);
            res.end();
        }
        return;
    }

    try {
        const feeds = await getFeeds();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buildPage(feeds.dazn, feeds.rtve, feeds.replay));
    } catch (serverError) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('System Failure: ' + serverError.message);
    }
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
