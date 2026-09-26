import {
  forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState,
} from 'react';
import { Button, Select, Space, Tooltip, Typography, theme } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { useLanguage } from '../../i18n';

const { Text } = Typography;

/*
 * Two text boxes aligned line by line, the way OCR correction tools pair an
 * image's lines with their text: line N on the left and line N on the right
 * are one pair.
 *
 * Alignment only holds if line N sits at the same height in both boxes, so
 * lines never wrap (long ones scroll sideways), every line is exactly LINE
 * pixels tall, and the two boxes scroll together. The highlighted pair and
 * the gutters are drawn in layers behind and beside each transparent
 * textarea, at positions computed from that fixed line height.
 */

const LINE = 24;
const PAD = 10;
const HEIGHT = 480;
const GUTTER = 48;
const VISIBLE = Math.ceil(HEIGHT / LINE) + 2;

/** Which line (0-based) a character offset falls on. */
const lineAt = (text, offset) => {
  let line = 0;
  for (let index = text.indexOf('\n'); index !== -1 && index < offset; index = text.indexOf('\n', index + 1)) line += 1;
  return line;
};

/** [start, end) character offsets of a line, or null past the last one. */
const lineBounds = (text, line) => {
  let start = 0;
  for (let current = 0; current < line; current += 1) {
    const next = text.indexOf('\n', start);
    if (next === -1) return null;
    start = next + 1;
  }
  const end = text.indexOf('\n', start);
  return [start, end === -1 ? text.length : end];
};

const filled = (line) => Boolean(line && line.trim());

function Pane({
  side, code, text, lines, peerLines, maxLines, range, scroll, textareaRef, header,
  onText, onScroll, onCursor, onKeyDown,
}) {
  const { token } = theme.useToken();
  const first = Math.max(0, Math.floor((scroll - PAD) / LINE));
  const visible = Array.from({ length: VISIBLE }, (_, offset) => first + offset).filter((line) => line < maxLines);
  const bandTop = (line) => PAD + line * LINE - scroll;

  return (
    <div style={{ flex: '1 1 360px', minWidth: 0 }}>
      {header}
      <div
        style={{
          display: 'flex',
          height: HEIGHT,
          border: `1px solid ${token.colorBorder}`,
          borderRadius: token.borderRadiusLG,
          overflow: 'hidden',
          background: token.colorBgContainer,
        }}
      >
        <div
          aria-hidden
          style={{
            width: GUTTER,
            flex: `0 0 ${GUTTER}px`,
            position: 'relative',
            overflow: 'hidden',
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorFillQuaternary,
            color: token.colorTextTertiary,
            fontSize: 12,
            userSelect: 'none',
          }}
        >
          {visible.map((line) => {
            const complete = filled(lines[line]) && filled(peerLines[line]);
            const active = line >= range.start && line <= range.end;
            return (
              <div
                key={line}
                style={{
                  position: 'absolute',
                  top: bandTop(line),
                  height: LINE,
                  lineHeight: `${LINE}px`,
                  right: 8,
                  left: 0,
                  textAlign: 'right',
                  fontWeight: active ? 600 : 400,
                  color: active ? token.colorPrimary : complete ? token.colorTextTertiary : token.colorWarning,
                }}
              >
                {line + 1}
              </div>
            );
          })}
        </div>

        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
            {/* A line empty here but filled on the other side is a missing half of a pair. */}
            {visible
              .filter((line) => !filled(lines[line]) && filled(peerLines[line]))
              .map((line) => (
                <div
                  key={`gap-${line}`}
                  style={{ position: 'absolute', left: 0, right: 0, top: bandTop(line), height: LINE, background: token.colorWarningBg }}
                />
              ))}
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: bandTop(range.start),
                height: (range.end - range.start + 1) * LINE,
                background: token.colorPrimaryBg,
                borderTop: `1px solid ${token.colorPrimaryBorder}`,
                borderBottom: `1px solid ${token.colorPrimaryBorder}`,
              }}
            />
          </div>
          <textarea
            ref={textareaRef}
            value={text}
            wrap="off"
            spellCheck={false}
            lang={code}
            dir="auto"
            data-side={side}
            onChange={(event) => onText(side, event.target.value)}
            onScroll={(event) => onScroll(side, event.currentTarget.scrollTop)}
            onSelect={(event) => onCursor(side, event.currentTarget)}
            onKeyUp={(event) => onCursor(side, event.currentTarget)}
            onMouseUp={(event) => onCursor(side, event.currentTarget)}
            onFocus={(event) => onCursor(side, event.currentTarget)}
            onKeyDown={(event) => onKeyDown(side, event)}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              margin: 0,
              border: 0,
              outline: 'none',
              resize: 'none',
              background: 'transparent',
              color: token.colorText,
              font: 'inherit',
              fontSize: 15,
              lineHeight: `${LINE}px`,
              whiteSpace: 'pre',
              overflowWrap: 'normal',
              overflow: 'auto',
              // The shorter side gets extra room at the bottom, so both boxes
              // can scroll equally far and line N stays level with line N.
              padding: `${PAD}px 12px ${PAD + (maxLines - lines.length) * LINE}px`,
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * @param leftText / rightText   the two columns, one pair per line
 * @param onChange(side, text)   side is 'left' or 'right'
 * @param extraKeys(event)       the editor's own shortcuts (save, …)
 */
