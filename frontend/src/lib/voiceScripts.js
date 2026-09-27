/*
 * Text to Speech languages, and the scripts voice datasets are recorded from.
 *
 * A voice dataset is a script — lines of text, each with an id — and one
 * recording per line (see VoiceDatasetPanel). The built-in scripts are short,
 * varied sentences that cover each language's sounds; people can edit them or
 * paste their own.
 */

// Each language in its own script, as a language picker shows them (Korean as on the OCR page).
export const TTS_LANGUAGE_LABELS = {
  en: 'English', ko: '조선어', ja: '日本語', ar: 'العربية', bg: 'Български', cs: 'Čeština', da: 'Dansk', de: 'Deutsch',
  el: 'Ελληνικά', es: 'Español', et: 'Eesti', fi: 'Suomi', fr: 'Français', hi: 'हिन्दी', hr: 'Hrvatski', hu: 'Magyar',
  id: 'Bahasa Indonesia', it: 'Italiano', lt: 'Lietuvių', lv: 'Latviešu', nl: 'Nederlands', pl: 'Polski', pt: 'Português',
  ro: 'Română', ru: 'Русский', sk: 'Slovenčina', sl: 'Slovenščina', sv: 'Svenska', tr: 'Türkçe', uk: 'Українська',
  vi: 'Tiếng Việt',
};

export const TTS_LANGUAGES = Object.keys(TTS_LANGUAGE_LABELS);

export const languageLabel = (code) => `${TTS_LANGUAGE_LABELS[code] || code} (${code})`;

