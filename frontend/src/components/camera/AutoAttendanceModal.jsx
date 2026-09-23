import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Progress, Select, Slider, Tag, Tooltip } from 'antd';
import {
  CameraOutlined,
  CheckCircleFilled,
  QuestionCircleFilled,
  ScanOutlined,
  StopOutlined,
} from '@ant-design/icons';
import useAttendanceSweep from './useAttendanceSweep';
import { useLanguage } from '../../i18n';

/*
 * The automatic attendance dialog.
 *
 * It shows the frame the camera is currently looking at, with a box round
 * every face found in it, and the list of people building up underneath. That
 * live frame is not decoration: a sweep that finds nobody is either an empty
 * room or a camera pointing at a wall, and those look identical in a list of
 * results. Seeing what the camera saw is how an operator tells them apart.
 */
export default function AutoAttendanceModal({ open, camera, onClose, onFinished }) {
  const { t } = useLanguage();
  const [zoom, setZoom] = useState(0);
  const [arc, setArc] = useState(180);

  const sweep = useAttendanceSweep({ camera, onFinished });
  const { phase, session, stopIndex, people, notes, frameUrl, boxes, error, running } = sweep;

  /*
   * Closing clears the sweep, so reopening starts on the setup screen rather
   * than showing the previous room's attendance list as though it were this
   * one's. The results are not lost by this — they are on the server, and the
   * Attendance page lists every sweep.
   *
   * `sweep` is a fresh object every render and is deliberately not a
   * dependency; `reset` is stable and `open` is the only thing this reacts to.
   */
  useEffect(() => {
    if (!open) sweep.reset();
  }, [open, sweep.reset]);

  const total = session?.stops?.length || 0;
  const done = phase === 'done' || phase === 'cancelled';
  const percent = total ? Math.round(((stopIndex + (done ? 1 : 0)) / total) * 100) : 0;

  const known = people.filter((person) => person.outcome === 'user');
  const strangers = people.filter((person) => person.outcome !== 'user');

  const close = () => {
    if (running) sweep.stop();
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={close}
      footer={null}
      width={920}
      centered
      maskClosable={!running}
      className="attendance-modal"
      title={(
        <div className="face-modal-title">
          <h3>{t('automaticAttendance')}</h3>
          <p>{t('automaticAttendanceHint', { name: camera?.name || '' })}</p>
        </div>
      )}
    >
      {phase === 'idle' && (
        <div className="attendance-setup">
          <label className="attendance-field">
            <span>{t('attendanceArc')}</span>
            <Select
              value={arc}
              onChange={setArc}
              options={[
                { value: 90, label: t('attendanceArc90') },
                { value: 180, label: t('attendanceArc180') },
                { value: 360, label: t('attendanceArc360') },
              ]}
            />
          </label>

          <label className="attendance-field">
            <span>{t('attendanceZoom')}</span>
            <Slider min={0} max={1} step={0.05} value={zoom} onChange={setZoom} tooltip={{ open: false }} />
            <small>{t('attendanceZoomHint')}</small>
          </label>

          <Button
            type="primary"
            size="large"
            className="vision-btn-primary"
            icon={<ScanOutlined />}
            onClick={() => sweep.start({ zoom, arcDegrees: arc })}
          >
            {t('startAttendanceSweep')}
          </Button>
        </div>
      )}

      {phase !== 'idle' && (
        <>
          <div className="attendance-progress">
            <Progress percent={percent} status={phase === 'error' ? 'exception' : undefined} />
            <span>
              {running
                ? t('attendanceScanning', { current: stopIndex + 1, total })
                : t('attendanceSweepFinished', { total })}
            </span>
            {running && (
              <Button danger icon={<StopOutlined />} onClick={sweep.stop}>{t('stop')}</Button>
            )}
          </div>

          <div className="attendance-stage">
            {frameUrl ? (
              /*
               * The boxes are positioned as percentages, so their container
               * must be the PICTURE and not the stage. A stage with a fixed
               * aspect ratio letterboxes any camera that is not the same
               * shape, and every box then sits off the face by the height of
               * the black bars — on the one view whose entire purpose is
               * showing that the boxes are on the right people.
               */
              <div className="attendance-frame">
                <img src={frameUrl} alt={t('cameraFrame')} />
                {boxes.map((box, index) => (
                  <span
                    key={`${box.x}-${box.y}-${index}`}
                    className="attendance-face-box"
                    style={{
                      left: `${box.x * 100}%`,
                      top: `${box.y * 100}%`,
                      width: `${box.width * 100}%`,
                      height: `${box.height * 100}%`,
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="vision-live-unavailable">
                <CameraOutlined />
                <span>{t('attendanceWaitingForFrame')}</span>
              </div>
            )}
          </div>

          {error && <Alert type="error" showIcon className="face-modal-alert" message={error} />}

          {notes.map((item) => (
            <Alert key={item.id} type={item.tone} showIcon className="face-modal-alert" message={item.text} />
          ))}

          {done && session && !session.completeCoverage && (
            <Alert
              type="warning"
              showIcon
              className="face-modal-alert"
              message={t('attendancePartialCoverage', { degrees: Math.round(session.coverageDegrees) })}
            />
          )}

          <div className="attendance-results">
            <div className="attendance-result-head">
              <h4>
                <CheckCircleFilled /> {t('attendanceRecognised')} <Tag color="green">{known.length}</Tag>
              </h4>
              <h4>
                <QuestionCircleFilled /> {t('attendanceUnknownFaces')} <Tag color="orange">{strangers.length}</Tag>
              </h4>
            </div>

            {people.length ? (
              <div className="attendance-people">
                {people.map((person) => (
                  <div key={person.subjectId} className={`attendance-person is-${person.outcome}`}>
                    {person.faceImage
                      ? <img src={person.faceImage} alt={person.name || t('attendanceUnknownPerson')} />
                      : <span className="attendance-person-blank"><QuestionCircleFilled /></span>}
                    <strong>{person.name || t('attendanceUnknownPerson')}</strong>
                    <small>
                      {person.outcome === 'user'
                        // The distance is what the match was decided on, so it
                        // is shown rather than hidden behind a percentage that
                        // would imply a precision this does not have.
                        ? t('attendanceMatchDistance', { distance: Number(person.distance || 0).toFixed(2) })
                        : t('attendanceSeenTimes', { count: person.sightings || 1 })}
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              !running && <p className="attendance-empty">{t('attendanceNobodyFound')}</p>
            )}
          </div>

          {done && (
            <div className="face-modal-actions">
              {strangers.length > 0 && (
                <Tooltip title={t('attendanceNameThemHint')}>
                  <span className="attendance-empty">{t('attendanceNameThem')}</span>
                </Tooltip>
              )}
              <Button className="vision-btn-ghost" onClick={sweep.reset}>{t('attendanceRunAgain')}</Button>
              <Button type="primary" className="vision-btn-primary" onClick={close}>{t('done')}</Button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
