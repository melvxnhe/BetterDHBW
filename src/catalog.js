// The list of courses: what a course code means, and every course grouped
// for the homepage. Build only: the page ships the finished list as JSON
// (see build.mjs), so none of this reaches the browser.

const FACULTY = { W: 'Wirtschaft', T: 'Technik', G: 'Gesundheit', S: 'Sozialwesen', I: 'International' };
const FACULTY_ORDER = ['W', 'T', 'G', 'S', 'I'];

// Studienrichtungen behind the letters after the year, as the DHBW Mannheim
// names them. Only codes with a known meaning; the rest show the degree alone.
const TRACKS = {
  WWI: { SE: 'Software Engineering', SC: 'Sales & Consulting', AM: 'Application Management', DS: 'Data Science',
    IMBIT: 'International Management for Business and Information Technology', EG: 'E-Government', DH: 'Digital Health', EH: 'E-Health' },
  TINF: { CS: 'Cyber Security', IT: 'Informationstechnik', AI: 'Angewandte Informatik' },
};

// ---------- reading a course code: "WWI26SEA" is programme WWI, intake 26, track SE, course A ----------

const yearOf = (name) => (name.match(/\d{2}/) || [''])[0];
const programOf = (name) => (name.match(/^([A-Z]+?)\d{2}/) || [])[1];

// "WWI26SEA" → "Software Engineering", or '' for codes without a known track
function trackOf(name) {
  const [, program = '', , rest = ''] = name.match(/^([A-Z]+?)(\d{2})(.*)$/) || [];
  const tracks = TRACKS[program] || {};
  const longestFirst = Object.keys(tracks).sort((a, b) => b.length - a.length);
  const known = rest.split('-').map((part) => {
    const key = longestFirst.find((k) => part.startsWith(k) && /^(?:[A-E]|\d)?$/.test(part.slice(k.length)));
    return key && tracks[key];
  }).filter(Boolean);
  return [...new Set(known)].join(' & ');
}

// "WWI26SEA" → "Wirtschaftsinformatik – Software Engineering 26"
function fullName(name, degree, track) {
  if (!degree) return '';
  const year = yearOf(name);
  return `${degree}${track ? ` – ${track}` : ''}${year ? ` ${year}` : ''}`;
}

// adds value to the list under key, starting the list if it's the first
function collect(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

// ---------- every course ----------

// "MA-WWI26SEA" and "MA---WWI26SEA" are the same course in two Rapla
// generations; the list keeps one name with every id, the older id first.
// `parsed` is api.dhbw.app's /courses/MA/parsed: the degree of each course.
export function courseList(ids, parsed = []) {
  const info = new Map(), byProgram = new Map();
  for (const c of parsed) {
    if (!c?.degree) continue;
    info.set(String(c.name).replace(/^MA-+/, ''), c);
    byProgram.set(c.degree.abbreviation, c); // for courses only listed under their old id
  }
  const byName = new Map();
  for (const id of ids) {
    if (/^MA-+[A-Z]/.test(id)) collect(byName, id.replace(/^MA-+/, ''), id);
  }
  return [...byName].map(([name, list]) => {
    const year = yearOf(name);
    const meta = [FACULTY[name[0]], year ? `Jahrgang 20${year}` : ''].filter(Boolean).join(' · ');
    const degree = (info.get(name) || byProgram.get(programOf(name)))?.degree?.name?.trim().replace(/\s+-\s+/g, ' – ').replace(/\s+/g, ' ') || '';
    const track = degree ? trackOf(name) : '';
    return { name, meta, degree, track, full: fullName(name, degree, track), ids: list.sort((a, b) => a.length - b.length) };
  }).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

// ---------- the directory on the homepage ----------

// Every course, grouped faculty → programme code → intake year, newest first.
export function directory(courses) {
  const faculties = new Map();
  for (const c of courses) {
    const f = c.name[0];
    if (!faculties.has(f)) faculties.set(f, new Map());
    collect(faculties.get(f), programOf(c.name) || c.name, c);
  }
  return [...faculties]
    .sort((a, b) => FACULTY_ORDER.indexOf(a[0]) - FACULTY_ORDER.indexOf(b[0]))
    .map(([f, programs]) => ({
      id: f,
      name: FACULTY[f] || f,
      count: [...programs.values()].reduce((n, l) => n + l.length, 0),
      programs: [...programs].map(([code, list]) => {
        const years = new Map();
        list.forEach((c) => collect(years, yearOf(c.name), c));
        return {
          code, count: list.length, degree: (list.find((c) => c.degree) || {}).degree || '',
          years: [...years].sort((a, b) => b[0].localeCompare(a[0]))
            .map(([y, inYear]) => ({ year: y ? `20${y}` : '', courses: inYear.sort((a, b) => a.name.localeCompare(b.name)) })),
        };
      }).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    }));
}
