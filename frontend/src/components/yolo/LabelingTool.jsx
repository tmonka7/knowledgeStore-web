import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Col, Empty, Input, List, Modal, Progress, Row, Select, Space, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  AimOutlined, CheckOutlined, CloudUploadOutlined, DeleteOutlined, DownloadOutlined, FolderOpenOutlined, LeftOutlined,
  LoadingOutlined, RightOutlined, ScanOutlined, UndoOutlined,
} from '@ant-design/icons';
import LabelCanvas from './LabelCanvas';
import SaveToServerModal from '../ml/SaveToServerModal';
import { colorForClass } from '../../lib/objectDetector';
import {
  TASKS, boundsOf, buildCsv, buildLabelFile, buildYoloZip, datasetSummary, shapeForTask,
} from '../../lib/yoloDataset';
import { regionToShape, samSegment, samStatus } from '../../lib/samClient';
import { useLanguage } from '../../i18n';

const { Text } = Typography;

/**
 * Labelling a folder of images for YOLO.
 *
 * Everything happens in this tab: the images are read from a folder the person
 * picks, never uploaded, and the exports are built in the browser. A dataset
 * is usually thousands of files and many gigabytes, and sending all of it to a
 * server to be handed straight back would be the slowest possible way to do
 * nothing.
 *
 * The cost of that choice is that the work lives in one tab, so the labels —
 * not the images, which stay on disk — are mirrored into localStorage and
 * matched back up by file name when the same folder is opened again.
 *
 * SAM2 on the server (lib/samClient.js) helps draw: with "SAM2: click an
 * object" on, a click or a box outlines the object as a shape of the selected
 * class; "Detect regions" finds every region in the image and adds them
 * dashed, to be kept (pick a class for one, or Keep all) or discarded. Only
 * the image on screen is sent, scaled down, and only while SAM2 is used.
 */

const IMAGE_PATTERN = /\.(jpe?g|png|bmp|webp|gif|tiff?)$/i;
const STORAGE_KEY = 'yolo-labelling-draft';

const downloadBlob = (filename, blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/**
 * What identifies an image, and what its label file will be called.
 *
 * The path within the chosen folder, not the bare file name: a dataset split
 * into `train/` and `val/` subfolders very often holds the same file name in
 * both, and keying on the name alone would merge their labels and then write
 * two entries to the same path in the archive.
 */
const relativeNameOf = (file) => {
  const parts = (file.webkitRelativePath || '').split('/').slice(1);
  return parts.length ? parts.join('/') : file.name;
};

/** Overlap of two boxes ({ x, y, w, h }) as a share of their union. */
const overlapOf = (a, b) => {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const shared = w * h;
  return shared / (a.w * a.h + b.w * b.h - shared || 1);
};

const readDraft = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    // A corrupt or unreadable draft is not worth failing the page over.
    return null;
  }
};

