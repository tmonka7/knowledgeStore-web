/*
 * Speech to Command: the languages Moonshine has models for, and starter
 * command sets. A command set is a list of commands, each with the phrases
 * that say it; people edit these or start from an empty set.
 */

// Moonshine models exist for these (download_models.py moonshine-tiny[-<code>]).
// Korean as on the OCR page.
export const COMMAND_LANGUAGES = [
  ['en', 'English'], ['ko', '조선어'], ['ja', '日本語'], ['zh', '中文'], ['ar', 'العربية'], ['uk', 'Українська'],
  ['vi', 'Tiếng Việt'],
];

export const commandLanguageLabel = (code) => {
  const found = COMMAND_LANGUAGES.find(([value]) => value === code);
  return found ? `${found[1]} (${code})` : code;
};

/** The download_models.py name of the tiny Moonshine model for a language. */
export const moonshineFor = (code) => (code === 'en' ? 'moonshine-tiny' : `moonshine-tiny-${code}`);

const set = (rows) => rows.map(([id, name, phrases]) => ({ id, name, phrases }));

export const STARTER_SETS = {
  en: set([
    ['lights-on', 'Lights on', ['turn on the lights', 'lights on']],
    ['lights-off', 'Lights off', ['turn off the lights', 'lights off']],
    ['open', 'Open', ['open the door', 'open']],
    ['close', 'Close', ['close the door', 'close']],
    ['start', 'Start', ['start', 'begin']],
    ['stop', 'Stop', ['stop', 'halt']],
    ['up', 'Volume up', ['volume up', 'louder']],
    ['down', 'Volume down', ['volume down', 'quieter']],
    ['yes', 'Yes', ['yes', 'confirm']],
    ['no', 'No', ['no', 'cancel']],
  ]),
  ko: set([
    ['lights-on', '불 켜기', ['불 켜', '불 켜 줘']],
    ['lights-off', '불 끄기', ['불 꺼', '불 꺼 줘']],
    ['open', '열기', ['문 열어', '열어 줘']],
    ['close', '닫기', ['문 닫아', '닫아 줘']],
    ['start', '시작', ['시작', '시작해']],
    ['stop', '정지', ['멈춰', '정지']],
    ['up', '소리 크게', ['소리 크게', '볼륨 올려']],
    ['down', '소리 작게', ['소리 작게', '볼륨 내려']],
    ['yes', '예', ['예', '확인']],
    ['no', '아니오', ['아니오', '취소']],
  ]),
  ja: set([
    ['lights-on', '電気をつける', ['電気をつけて', '電気オン']],
    ['lights-off', '電気を消す', ['電気を消して', '電気オフ']],
    ['open', '開ける', ['ドアを開けて', '開けて']],
    ['close', '閉める', ['ドアを閉めて', '閉めて']],
    ['start', '開始', ['開始', 'スタート']],
    ['stop', '停止', ['止めて', 'ストップ']],
    ['up', '音量を上げる', ['音量を上げて', '大きく']],
    ['down', '音量を下げる', ['音量を下げて', '小さく']],
    ['yes', 'はい', ['はい', '確認']],
    ['no', 'いいえ', ['いいえ', 'キャンセル']],
  ]),
  zh: set([
    ['lights-on', '开灯', ['开灯', '打开灯']],
    ['lights-off', '关灯', ['关灯', '关掉灯']],
    ['open', '打开', ['开门', '打开']],
    ['close', '关闭', ['关门', '关闭']],
    ['start', '开始', ['开始', '启动']],
    ['stop', '停止', ['停止', '停下']],
    ['up', '音量加大', ['大声一点', '音量加大']],
    ['down', '音量减小', ['小声一点', '音量减小']],
    ['yes', '是', ['是', '确认']],
    ['no', '否', ['不是', '取消']],
  ]),
};

/** A new command id: letters, digits, dashes, as the server requires. */
export const newCommandId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Phrases typed one per line, cleaned and de-duplicated. */
export const splitPhrases = (text) => [...new Set(String(text || '')
  .split(/\r?\n/)
  .map((line) => line.replace(/\s+/g, ' ').trim())
  .filter(Boolean))];