const AlignedTextPanes = forwardRef(function AlignedTextPanes({
  leftCode, rightCode, sourceCode, languages, leftText, rightText, onChange, onPickLeft, onPickRight, onSwap, extraKeys,
}, ref) {
  const { t } = useLanguage();
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const [scroll, setScroll] = useState(0);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const pendingFocus = useRef(null);

  const leftLines = leftText.split('\n');
  const rightLines = rightText.split('\n');
  const maxLines = Math.max(leftLines.length, rightLines.length);

  const refFor = (side) => (side === 'left' ? leftRef : rightRef);
  const textFor = (side) => (side === 'left' ? leftText : rightText);

  const onScroll = useCallback((side, top) => {
    setScroll(top);
    const peer = (side === 'left' ? rightRef : leftRef).current;
    if (peer && Math.abs(peer.scrollTop - top) > 1) peer.scrollTop = top;
  }, []);

  const onCursor = useCallback((side, element) => {
    const { value, selectionStart, selectionEnd } = element;
    const start = lineAt(value, selectionStart);
    const end = selectionEnd === selectionStart ? start : lineAt(value, selectionEnd);
    setRange((current) => (current.start === start && current.end === end ? current : { start, end }));
  }, []);

  /** Select a whole line in one box, scrolling it into view. */
  const selectLine = useCallback((side, line) => {
    const element = refFor(side).current;
    if (!element) return;
    const bounds = lineBounds(element.value, line);
    if (!bounds) return;
    element.focus({ preventScroll: true });
    element.setSelectionRange(bounds[0], bounds[1]);
    const top = PAD + line * LINE;
    if (top < element.scrollTop + LINE || top > element.scrollTop + HEIGHT - 3 * LINE) {
      element.scrollTop = Math.max(0, top - HEIGHT / 3);
    }
    setRange({ start: line, end: line });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A focus requested before the text it needs was rendered (the peer box had
  // to grow to reach the line) is applied once that text is in the DOM.
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    selectLine(pending.side, pending.line);
  });

  /** Move to the same line in the other box, growing it if it is shorter. */
  const toPeer = (side, line) => {
    const peer = side === 'left' ? 'right' : 'left';
    const peerText = textFor(peer);
    const missing = line + 1 - peerText.split('\n').length;
    pendingFocus.current = { side: peer, line };
    if (missing > 0) onChange(peer, peerText + '\n'.repeat(missing));
    else setRange((current) => ({ ...current })); // Re-render so the layout effect runs.
  };

  const onKeyDown = (side, event) => {
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      toPeer(side, lineAt(event.currentTarget.value, event.currentTarget.selectionStart));
      return;
    }
    extraKeys?.(event);
  };

  useImperativeHandle(ref, () => ({
    /** Jump to a pair: select the line in `side`, highlighted in both boxes. */
    jumpTo: (line, side = 'left') => {
      const target = refFor(side).current;
      if (target && !lineBounds(target.value, line)) {
        pendingFocus.current = { side, line };
        onChange(side, target.value + '\n'.repeat(line + 1 - target.value.split('\n').length));
        return;
      }
      selectLine(side, line);
    },
    currentLine: () => range.start,
  }));

  const pickerOptions = languages.map((code) => ({ value: code, label: code }));
  const header = (code, onPick, count) => (
    <Space style={{ marginBottom: 8, width: '100%', justifyContent: 'space-between' }} wrap>
      <Space>
        <Select size="small" value={code} onChange={onPick} options={pickerOptions} style={{ minWidth: 96 }} />
        <Text type="secondary">{code === sourceCode ? t('translationSource') : t('translationTarget')}</Text>
      </Space>
      <Text type="secondary">{t('translationLineCount', { count })}</Text>
    </Space>
  );

  const shared = { maxLines, range, scroll, onText: onChange, onScroll, onCursor, onKeyDown };

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <Pane
        {...shared}
        side="left"
        code={leftCode}
        text={leftText}
        lines={leftLines}
        peerLines={rightLines}
        textareaRef={leftRef}
        header={header(leftCode, onPickLeft, leftLines.length)}
      />
      <Tooltip title={t('translationSwapSides')}>
        <Button icon={<SwapOutlined />} onClick={onSwap} style={{ marginTop: 40 + HEIGHT / 2 - 16 }} />
      </Tooltip>
      <Pane
        {...shared}
        side="right"
        code={rightCode}
        text={rightText}
        lines={rightLines}
        peerLines={leftLines}
        textareaRef={rightRef}
        header={header(rightCode, onPickRight, rightLines.length)}
      />
    </div>
  );
});

export default AlignedTextPanes;