export default function LabelingTool() {
  const { t } = useLanguage();

  const [images, setImages] = useState([]);
  const [index, setIndex] = useState(0);
  const [task, setTask] = useState('detect');
  const [classes, setClasses] = useState(['object']);
  const [classId, setClassId] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [newClass, setNewClass] = useState('');
  const [folderName, setFolderName] = useState('');
  // SAM2: whether the server has it, whether clicks go to it, and what it is doing.
  const [sam, setSam] = useState({ available: false, message: '' });
  const [samMode, setSamMode] = useState(false);
  const [samBusy, setSamBusy] = useState('');

  useEffect(() => {
    samStatus().then(setSam).catch(() => setSam({ available: false, message: t('samUnavailable') }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const folderInputRef = useRef(null);
  const fileInputRef = useRef(null);

  // webkitdirectory is not a React prop, and setting it as an attribute in JSX
  // logs a warning on every render. Applied to the node instead.
  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  // Restore the classes and the task on mount; the labels themselves are
  // matched to files only once a folder is opened.
  useEffect(() => {
    const draft = readDraft();
    if (!draft) return;
    if (Array.isArray(draft.classes) && draft.classes.length) setClasses(draft.classes);
    if (draft.task === 'detect' || draft.task === 'segment') setTask(draft.task);
  }, []);

  const current = images[index] || null;
  const currentFile = current?.file || null;

  // One object URL at a time. Creating them for every file up front would
  // pin an entire folder of images in memory for as long as the tab is open.
  const [imageUrl, setImageUrl] = useState('');
  useEffect(() => {
    if (!currentFile) {
      setImageUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(currentFile);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [currentFile]);

  const saveDraft = useCallback((list, classList, taskValue) => {
    try {
      const labels = {};
      list.forEach((image) => {
        if (image.shapes.length || image.visited) {
          labels[image.name] = { shapes: image.shapes, visited: Boolean(image.visited) };
        }
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        classes: classList, task: taskValue, labels,
      }));
    } catch {
      // Private mode, or a full quota. The session still works; only the
      // ability to survive a reload is lost, and saying so on every shape
      // would be worse than the problem.
    }
  }, []);

  // Debounced, because this serialises every label in the folder and the
  // state it watches changes on each corner of each shape. Half a second of
  // quiet is nothing to a person and spares a large dataset from being
  // re-encoded dozens of times a second.
  useEffect(() => {
    if (!images.length) return undefined;
    const timer = setTimeout(() => saveDraft(images, classes, task), 500);
    return () => clearTimeout(timer);
  }, [images, classes, task, saveDraft]);

  const openFiles = (fileList) => {
    const files = [...(fileList || [])]
      .filter((file) => IMAGE_PATTERN.test(file.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    if (!files.length) {
      message.warning(t('noImagesInFolder'));
      return;
    }

    const draft = readDraft();
    const saved = draft?.labels || {};

    setImages(files.map((file) => {
      const name = relativeNameOf(file);
      return {
        name,
        file,
        width: 0,
        height: 0,
        // Labels come back by path, so reopening the same folder resumes where
        // the last session stopped.
        shapes: saved[name]?.shapes || [],
        visited: Boolean(saved[name]?.visited),
      };
    }));

    const first = files[0];
    setFolderName(first.webkitRelativePath?.split('/')[0] || t('selectedFiles'));
    setIndex(0);
    setSelectedId(null);

    const restored = files.filter((file) => saved[relativeNameOf(file)]?.shapes?.length).length;
    if (restored) message.success(t('restoredLabels', { count: restored }));
  };

  const patchCurrent = useCallback((patch) => {
    setImages((list) => list.map((image, position) => (
      position === index ? { ...image, ...patch } : image
    )));
  }, [index]);

  const setShapes = useCallback((shapes) => {
    patchCurrent({ shapes, visited: true });
  }, [patchCurrent]);

  // Marking an image seen is what separates "no objects in it" from "never
  // opened", which is the difference between a background sample and a gap.
  useEffect(() => {
    if (current && !current.visited) patchCurrent({ visited: true });
  }, [current, patchCurrent]);

  const onImageLoaded = useCallback(({ width, height }) => {
    setImages((list) => list.map((image, position) => (
      // Both dimensions are compared: two images in a row are often the same
      // width, and checking only that would leave the height of the second one
      // set from the first — and the height is what every y coordinate in the
      // export is a fraction of.
      position === index && (image.width !== width || image.height !== height)
        ? { ...image, width, height }
        : image
    )));
  }, [index]);

  /*
   * Picking a class also gives it to the selected shape: that is how a shape
   * drawn with the wrong class, or found by SAM2, gets the right one. A shape
   * given a class has been looked at, so it is no longer an unreviewed one.
   */
  const pickClass = useCallback((position) => {
    setClassId(position);
    if (!selectedId) return;
    setImages((list) => list.map((image, at) => (at !== index ? image : {
      ...image,
      visited: true,
      shapes: image.shapes.map((shape) => (shape.id === selectedId
        ? { ...shape, classId: position, auto: undefined }
        : shape)),
    })));
  }, [selectedId, index]);

  /**
   * Put SAM2's shapes on the image they were asked for, which may no longer
   * be on screen. Found regions (`replaceAuto`) replace the last unreviewed
   * ones, and leave out any that mostly cover a shape already there: an
   * object labelled already is not offered again.
   */
  const addShapes = useCallback((name, shapes, replaceAuto) => {
    setImages((list) => list.map((image) => {
      if (image.name !== name) return image;
      const kept = replaceAuto ? image.shapes.filter((shape) => !shape.auto) : image.shapes;
      const fresh = replaceAuto
        ? shapes.filter((shape) => !kept.some((other) => overlapOf(boundsOf(shape), boundsOf(other)) > 0.7))
        : shapes;
      return { ...image, visited: true, shapes: [...kept, ...fresh] };
    }));
  }, []);

  const shapeKindRef = useRef('box');

  const askSam = useCallback(async (prompt) => {
    if (!current || samBusy) return;
    const { name, file } = current;
    const auto = prompt.mode === 'auto';
    setSamBusy(auto ? 'auto' : 'prompt');
    try {
      const result = await samSegment(file, prompt);
      const shapes = result.regions.map((region) => regionToShape(region, shapeKindRef.current, classId, auto));
      if (!shapes.length) {
        message.info(t('samNothingFound'));
        return;
      }
      addShapes(name, shapes, auto);
      if (auto) message.success(t('samFound', { count: shapes.length, seconds: result.took }));
      else setSelectedId(shapes[0].id);
    } catch (error) {
      message.error(error.response?.data?.message || t('samFailed'));
    } finally {
      setSamBusy('');
    }
  }, [current, samBusy, classId, addShapes, t]);

  const go = useCallback((delta) => {
    setIndex((position) => Math.min(images.length - 1, Math.max(0, position + delta)));
    setSelectedId(null);
  }, [images.length]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;

      if (event.key === 'ArrowRight') go(1);
      if (event.key === 'ArrowLeft') go(-1);

      // 1-9 pick a class, which is the shortcut that actually saves time when
      // there are several and every shape needs one.
      const digit = Number(event.key);
      if (digit >= 1 && digit <= 9 && digit <= classes.length) pickClass(digit - 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [go, classes.length, pickClass]);

  const addClass = () => {
    const name = newClass.trim();
    if (!name) return;
    if (classes.includes(name)) {
      message.warning(t('classAlreadyExists'));
      return;
    }
    setClasses((list) => [...list, name]);
    setClassId(classes.length);
    setNewClass('');
  };

  const removeClass = (removeIndex) => {
    const used = images.reduce(
      (sum, image) => sum + image.shapes.filter((shape) => shape.classId === removeIndex).length,
      0,
    );

    const drop = () => {
      // Every class above the removed one shifts down, and so must every shape
      // pointing at them — the id is the line number in data.yaml, so leaving
      // them alone would silently relabel the whole dataset.
      setImages((list) => list.map((image) => ({
        ...image,
        shapes: image.shapes
          .filter((shape) => shape.classId !== removeIndex)
          .map((shape) => (shape.classId > removeIndex
            ? { ...shape, classId: shape.classId - 1 }
            : shape)),
      })));
      setClasses((list) => list.filter((_, position) => position !== removeIndex));
      setClassId((value) => (value >= removeIndex && value > 0 ? value - 1 : value));
    };

    if (!used) {
      drop();
      return;
    }

    Modal.confirm({
      title: t('removeClassTitle', { name: classes[removeIndex] }),
      content: t('removeClassBody', { count: used }),
      okText: t('delete'),
      okButtonProps: { danger: true },
      onOk: drop,
    });
  };

  const summary = useMemo(() => datasetSummary(images), [images]);

  const exportCsv = () => {
    downloadBlob('dataset.csv', new Blob([buildCsv(images, classes)], {
      type: 'text/csv;charset=utf-8',
    }));
    message.success(t('datasetCsvSaved'));
  };

  const exportZip = () => {
    downloadBlob(`yolo-${task}-labels.zip`, buildYoloZip(images, classes, task));
    message.success(t('yoloLabelsSaved'));
  };

  /*
   * Saving to the server for training: every image in the folder goes up
   * (only those the server lacks are actually sent), with a label file for
   * each image that has been looked at — the same rule the zip export uses,
   * so an empty label still marks a background image.
   */
  const [savingToServer, setSavingToServer] = useState(false);
  const prepareServerSave = () => ({
    files: images.map((image) => ({ path: image.name, file: image.file })),
    finish: {
      suffix: 'labels',
      body: {
        classes,
        task,
        labels: Object.fromEntries(images
          .filter((image) => image.visited || image.shapes.length)
          .map((image) => [image.name, buildLabelFile(image, task)])),
      },
    },
  });

  const clearAll = () => {
    Modal.confirm({
      title: t('clearAllLabelsTitle'),
      content: t('clearAllLabelsBody', { count: summary.shapes }),
      okText: t('delete'),
      okButtonProps: { danger: true },
      onOk: () => {
        setImages((list) => list.map((image) => ({ ...image, shapes: [] })));
        setSelectedId(null);
      },
    });
  };

  const shapeKind = shapeForTask(task);
  shapeKindRef.current = shapeKind;
  const activeTask = TASKS.find((option) => option.value === task);
  const unreviewed = current ? current.shapes.filter((shape) => shape.auto).length : 0;

  return (
    <Row gutter={[16, 16]}>
      <Col span={24} lg={6}>
        <Card title={t('imageFolder')} bordered={false}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Button
              icon={<FolderOpenOutlined />}
              block
              onClick={() => folderInputRef.current?.click()}
            >
              {t('chooseFolder')}
            </Button>
            <Button block onClick={() => fileInputRef.current?.click()}>
              {t('chooseImagesInstead')}
            </Button>

            <input
              ref={folderInputRef}
              type="file"
              multiple
              className="mail-file-input"
              onChange={(event) => openFiles(event.target.files)}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="mail-file-input"
              onChange={(event) => openFiles(event.target.files)}
            />

            {folderName && (
              <Text type="secondary">
                {t('folderLoaded', { name: folderName, count: images.length })}
              </Text>
            )}

            <div>
              <Text strong>{t('annotationTask')}</Text>
              <Select
                value={task}
                onChange={(value) => { setTask(value); setSelectedId(null); }}
                style={{ width: '100%', marginTop: 8 }}
                options={TASKS.map(({ value, label }) => ({ value, label }))}
              />
              <Text type="secondary">{activeTask?.hint}</Text>
            </div>
          </Space>
        </Card>

        <Card title={t('classes')} bordered={false} style={{ marginTop: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <Space.Compact style={{ width: '100%' }}>
              <Input
                value={newClass}
                onChange={(event) => setNewClass(event.target.value)}
                onPressEnter={addClass}
                placeholder={t('newClassName')}
              />
              <Button onClick={addClass}>{t('add')}</Button>
            </Space.Compact>

            <List
              size="small"
              dataSource={classes}
              renderItem={(name, position) => (
                <List.Item
                  className={position === classId ? 'yolo-class is-active' : 'yolo-class'}
                  onClick={() => pickClass(position)}
                  actions={[
                    <Button
                      key="remove"
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={t('removeClassAria', { name })}
                      onClick={(event) => { event.stopPropagation(); removeClass(position); }}
                    />,
                  ]}
                >
                  <Space>
                    <span className="yolo-swatch" style={{ background: colorForClass(position) }} />
                    <span>{name}</span>
                    <Text type="secondary">{position + 1}</Text>
                  </Space>
                </List.Item>
              )}
            />
          </Space>
        </Card>
      </Col>

      <Col span={24} lg={12}>
        <Card
          bordered={false}
          title={current ? current.name : t('noImageLoaded')}
          extra={current && (
            <Text type="secondary">{`${index + 1} / ${images.length}`}</Text>
          )}
        >
          {current ? (
            <>
              <Space wrap style={{ marginBottom: 12 }}>
                <Tooltip title={sam.available ? t('samClickTip') : sam.message}>
                  <Button
                    type={samMode ? 'primary' : 'default'}
                    icon={samBusy === 'prompt' ? <LoadingOutlined /> : <AimOutlined />}
                    disabled={!sam.available}
                    onClick={() => { setSamMode((value) => !value); setSelectedId(null); }}
                  >
                    {t('samClick')}
                  </Button>
                </Tooltip>
                <Tooltip title={sam.available ? t('samDetectTip') : sam.message}>
                  <Button
                    icon={samBusy === 'auto' ? <LoadingOutlined /> : <ScanOutlined />}
                    disabled={!sam.available || Boolean(samBusy)}
                    onClick={() => askSam({ mode: 'auto' })}
                  >
                    {samBusy === 'auto' ? t('samWorking') : t('samDetect')}
                  </Button>
                </Tooltip>
                {unreviewed > 0 && (
                  <>
                    <Button
                      icon={<CheckOutlined />}
                      onClick={() => setShapes(current.shapes.map((shape) => (shape.auto ? { ...shape, auto: undefined } : shape)))}
                    >
                      {t('samKeepAll', { count: unreviewed })}
                    </Button>
                    <Button
                      danger
                      onClick={() => { setShapes(current.shapes.filter((shape) => !shape.auto)); setSelectedId(null); }}
                    >
                      {t('samDiscard', { count: unreviewed })}
                    </Button>
                  </>
                )}
              </Space>
              <div className="yolo-stage">
                <LabelCanvas
                  imageUrl={imageUrl}
                  shapeKind={shapeKind}
                  classId={classId}
                  classes={classes}
                  shapes={current.shapes}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onChange={setShapes}
                  onImageLoaded={onImageLoaded}
                  samMode={samMode && sam.available}
                  onSamPrompt={askSam}
                />
              </div>

              <Space style={{ marginTop: 12, width: '100%', justifyContent: 'space-between' }}>
                <Space>
                  <Button icon={<LeftOutlined />} onClick={() => go(-1)} disabled={index === 0}>
                    {t('previous')}
                  </Button>
                  <Button
                    icon={<RightOutlined />}
                    onClick={() => go(1)}
                    disabled={index >= images.length - 1}
                  >
                    {t('next')}
                  </Button>
                </Space>
                <Space>
                  <Tooltip title={t('undoLastShape')}>
                    <Button
                      icon={<UndoOutlined />}
                      disabled={!current.shapes.length}
                      onClick={() => {
                        setShapes(current.shapes.slice(0, -1));
                        setSelectedId(null);
                      }}
                    />
                  </Tooltip>
                  <Button
                    danger
                    disabled={!current.shapes.length}
                    onClick={() => { setShapes([]); setSelectedId(null); }}
                  >
                    {t('clearThisImage')}
                  </Button>
                </Space>
              </Space>

              <Alert
                style={{ marginTop: 12 }}
                type="info"
                showIcon
                message={samMode ? t('samClickHelp') : `${shapeKind === 'box' ? t('boxHelp') : t('polygonHelp')} ${t('changeClassHelp')}`}
              />
            </>
          ) : (
            <Empty description={t('chooseFolderToBegin')} />
          )}
        </Card>
      </Col>

      <Col span={24} lg={6}>
        <Card title={t('shapesOnThisImage')} bordered={false}>
          {current?.shapes.length ? (
            <List
              size="small"
              dataSource={current.shapes}
              renderItem={(shape, position) => (
                <List.Item
                  className={shape.id === selectedId ? 'yolo-shape is-active' : 'yolo-shape'}
                  onClick={() => setSelectedId(shape.id)}
                  actions={[
                    <Button
                      key="remove"
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={t('removeShapeAria', { number: position + 1 })}
                      onClick={(event) => {
                        event.stopPropagation();
                        setShapes(current.shapes.filter((entry) => entry.id !== shape.id));
                        if (shape.id === selectedId) setSelectedId(null);
                      }}
                    />,
                  ]}
                >
                  <Space>
                    <span className="yolo-swatch" style={{ background: colorForClass(shape.classId) }} />
                    <span>{classes[shape.classId] || `class ${shape.classId}`}</span>
                    {shape.auto
                      ? <Tag color="gold">{t('samUnreviewed')}</Tag>
                      : <Tag>{shape.type === 'box' ? t('box') : t('polygonPoints', { count: shape.points.length })}</Tag>}
                  </Space>
                </List.Item>
              )}
            />
          ) : (
            <Text type="secondary">{t('nothingOnThisImage')}</Text>
          )}
        </Card>

        <Card title={t('export')} bordered={false} style={{ marginTop: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Progress
              percent={images.length ? Math.round((summary.visited / images.length) * 100) : 0}
              size="small"
            />
            <Text type="secondary">
              {t('labellingProgress', {
                visited: summary.visited,
                total: summary.total,
                labelled: summary.labelled,
                shapes: summary.shapes,
              })}
            </Text>

            <Button
              type="primary"
              className="vision-btn-primary"
              icon={<DownloadOutlined />}
              block
              disabled={!images.length}
              onClick={exportCsv}
            >
              dataset.csv
            </Button>
            <Button
              icon={<DownloadOutlined />}
              block
              disabled={!images.length}
              onClick={exportZip}
            >
              {t('yoloLabelsZip')}
            </Button>
            <Button
              icon={<CloudUploadOutlined />}
              block
              disabled={!images.length}
              onClick={() => setSavingToServer(true)}
            >
              {t('mlSaveToServer')}
            </Button>
            <Button block danger disabled={!summary.shapes} onClick={clearAll}>
              {t('clearEveryLabel')}
            </Button>
          </Space>
        </Card>
      </Col>

      <SaveToServerModal
        open={savingToServer}
        onClose={() => setSavingToServer(false)}
        area="yolo"
        defaultName={folderName}
        canSave={summary.visited > 0}
        prepare={prepareServerSave}
      />
    </Row>
  );
}
