const http = require('http');
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');

const parser = new Parser({
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

const daznPlaylistId = 'PL8vYHFKv-YcqjDmrVZm-AghTsjCaMNNwi';
const tvePlaylistId = 'PLhEMBJiEYKv5FvOHB49kE5-dCMHzZHuKa';
const PORT = process.env.PORT || 3000;

const getRssUrl = (playlistId) => `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;

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
    { date: '2026-06-14', time: '06:00', home: 'Australia', away: 'Turquía' },
    { date: '2026-06-13', time: '21:00', home: 'Catar', away: 'Suiza' },
    { date: '2026-06-14', time: '00:00', home: 'Brasil', away: 'Marruecos' },
    { date: '2026-06-14', time: '03:00', home: 'Haití', away: 'Escocia' },
    { date: '2026-06-14', time: '19:00', home: 'Alemania', away: 'Curazao' },
    { date: '2026-06-15', time: '00:00', home: 'Países Bajos', away: 'Japón' },
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
    { date: '2026-06-19', time: '06:00', home: 'Turquía', away: 'Paraguay' },
    { date: '2026-06-19', time: '21:00', home: 'Estados Unidos', away: 'Australia' },
    { date: '2026-06-20', time: '00:00', home: 'Brasil', away: 'Haití' },
    { date: '2026-06-20', time: '03:00', home: 'Escocia', away: 'Marruecos' },
    { date: '2026-06-20', time: '06:00', home: 'Túnez', away: 'Japón' },
    { date: '2026-06-20', time: '19:00', home: 'Países Bajos', away: 'Suecia' },
    { date: '2026-06-21', time: '00:00', home: 'Alemania', away: 'Costa de Marfil' },
    { date: '2026-06-21', time: '02:00', home: 'Ecuador', away: 'Curazao' },
    { date: '2026-06-21', time: '18:00', home: 'España', away: 'Arabia Saudí' },
    { date: '2026-06-22', time: '00:00', home: 'Uruguay', away: 'Cabo Verde' },
    { date: '2026-06-22', time: '01:00', home: 'Bélgica', away: 'Irán' },
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
    { date: '2026-06-25', time: '03:00', home: 'República Checa', away: 'México' },
    { date: '2026-06-25', time: '03:00', home: 'Sudáfrica', away: 'Corea del Sur' },
    { date: '2026-06-26', time: '00:00', home: 'Escocia', away: 'Brasil' },
    { date: '2026-06-26', time: '00:00', home: 'Marruecos', away: 'Haití' },
    { date: '2026-06-26', time: '00:00', home: 'Ecuador', away: 'Alemania' },
    { date: '2026-06-26', time: '00:00', home: 'Curazao', away: 'Costa de Marfil' },
    { date: '2026-06-26', time: '01:00', home: 'Túnez', away: 'Países Bajos' },
    { date: '2026-06-26', time: '01:00', home: 'Japón', away: 'Suecia' },
    { date: '2026-06-26', time: '04:00', home: 'Turquía', away: 'Estados Unidos' },
    { date: '2026-06-26', time: '04:00', home: 'Paraguay', away: 'Australia' },
    { date: '2026-06-26', time: '21:00', home: 'Noruega', away: 'Francia' },
    { date: '2026-06-26', time: '21:00', home: 'Senegal', away: 'Irak' },
    { date: '2026-06-27', time: '02:00', home: 'Uruguay', away: 'España' },
    { date: '2026-06-27', time: '02:00', home: 'Cabo Verde', away: 'Arabia Saudí' },
    { date: '2026-06-27', time: '05:00', home: 'Nueva Zelanda', away: 'Bélgica' },
    { date: '2026-06-27', time: '05:00', home: 'Egipto', away: 'Irán' },
    { date: '2026-06-27', time: '23:00', home: 'Panamá', away: 'Inglaterra' },
    { date: '2026-06-27', time: '23:00', home: 'Croacia', away: 'Ghana' },
    { date: '2026-06-28', time: '01:30', home: 'Portugal', away: 'Colombia' },
    { date: '2026-06-28', time: '01:30', home: 'RD Congo', away: 'Uzbekistán' },
    { date: '2026-06-28', time: '04:00', home: 'Argentina', away: 'Jordania' },
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

const formatViews = (views) => {
    const number = Number(views);
    if (!Number.isFinite(number) || number <= 0) return '';
    if (number >= 1000000) return (number / 1000000).toFixed(1).replace('.0', '') + ' M visualizaciones';
    if (number >= 1000) return Math.round(number / 1000) + ' mil visualizaciones';
    return number + ' visualizaciones';
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
    return {
        source, teams, link: item.link, videoId: (item.id || '').split(':').pop(),
        thumbnail, views,
        date: new Date(item.isoDate),
        matchKey: matchKeyOf(teams),
    };
};

const escapeHtml = (text) =>
    String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const flagImg = (team) =>
    `<img class="flag" src="https://flagcdn.com/w80/${team.iso}.png" srcset="https://flagcdn.com/w160/${team.iso}.png 2x" width="44" height="33" alt="${escapeHtml(team.name)}" loading="lazy">`;

const renderButton = (entry, symbolId, brandClass) => {
    const logo = `<svg class="brand ${brandClass}" aria-hidden="true"><use href="#${symbolId}"></use></svg>`;
    if (entry) {
        return `<button class="watch ${brandClass}" data-video="${escapeHtml(entry.videoId)}">${logo}<span class="cap">Ver resumen ▶</span></button>`;
    }
    return `<button class="watch ${brandClass} disabled" disabled>${logo}<span class="cap">No disponible</span></button>`;
};

const renderMatchCard = (match) => {
    const [home, away] = match.teams;
    const reference = match.rtve || match.dazn;
    const views = reference ? formatViews(reference.views) : '';
    const thumbnail = reference && reference.thumbnail ? reference.thumbnail : '';

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
                ${views ? `<div class="views">👁️ ${views}</div>` : ''}
                <div class="buttons">
                    ${renderButton(match.dazn, 'logo-dazn', 'dazn')}
                    ${renderButton(match.rtve, 'logo-rtve', 'rtve')}
                </div>
            </div>
        </article>`;
};

const buildPage = (daznFeed, tveFeed) => {
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
                time: '', sortTime: entry.date,
            });
        }
        matches.get(entry.matchKey)[source] = entry;
    };
    tveFeed.items.forEach((item) => addVideo(item, 'rtve'));
    daznFeed.items.forEach((item) => addVideo(item, 'dazn'));

    // 3) Group by day (newest day first), matches sorted by kickoff time.
    const days = new Map();
    for (const match of matches.values()) {
        if (!days.has(match.dateKey)) days.set(match.dateKey, []);
        days.get(match.dateKey).push(match);
    }

    const today = dateKeyMadrid(new Date());

    const renderDay = (dateKey, heading) => {
        const items = days.get(dateKey).sort((a, b) => a.sortTime - b.sortTime);
        return `<section class="day"><h2>${heading}</h2>${items.map(renderMatchCard).join('')}</section>`;
    };

    // Main view: today and all previous days (most recent first).
    const mainSections = [...days.keys()]
        .filter((dateKey) => dateKey <= today)
        .sort((a, b) => b.localeCompare(a))
        .map((dateKey) => renderDay(dateKey, dateKey === today ? 'Hoy' : prettyDate(dateKey)))
        .join('');

    // Upcoming days go into a collapsible calendar (chronological).
    const restSections = [...days.keys()]
        .filter((dateKey) => dateKey > today)
        .sort((a, b) => a.localeCompare(b))
        .map((dateKey) => renderDay(dateKey, prettyDate(dateKey)))
        .join('');

    const calendar = restSections
        ? `<details class="calendar"><summary>📅 Ver próximos partidos (calendario completo)</summary>${restSections}</details>`
        : '';

    const content = (mainSections + calendar) || '<p class="empty">No hay partidos ahora mismo.</p>';
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
</svg>`;

const PAGE_TEMPLATE = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Mundial 2026 · Resúmenes sin spoilers</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700;900&display=swap" rel="stylesheet">
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
        header .host {
            margin-top: 10px; font-family: 'Orbitron', sans-serif; font-size: .72rem; font-weight: 700; letter-spacing: 4px;
        }
        header .host .ca { color: var(--ca); } header .host .us { color: var(--us); } header .host .mx { color: var(--mx); }
        header .host span { margin: 0 5px; color: #c2c7d6; }
        header .note {
            margin: 16px auto 0; max-width: 400px; font-size: .72rem; color: var(--muted); line-height: 1.7;
            text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;
        }
        .day { max-width: 540px; margin: 0 auto; }
        .day h2 {
            font-size: .95rem; color: var(--us); text-transform: uppercase; letter-spacing: 1.2px;
            margin: 26px 0 12px; padding-left: 10px; border-left: 4px solid var(--gold);
        }
        .dots {
            height: 8px; border-radius: 999px; max-width: 540px; margin: 32px auto 0; opacity: .9;
            background: repeating-linear-gradient(90deg, var(--ca) 0 14px, var(--us) 14px 28px, var(--mx) 28px 42px);
        }
        .card {
            background: var(--card); border: 1px solid var(--line); border-radius: 18px;
            overflow: hidden; margin-bottom: 14px; box-shadow: 0 8px 24px rgba(20,30,60,.07);
        }
        .banner {
            position: relative; height: 70px; background-size: cover; background-position: center;
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
        .body { padding: 16px 16px 18px; }
        .teams { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .team { display: flex; flex-direction: column; align-items: center; flex: 1; gap: 8px; }
        .flag {
            width: 44px; height: 33px; object-fit: cover; border-radius: 5px;
            box-shadow: 0 1px 4px rgba(0,0,0,.18); background: #f0f0f0;
        }
        .team .name { font-size: .92rem; font-weight: 700; text-align: center; line-height: 1.2; }
        .vs { font-size: .82rem; font-weight: 900; color: var(--gold); padding: 0 6px; letter-spacing: 1px; }
        .views { text-align: center; color: var(--muted); font-size: .76rem; margin-top: 12px; }
        .buttons { display: flex; gap: 10px; margin-top: 16px; }
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
        .player .player-close {
            display: block; margin: 0 0 10px auto; background: rgba(255,255,255,.16); color: #fff;
            border: none; border-radius: 8px; padding: 8px 14px; font-weight: 700; cursor: pointer;
        }
        .player .frame {
            position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000;
            border-radius: 10px; overflow: hidden;
        }
        .player .frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
        .player .frame .title-mask {
            position: absolute; top: 0; left: 0; right: 0; height: 6%; z-index: 2; pointer-events: none;
            background: linear-gradient(to bottom, #000 0%, #000 70%, rgba(0,0,0,0) 100%);
        }
        @media (pointer: coarse) {
            .player .frame .title-mask { height: 9%; }
        }
        .player .frame .load-cover {
            position: absolute; inset: 0; z-index: 3; display: flex; align-items: center; justify-content: center;
            background: #000; color: #fff; font-weight: 700; letter-spacing: .5px; font-size: .9rem;
            transition: opacity .4s ease;
        }
        .player .frame .load-cover.hidden { opacity: 0; pointer-events: none; }
        .player .yt-fallback { display: block; margin-top: 12px; color: #cdd3e6; font-size: .8rem; text-decoration: underline; text-align: center; }
        .watch {
            flex: 1; display: flex; flex-direction: column; align-items: center; gap: 7px;
            border: 1.5px solid var(--line); border-radius: 14px; padding: 12px 8px; cursor: pointer;
            background: #fff; transition: transform .08s, box-shadow .15s;
        }
        .watch:active { transform: scale(.97); }
        .watch .brand { display: block; }
        .watch .brand.logo-rtve, .brand.rtve { height: 20px; width: 39px; }
        .watch .brand.logo-dazn, .brand.dazn { height: 26px; width: 26px; border-radius: 4px; }
        .watch .cap { font-size: .74rem; font-weight: 700; }
        .watch.rtve { box-shadow: inset 0 0 0 0 var(--rtve); }
        .watch.rtve .cap { color: var(--rtve); }
        .watch.rtve:not(.disabled) { border-color: rgba(230,81,31,.45); background: #fff7f2; }
        .watch.dazn .cap { color: var(--dazn); }
        .watch.dazn:not(.disabled) { border-color: rgba(17,17,17,.30); background: #f6f7f9; }
        .watch.disabled { cursor: default; opacity: .45; background: #f5f6f9; }
        .watch.disabled .cap { color: var(--muted); }
        .calendar { max-width: 540px; margin: 18px auto 0; }
        .calendar > summary {
            list-style: none; cursor: pointer; text-align: center; font-weight: 800; font-size: .9rem;
            color: var(--us); background: #fff; border: 1.5px solid var(--line); border-radius: 14px;
            padding: 15px; box-shadow: 0 6px 18px rgba(20,30,60,.06); user-select: none;
        }
        .calendar > summary::-webkit-details-marker { display: none; }
        .calendar[open] > summary { margin-bottom: 4px; }
        .empty { text-align: center; color: var(--muted); margin-top: 40px; }
        footer { text-align: center; color: var(--muted); font-size: .72rem; margin-top: 36px; }
    </style>
</head>
<body>
    <div class="flagbar"></div>
    ${LOGO_DEFS}

    <header>
        <img class="emblem" src="/emblem.svg" alt="FIFA World Cup 2026" width="63" height="98">
        <h1>World Cup 2026</h1>
        <div class="host"><span class="ca">CANADÁ</span><span>·</span><span class="us">USA</span><span>·</span><span class="mx">MÉXICO</span></div>
        <div class="note">Resúmenes sin spoilers (sin mostrar el resultado).<br>Narración en español de España (DAZN o RTVE).</div>
    </header>

    <main><!--CONTENT--></main>

    <div class="dots"></div>
    <footer>Sin marcadores: las miniaturas van difuminadas para no desvelar el resultado.</footer>

    <div id="videoOverlay">
        <div class="box">
            <div class="icon">📱</div>
            <p class="title">Gira el móvil en horizontal</p>
            <p class="sub">Para ver el resumen, pon el móvil en posición horizontal y se activará el botón.</p>
            <button class="go disabled" id="videoGo" disabled>Gira el móvil para activar</button>
            <button class="close" id="videoClose">Cancelar</button>
        </div>
        <div class="player">
            <button class="player-close" id="playerClose">✕ Cerrar</button>
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
            var frame = document.getElementById('videoFrame');
            var fallback = document.getElementById('ytFallback');
            var pendingId = null;
            var coverTimer = null;
            var landscape = window.matchMedia('(orientation: landscape)');
            var isDesktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

            function sync() {
                if (landscape.matches) {
                    goButton.disabled = false;
                    goButton.classList.remove('disabled');
                    goButton.textContent = 'Ver el vídeo ▶';
                } else {
                    goButton.disabled = true;
                    goButton.classList.add('disabled');
                    goButton.textContent = 'Gira el móvil para activar';
                }
            }
            if (landscape.addEventListener) {
                landscape.addEventListener('change', sync);
            } else {
                window.addEventListener('orientationchange', sync);
            }
            window.addEventListener('resize', sync);

            function goFullscreen() {
                var request = frame.requestFullscreen || frame.webkitRequestFullscreen || frame.msRequestFullscreen;
                if (request) { try { request.call(frame); } catch (error) { /* no soportado */ } }
            }

            function play() {
                if (!pendingId) return;
                var id = encodeURIComponent(pendingId);
                frame.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + id +
                    '?autoplay=1&rel=0&modestbranding=1&playsinline=1" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>' +
                    '<div class="title-mask"></div>' +
                    '<div class="load-cover" id="loadCover">Cargando resumen…</div>';
                fallback.href = 'https://www.youtube.com/watch?v=' + id;
                overlay.classList.add('show');
                overlay.classList.add('playing');
                goFullscreen();
                clearTimeout(coverTimer);
                coverTimer = setTimeout(function () {
                    var cover = document.getElementById('loadCover');
                    if (cover) cover.classList.add('hidden');
                }, 1800);
            }

            function closeAll() {
                overlay.classList.remove('show');
                overlay.classList.remove('playing');
                clearTimeout(coverTimer);
                frame.innerHTML = '';
            }

            document.querySelectorAll('.watch[data-video]').forEach(function (element) {
                element.addEventListener('click', function () {
                    pendingId = element.getAttribute('data-video');
                    if (isDesktop) {
                        play();                          // en PC: abrir el vídeo directamente
                    } else {
                        overlay.classList.remove('playing');
                        sync();
                        overlay.classList.add('show');   // en móvil: pop-up para girar
                    }
                });
            });

            goButton.addEventListener('click', function () {
                if (goButton.disabled || !pendingId) return;
                play();
            });

            closeButton.addEventListener('click', closeAll);
            playerClose.addEventListener('click', closeAll);
        })();
    </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
    if (req.url === '/favicon.ico') {
        res.writeHead(204);
        res.end();
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

    try {
        const [daznFeed, tveFeed] = await Promise.all([
            parser.parseURL(getRssUrl(daznPlaylistId)),
            parser.parseURL(getRssUrl(tvePlaylistId)),
        ]);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buildPage(daznFeed, tveFeed));
    } catch (serverError) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('System Failure: ' + serverError.message);
    }
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
