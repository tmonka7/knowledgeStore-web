// Shared face-recognition artwork used by the auth screen and the user editor.

const MESH_POINTS = [
  [100, 30], [70, 44], [130, 44], [52, 80], [148, 80], [78, 72], [122, 72], [100, 66],
  [76, 92], [124, 92], [100, 98], [100, 122], [84, 126], [116, 126], [58, 122], [142, 122],
  [82, 146], [118, 146], [100, 142], [100, 154], [72, 160], [128, 160], [100, 178],
];

const MESH_EDGES = [
  [0, 1], [0, 2], [1, 3], [2, 4], [1, 5], [2, 6], [0, 7], [1, 7], [2, 7], [5, 7], [6, 7], [3, 5], [4, 6],
  [5, 8], [6, 9], [3, 8], [4, 9], [5, 10], [6, 10], [7, 10], [8, 10], [9, 10], [10, 11], [8, 12], [9, 13],
  [11, 12], [11, 13], [3, 14], [4, 15], [8, 14], [9, 15], [12, 14], [13, 15], [12, 16], [13, 17], [12, 18],
  [13, 18], [11, 18], [16, 18], [17, 18], [16, 19], [17, 19], [14, 16], [15, 17], [14, 20], [15, 21],
  [16, 20], [17, 21], [19, 20], [19, 21], [20, 22], [21, 22], [19, 22],
];

export function FaceIdIcon() {
  return (
    <span className="anticon" role="img" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
        <circle cx="12" cy="10" r="3" />
        <path d="M7 18c.8-2.4 2.7-3.6 5-3.6s4.2 1.2 5 3.6" />
      </svg>
    </span>
  );
}

export function FaceScanArt({ mesh, className = 'auth-face-art' }) {
  return (
    <svg className={className} viewBox="0 0 200 210" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g className="auth-face-art-frame" strokeWidth="3">
        <path d="M14 40V22a8 8 0 0 1 8-8h18" />
        <path d="M160 14h18a8 8 0 0 1 8 8v18" />
        <path d="M186 170v18a8 8 0 0 1-8 8h-18" />
        <path d="M40 196H22a8 8 0 0 1-8-8v-18" />
      </g>
      <path className="auth-face-art-head" strokeWidth="2" d="M100 30C62 30 46 58 48 96c2 38 22 76 52 82 30-6 50-44 52-82 2-38-14-66-52-66Z" />
      {mesh ? (
        <>
          <g className="auth-face-art-mesh" strokeWidth="0.8">
            {MESH_EDGES.map(([from, to]) => (
              <line key={`${from}-${to}`} x1={MESH_POINTS[from][0]} y1={MESH_POINTS[from][1]} x2={MESH_POINTS[to][0]} y2={MESH_POINTS[to][1]} />
            ))}
          </g>
          <g className="auth-face-art-dots">
            {MESH_POINTS.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2" />)}
          </g>
        </>
      ) : (
        <g className="auth-face-art-head" strokeWidth="2">
          <path d="M70 94q7-6 14 0M116 94q7-6 14 0" />
          <path d="M100 100v20l-6 6" />
          <path d="M86 146q14 8 28 0" />
        </g>
      )}
      <rect className="auth-face-art-scan" x="30" y="40" width="140" height="3" rx="1.5" />
    </svg>
  );
}