export const DEFAULT_SCRIPTS = {
  // Mostly Harvard sentences (IEEE 1969, public domain), which are phonetically balanced.
  en: [
    'The birch canoe slid on the smooth planks.',
    'Glue the sheet to the dark blue background.',
    "It's easy to tell the depth of a well.",
    'These days a chicken leg is a rare dish.',
    'Rice is often served in round bowls.',
    'The juice of lemons makes fine punch.',
    'The box was thrown beside the parked truck.',
    'The hogs were fed chopped corn and garbage.',
    'Four hours of steady work faced us.',
    'A large size in stockings is hard to sell.',
    'The boy was there when the sun rose.',
    'A rod is used to catch pink salmon.',
    'The source of the huge river is the clear spring.',
    'Kick the ball straight and follow through.',
    'Help the woman get back to her feet.',
    'A pot of tea helps to pass the evening.',
    'Smoky fires lack flame and heat.',
    'The soft cushion broke the man\'s fall.',
    'Did you remember to lock the front door before you left this morning?',
    'Our quarterly figures look better than expected, but there is still work to do.',
  ],
  ko: [
    '오늘 아침에는 하늘이 맑고 바람이 시원하게 불었습니다.',
    '도서관은 오전 아홉 시에 문을 열고 저녁 여섯 시에 닫습니다.',
    '이 보고서를 금요일까지 꼭 마무리해 주십시오.',
    '강가를 따라 걷다 보면 작은 다리가 하나 보입니다.',
    '우리는 내일 오후에 회의실에서 다시 만나기로 했습니다.',
    '새로 산 책상은 생각보다 훨씬 넓고 튼튼합니다.',
    '겨울이 되면 산 위에 하얀 눈이 쌓입니다.',
    '전화를 받지 못해서 정말 죄송합니다.',
    '시장에서 사과 다섯 개와 배 두 개를 샀습니다.',
    '기차는 정해진 시간보다 십 분 늦게 도착했습니다.',
    '아이들이 운동장에서 즐겁게 공을 차고 있습니다.',
    '이 길을 따라 곧장 가시면 오른쪽에 병원이 있습니다.',
    '따뜻한 차 한 잔이 추운 저녁을 편안하게 해 줍니다.',
    '문을 닫기 전에 창문이 잠겼는지 확인해 주십시오.',
    '올해 농사는 비가 알맞게 내려서 잘되었습니다.',
  ],
  ja: [
    '今朝は空が晴れていて、風がとても気持ちよかったです。',
    '図書館は午前九時に開いて、午後六時に閉まります。',
    'この報告書を金曜日までに仕上げてください。',
    '川沿いを歩いていくと、小さな橋が見えてきます。',
    '明日の午後、会議室でもう一度会うことにしました。',
    '新しく買った机は思ったよりずっと広くて丈夫です。',
    '冬になると、山の上に白い雪が積もります。',
    '電話に出られなくて、本当に申し訳ありません。',
    '市場でりんごを五つと梨を二つ買いました。',
    '電車は予定より十分遅れて到着しました。',
    '子どもたちが校庭で楽しそうにボールを蹴っています。',
    'この道をまっすぐ行くと、右側に病院があります。',
  ],
  es: [
    'Esta mañana el cielo estaba despejado y soplaba una brisa fresca.',
    'La biblioteca abre a las nueve y cierra a las seis de la tarde.',
    'Por favor, termine este informe antes del viernes.',
    'Si camina junto al río, verá un pequeño puente de piedra.',
    'Mañana por la tarde nos volveremos a reunir en la sala de juntas.',
    'El escritorio nuevo es mucho más amplio y firme de lo que esperaba.',
    'En invierno, la nieve blanca cubre la cima de las montañas.',
    'Siento mucho no haber podido contestar su llamada.',
    'En el mercado compré cinco manzanas y dos peras.',
    'El tren llegó diez minutos más tarde de lo previsto.',
    'Los niños juegan alegremente con la pelota en el patio.',
    'Siga todo recto por esta calle y encontrará el hospital a la derecha.',
  ],
  de: [
    'Heute Morgen war der Himmel klar und es wehte ein frischer Wind.',
    'Die Bibliothek öffnet um neun Uhr und schließt um achtzehn Uhr.',
    'Bitte stellen Sie diesen Bericht bis Freitag fertig.',
    'Wenn Sie am Fluss entlanggehen, sehen Sie eine kleine Brücke.',
    'Wir treffen uns morgen Nachmittag noch einmal im Besprechungsraum.',
    'Der neue Schreibtisch ist viel breiter und stabiler als gedacht.',
    'Im Winter liegt weißer Schnee auf den Gipfeln der Berge.',
    'Es tut mir sehr leid, dass ich Ihren Anruf verpasst habe.',
    'Auf dem Markt habe ich fünf Äpfel und zwei Birnen gekauft.',
    'Der Zug kam zehn Minuten später als geplant an.',
    'Die Kinder spielen fröhlich mit dem Ball auf dem Schulhof.',
    'Gehen Sie diese Straße geradeaus, dann ist das Krankenhaus rechts.',
  ],
  fr: [
    'Ce matin, le ciel était dégagé et une brise fraîche soufflait.',
    'La bibliothèque ouvre à neuf heures et ferme à dix-huit heures.',
    'Veuillez terminer ce rapport avant vendredi, s\'il vous plaît.',
    'En longeant la rivière, vous verrez un petit pont de pierre.',
    'Nous nous retrouverons demain après-midi dans la salle de réunion.',
    'Le nouveau bureau est bien plus large et solide que prévu.',
    'En hiver, la neige blanche recouvre le sommet des montagnes.',
    'Je suis vraiment désolé de ne pas avoir pu répondre à votre appel.',
    'Au marché, j\'ai acheté cinq pommes et deux poires.',
    'Le train est arrivé avec dix minutes de retard.',
    'Les enfants jouent joyeusement au ballon dans la cour.',
    'Continuez tout droit dans cette rue, l\'hôpital est sur la droite.',
  ],
  ru: [
    'Сегодня утром небо было ясным, и дул свежий ветер.',
    'Библиотека открывается в девять часов и закрывается в шесть вечера.',
    'Пожалуйста, закончите этот отчёт до пятницы.',
    'Если пойти вдоль реки, вы увидите небольшой каменный мост.',
    'Завтра после обеда мы снова встретимся в переговорной.',
    'Новый письменный стол оказался гораздо шире и крепче, чем я думал.',
    'Зимой вершины гор покрываются белым снегом.',
    'Мне очень жаль, что я не смог ответить на ваш звонок.',
    'На рынке я купил пять яблок и две груши.',
    'Поезд прибыл на десять минут позже расписания.',
    'Дети весело играют с мячом во дворе школы.',
    'Идите прямо по этой улице, и больница будет справа.',
  ],
};

/** A new line id: lowercase letters and digits, as the server requires. */
export const newLineId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Text, one line per sentence, to script lines. Blank lines are dropped. */
export const splitScript = (text) => String(text || '')
  .split(/\r?\n/)
  .map((line) => line.replace(/\s+/g, ' ').trim())
  .filter(Boolean);

/**
 * Edited text back to script lines, keeping the id (and so the recording) of
 * every line whose text is unchanged. Lines are matched by text, in order, so
 * moving or duplicating a sentence does not lose a recording.
 */
export const rebuildScript = (script, text) => {
  const pool = new Map();
  script.forEach((line) => {
    if (!pool.has(line.text)) pool.set(line.text, []);
    pool.get(line.text).push(line.id);
  });
  return splitScript(text).map((line) => ({ id: pool.get(line)?.shift() || newLineId(), text: line }));
};
