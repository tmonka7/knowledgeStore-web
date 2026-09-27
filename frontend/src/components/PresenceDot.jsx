import { Tooltip } from 'antd';
import { useLanguage } from '../i18n';
import { PRESENCE_COLORS } from '../lib/presence';

const STATE_KEYS = {
  online: 'presenceOnline', away: 'presenceAway', busy: 'presenceBusy', offline: 'presenceOffline',
};

/** "5 minutes ago", in the page's language, for a last-seen time. */
export const useSince = () => {
  const { t, language } = useLanguage();
  const locale = language === 'jp' ? 'ja' : language;
  return (value) => {
    if (!value) return '';
    const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
    if (seconds < 60) return t('presenceJustNow');
    const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (seconds < 3600) return format.format(-Math.round(seconds / 60), 'minute');
    if (seconds < 86400) return format.format(-Math.round(seconds / 3600), 'hour');
    if (seconds < 86400 * 30) return format.format(-Math.round(seconds / 86400), 'day');
    return new Date(value).toLocaleDateString(locale, { dateStyle: 'medium' });
  };
};

/** The words for a connection status: "Online", or "Offline · 5 minutes ago". */
export const usePresenceLabel = () => {
  const { t } = useLanguage();
  const since = useSince();
  return (presence) => {
    const state = presence?.state || 'offline';
    const label = t(STATE_KEYS[state]);
    return state === 'offline' && presence?.lastSeenAt ? `${label} · ${since(presence.lastSeenAt)}` : label;
  };
};

/**
 * A coloured dot for a connection status — green online, amber away, red
 * busy, grey offline — with the status in words on hover. `ring` draws a
 * white edge, for a dot laid over an avatar.
 */
export default function PresenceDot({ presence, size = 10, ring = false, style }) {
  const label = usePresenceLabel();
  const state = presence?.state || 'offline';
  return (
    <Tooltip title={label(presence)}>
      <span
        className="presence-dot"
        role="img"
        aria-label={label(presence)}
        style={{
          display: 'inline-block',
          width: size,
          height: size,
          borderRadius: '50%',
          background: PRESENCE_COLORS[state],
          boxShadow: ring ? '0 0 0 2px #fff' : undefined,
          flex: 'none',
          ...style,
        }}
      />
    </Tooltip>
  );
}
